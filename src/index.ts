import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} from "discord.js";
import {
  handleCampaignButton,
  handleCampaignCommand,
  handleCampaignOverrideModal,
} from "./commands/campaign.js";
import {
  handleCandidateCommand,
  handleRunningMateButton,
} from "./commands/candidate.js";
import { commandDefinitions } from "./commands/definitions.js";
import { handleFecCommand } from "./commands/fec.js";
import {
  handleCommonAutocomplete,
  type CommandContext,
} from "./commands/shared.js";
import { loadConfig } from "./config.js";
import { createDatabasePool, runMigrations } from "./db.js";
import { Repository } from "./repository.js";
import { AuditLog } from "./services/audit-log.js";
import { loadStateGeography } from "./services/geography-config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config);
  await runMigrations(pool);

  const repository = new Repository(pool);
  const geography = await loadStateGeography(config.geographyFile);
  const context: CommandContext = { config, repository, geography };
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  const auditLog = new AuditLog(client, config);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Signed in as ${readyClient.user.tag}`);
    try {
      const rest = new REST({ version: "10" }).setToken(config.discordToken);
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.guildId),
        { body: commandDefinitions },
      );
      console.log(
        `Registered ${commandDefinitions.length} command groups in guild ${config.guildId}.`,
      );
      await auditLog.send(
        "FEC bot online",
        "The bot connected successfully and synchronized its slash commands.",
      );
      await flushAuditEvents(context, auditLog);
      await sendDueDeadlineReminders(client, context, auditLog);
    } catch (error) {
      console.error("Slash-command registration failed:", error);
      await auditLog.send(
        "FEC command synchronization failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const handled = await handleCommonAutocomplete(interaction, context);
        if (!handled) await interaction.respond([]);
        return;
      }

      if (interaction.isButton()) {
        if (await handleCampaignButton(interaction, context)) return;
        if (await handleRunningMateButton(interaction, context)) return;
        return;
      }

      if (interaction.isModalSubmit()) {
        if (await handleCampaignOverrideModal(interaction, context)) return;
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      switch (interaction.commandName) {
        case "candidate":
          await handleCandidateCommand(interaction, context);
          return;
        case "campaign":
          await handleCampaignCommand(interaction, context);
          return;
        case "fec":
          await handleFecCommand(interaction, context);
          return;
      }
    } catch (error) {
      console.error("Unhandled interaction error:", error);
      await auditLog.send(
        "Unhandled bot error",
        error instanceof Error ? error.message : String(error),
        [
          {
            name: "Interaction",
            value: interaction.id,
            inline: true,
          },
          {
            name: "User",
            value: interaction.user.id,
            inline: true,
          },
        ],
      );
    }
  });

  client.on(Events.Error, async (error) => {
    console.error("Discord client error:", error);
    await auditLog.send("Discord client error", error.message);
  });

  const cleanupTimer = setInterval(
    () => {
      void repository.cleanupExpiredPending().catch((error) => {
        console.error("Pending-submission cleanup failed:", error);
      });
    },
    5 * 60 * 1_000,
  );
  cleanupTimer.unref();
  const reminderTimer = setInterval(
    () => {
      void sendDueDeadlineReminders(client, context, auditLog);
    },
    60 * 1_000,
  );
  reminderTimer.unref();
  const auditTimer = setInterval(
    () => {
      void flushAuditEvents(context, auditLog);
    },
    15 * 1_000,
  );
  auditTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; shutting down.`);
    clearInterval(cleanupTimer);
    clearInterval(reminderTimer);
    clearInterval(auditTimer);
    client.destroy();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await client.login(config.discordToken);
}

async function flushAuditEvents(
  context: CommandContext,
  auditLog: AuditLog,
): Promise<void> {
  if (!context.config.logChannelId) return;
  try {
    const events = await context.repository.listUnsentAuditEvents(
      context.config.guildId,
    );
    for (let index = 0; index < events.length; index += 10) {
      const batch = events.slice(index, index + 10);
      const description = batch
        .map((event) => {
          const actor = event.actor_user_id
            ? `<@${event.actor_user_id}>`
            : "System";
          const details = JSON.stringify(event.details);
          const compact =
            details.length > 300 ? `${details.slice(0, 299)}…` : details;
          return `• **${event.event_type}** · ${actor}\n  \`${compact}\``;
        })
        .join("\n");
      const sent = await auditLog.send("FEC audit events", description);
      if (!sent) return;
      await context.repository.markAuditEventsSent(
        batch.map((event) => event.id),
      );
    }
  } catch (error) {
    console.error("Audit-event delivery failed:", error);
  }
}

async function sendDueDeadlineReminders(
  client: Client,
  context: CommandContext,
  auditLog: AuditLog,
): Promise<void> {
  try {
    const reminders = await context.repository.claimDueDeadlineReminders(
      context.config.guildId,
    );
    if (reminders.length === 0) return;
    const channel = await client.channels.fetch(
      context.config.submissionChannelId,
    );
    if (!channel?.isSendable()) {
      throw new Error("The configured campaign channel is not sendable.");
    }
    for (const reminder of reminders) {
      const unix = Math.floor(reminder.deadlineAt.getTime() / 1_000);
      await channel.send({
        content:
          `<@&${context.config.campaignerRoleId}> **${reminder.cycleName}** ` +
          `${reminder.deadlineType} closes <t:${unix}:R> at <t:${unix}:F>.`,
        allowedMentions: { roles: [context.config.campaignerRoleId] },
      });
    }
  } catch (error) {
    console.error("Deadline reminder check failed:", error);
    await auditLog.send(
      "Deadline reminder failure",
      error instanceof Error ? error.message : String(error),
    );
  }
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exitCode = 1;
});
