import {
  EmbedBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { AppConfig } from "../config.js";
import { UNITED_STATES } from "../geography.js";
import type { Repository } from "../repository.js";
import {
  allowedStatesForRace,
  type StateGeography,
} from "../services/geography-config.js";
import type { Party } from "../types.js";

export interface CommandContext {
  config: AppConfig;
  repository: Repository;
  geography: StateGeography;
}

export function partyLabel(party: Party): string {
  return {
    democratic: "Democratic",
    republican: "Republican",
    reform: "Reform",
    independent: "Independent",
  }[party];
}

export function ideologyLabel(ideology: string): string {
  return ideology
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Request could not be completed")
    .setDescription(message)
    .setColor(0xb42318);
}

export async function replyWithError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> {
  const message = friendlyErrorMessage(error);
  console.error(error);
  const embed = errorEmbed(message);
  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components: [] });
  } else if (interaction.replied) {
    await interaction.followUp({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}

function friendlyErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    const constraint =
      "constraint" in error && typeof error.constraint === "string"
        ? error.constraint
        : "";
    if (constraint.includes("candidate_entries")) {
      return "That person is already registered in another race for this cycle.";
    }
    if (constraint.includes("election_cycles")) {
      return "An election cycle with that name already exists.";
    }
    return "That record already exists.";
  }
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

export async function requireConfiguredGuild(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
): Promise<boolean> {
  if (interaction.guildId === config.guildId) return true;
  await interaction.reply({
    content: "This bot is configured only for The Federalist Project server.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function handleCommonAutocomplete(
  interaction: AutocompleteInteraction,
  context: CommandContext,
): Promise<boolean> {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value).trim().toLowerCase();

  if (focused.name === "state" || focused.name === "home-state") {
    let allowedStates: readonly string[] = UNITED_STATES;
    if (focused.name === "state") {
      const raceId = interaction.options.getString("race");
      if (raceId) {
        const race = await context.repository.getRace(raceId);
        if (race) {
          allowedStates = allowedStatesForRace(context.geography, race);
        }
      }
    }
    const matches = allowedStates.filter((state) =>
      state.toLowerCase().includes(query),
    )
      .slice(0, 25)
      .map((state) => ({ name: state, value: state }));
    await interaction.respond(matches);
    return true;
  }

  if (focused.name === "cycle") {
    const phases =
      interaction.commandName === "candidate" &&
      interaction.options.getSubcommand(false) === "register"
        ? (["signup"] as const)
        : interaction.commandName === "campaign" &&
            interaction.options.getSubcommand(false) === "submit"
          ? (["primary_campaign", "general_campaign"] as const)
          : interaction.commandName === "fec" &&
              interaction.options.getSubcommand(false) === "cycle-delete"
            ? (["closed"] as const)
            : interaction.commandName === "fec" &&
                [
                  "votes-enter",
                  "adjustment-add",
                  "results",
                ].includes(interaction.options.getSubcommand(false) ?? "")
              ? (["primary_results", "general_results"] as const)
          : undefined;
    const cycles = await context.repository.listCycles(
      interaction.guildId ?? context.config.guildId,
      phases ? [...phases] : undefined,
      query,
    );
    await interaction.respond(
      cycles.slice(0, 25).map((cycle) => ({
        name: truncate(`${cycle.name} — ${cycle.phase}`, 100),
        value: cycle.id,
      })),
    );
    return true;
  }

  if (focused.name === "race") {
    const cycleId = interaction.options.getString("cycle");
    if (!cycleId) {
      await interaction.respond([]);
      return true;
    }
    const races = await context.repository.listRaces(cycleId, query);
    await interaction.respond(
      races.map((race) => ({
        name: truncate(race.display_name, 100),
        value: race.id,
      })),
    );
    return true;
  }

  if (focused.name === "candidate") {
    const cycleId = interaction.options.getString("cycle");
    if (!cycleId) {
      await interaction.respond([]);
      return true;
    }
    const raceId = interaction.options.getString("race") ?? undefined;
    const cycle = await context.repository.getCycle(
      cycleId,
      interaction.guildId ?? context.config.guildId,
    );
    const subcommand = interaction.options.getSubcommand(false);
    const usesGeneralBallot =
      interaction.commandName === "campaign" ||
      (interaction.commandName === "fec" &&
        (subcommand === "votes-enter" || subcommand === "adjustment-add"));
    const nomineesOnly =
      usesGeneralBallot &&
      (cycle?.phase === "general_campaign" ||
        cycle?.phase === "general_results");
    const entries = await context.repository.listCandidateEntries(cycleId, {
      ...(raceId ? { raceId } : {}),
      search: query,
      activeOnly: true,
      nomineesOnly,
    });
    await interaction.respond(
      entries.map((entry) => ({
        name: truncate(
          `${entry.display_name} — ${entry.race_display_name}`,
          100,
        ),
        value: entry.id,
      })),
    );
    return true;
  }

  return false;
}
