import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { findState } from "../geography.js";
import { mayCampaign } from "../permissions.js";
import type { Party } from "../types.js";
import {
  ideologyLabel,
  partyLabel,
  replyWithError,
  requireConfiguredGuild,
  type CommandContext,
} from "./shared.js";

export async function handleCandidateCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!(await requireConfiguredGuild(interaction, context.config))) return;

  const subcommand = interaction.options.getSubcommand();
  try {
    switch (subcommand) {
      case "register":
        await register(interaction, context);
        return;
      case "withdraw":
        await withdraw(interaction, context);
        return;
      case "list":
        await list(interaction, context);
        return;
      case "view":
        await view(interaction, context);
        return;
      case "running-mate":
        await runningMate(interaction, context);
        return;
      default:
        throw new Error("Unknown candidate command.");
    }
  } catch (error) {
    await replyWithError(interaction, error);
  }
}

async function register(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!mayCampaign(interaction, context.config)) {
    throw new Error(
      "You need the Citizen of the United States role to register.",
    );
  }

  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const displayName = interaction.options.getString("name", true).trim();
  const party = interaction.options.getString("party", true) as Party;
  const ideology = interaction.options.getString("ideology", true);
  const homeStateInput = interaction.options.getString("home-state", true);
  const homeState = findState(homeStateInput);
  if (!homeState) {
    throw new Error("Select one of the 50 United States as the home state.");
  }

  const [cycle, race, signupDeadline] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getRace(raceId),
    context.repository.getCycleDeadline(cycleId, "signup"),
  ]);
  if (!cycle || !race || race.cycle_id !== cycle.id) {
    throw new Error("The selected cycle or race is not valid.");
  }
  if (cycle.phase !== "signup") {
    throw new Error("Candidate registration is not open for that cycle.");
  }
  if (signupDeadline && signupDeadline.getTime() <= Date.now()) {
    throw new Error("The candidate-signup deadline has passed.");
  }

  const entry = await context.repository.registerCandidate({
    guildId: interaction.guildId!,
    discordUserId: interaction.user.id,
    displayName,
    party,
    ideology,
    homeState,
    cycleId,
    raceId,
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Candidacy registered")
        .setDescription(
          `**${entry.display_name}** is now registered for **${entry.race_display_name}**.`,
        )
        .addFields(
          { name: "Party", value: partyLabel(entry.party), inline: true },
          {
            name: "Ideology",
            value: ideologyLabel(entry.ideology),
            inline: true,
          },
          { name: "Home state", value: entry.home_state, inline: true },
        )
        .setColor(0x234f9d)
        .setTimestamp(),
    ],
  });
}

async function withdraw(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const entry = await context.repository.getUserEntry(
    cycleId,
    interaction.user.id,
  );
  if (!entry) {
    throw new Error("You do not have a candidacy in that cycle.");
  }
  if (entry.status !== "active") {
    throw new Error(`That candidacy is already ${entry.status}.`);
  }
  const updated = await context.repository.setCandidateStatus(
    interaction.guildId!,
    entry.id,
    "withdrawn",
    interaction.user.id,
    "Candidate-initiated withdrawal",
  );
  if (!updated) throw new Error("The candidacy could not be updated.");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Candidacy withdrawn")
        .setDescription(
          `**${updated.display_name}** has withdrawn from **${updated.race_display_name}**.`,
        )
        .setColor(0x7a271a)
        .setTimestamp(),
    ],
  });
}

async function list(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race") ?? undefined;
  const cycle = await context.repository.getCycle(
    cycleId,
    interaction.guildId ?? undefined,
  );
  if (!cycle) throw new Error("That cycle does not exist.");
  const entries = await context.repository.listCandidateEntries(cycleId, {
    ...(raceId ? { raceId } : {}),
  });
  if (entries.length === 0) {
    await interaction.reply(`No candidates are registered for **${cycle.name}**.`);
    return;
  }

  const lines = entries.map(
    (entry) =>
      `• **${entry.display_name}** — ${entry.race_display_name} · ` +
      `${partyLabel(entry.party)} · ${entry.status}`,
  );
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${cycle.name} candidates`)
        .setDescription(lines.join("\n"))
        .setColor(0x234f9d),
    ],
  });
}

async function view(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const entryId = interaction.options.getString("candidate", true);
  const [cycle, entry] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getCandidateEntry(entryId),
  ]);
  if (!cycle || !entry || entry.cycle_id !== cycle.id) {
    throw new Error("That candidate does not exist in the selected cycle.");
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(entry.display_name)
        .setDescription(`Candidate for **${entry.race_display_name}**`)
        .addFields(
          { name: "Party", value: partyLabel(entry.party), inline: true },
          {
            name: "Ideology",
            value: ideologyLabel(entry.ideology),
            inline: true,
          },
          { name: "Home state", value: entry.home_state, inline: true },
          { name: "Status", value: entry.status, inline: true },
          {
            name: "Running mate",
            value: entry.running_mate_user_id
              ? `<@${entry.running_mate_user_id}>`
              : "Not appointed",
            inline: true,
          },
        )
        .setColor(0x234f9d),
    ],
  });
}

async function runningMate(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const proposedUser = interaction.options.getUser("user", true);
  if (proposedUser.bot || proposedUser.id === interaction.user.id) {
    throw new Error("Select another human member as the proposed running mate.");
  }
  const [cycle, entry] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getUserEntry(cycleId, interaction.user.id),
  ]);
  if (
    !cycle ||
    !entry ||
    entry.office_type !== "president" ||
    !entry.is_presidential_nominee ||
    entry.status !== "active"
  ) {
    throw new Error(
      "Only an active presidential candidate recognized by the FEC as the nominee may appoint a running mate.",
    );
  }
  if (!interaction.guild) throw new Error("This command must be used in the server.");
  const proposedMember = await interaction.guild.members.fetch(proposedUser.id);
  if (!proposedMember.roles.cache.has(context.config.campaignerRoleId)) {
    throw new Error(
      "The proposed running mate must have the Citizen of the United States role.",
    );
  }

  const requestId = await context.repository.createRunningMateRequest(
    interaction.guildId!,
    entry.id,
    proposedUser.id,
    interaction.user.id,
  );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:accept:${requestId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket:decline:${requestId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger),
  );
  const requestEmbed = new EmbedBuilder()
    .setTitle("Running-mate invitation")
    .setDescription(
      `<@${interaction.user.id}> has invited <@${proposedUser.id}> to join the **${entry.display_name}** presidential ticket.`,
    )
    .setColor(0x234f9d);

  let deliveredByDm = false;
  try {
    await proposedUser.send({ embeds: [requestEmbed], components: [buttons] });
    deliveredByDm = true;
  } catch {
    deliveredByDm = false;
  }

  await interaction.reply({
    content: deliveredByDm
      ? `The invitation was sent privately to <@${proposedUser.id}>.`
      : `<@${proposedUser.id}>, please respond to this running-mate invitation.`,
    embeds: deliveredByDm ? [] : [requestEmbed],
    components: deliveredByDm ? [] : [buttons],
  });
}

export async function handleRunningMateButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith("ticket:")) return false;
  const [, action, requestId] = interaction.customId.split(":");
  if (!requestId || (action !== "accept" && action !== "decline")) {
    await interaction.reply({
      content: "This ticket request is malformed.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const result = await context.repository.respondToRunningMateRequest(
    context.config.guildId,
    requestId,
    interaction.user.id,
    action === "accept",
  );
  if (!result.ok) {
    const reason =
      result.reason === "wrong-user"
        ? "Only the invited user can respond."
        : "This invitation is missing or has already been resolved.";
    await interaction.reply({
      content: reason,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.update({
    content:
      action === "accept"
        ? `<@${interaction.user.id}> accepted the running-mate appointment.`
        : `<@${interaction.user.id}> declined the running-mate appointment.`,
    components: [],
  });
  return true;
}
