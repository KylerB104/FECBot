import {
  randomUUID,
} from "node:crypto";
import {
  EmbedBuilder,
  MessageFlags,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
} from "discord.js";
import { DateTime } from "luxon";
import { calculateResults, determineWinner } from "../domain.js";
import {
  buildRaceSeeds,
  normalizeCommonwealthList,
  findState,
  romanNumeral,
  UNITED_STATES,
} from "../geography.js";
import { isElectionAdministrator } from "../permissions.js";
import type {
  CyclePhaseAction,
  DeadlineType,
  ElectionKind,
  Party,
} from "../types.js";
import {
  replyWithError,
  requireConfiguredGuild,
  type CommandContext,
} from "./shared.js";

export async function handleFecCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!(await requireConfiguredGuild(interaction, context.config))) return;
  if (!isElectionAdministrator(interaction, context.config)) {
    await interaction.reply({
      content:
        "This command is restricted to the Three Consuls, the Secretary of Elections, and the configured owner.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  try {
    switch (subcommand) {
      case "cycle-create":
        await cycleCreate(interaction, context);
        return;
      case "cycle-phase":
        await cyclePhase(interaction, context);
        return;
      case "cycle-delete":
        await cycleDelete(interaction, context);
        return;
      case "deadline-set":
        await deadlineSet(interaction, context);
        return;
      case "candidate-status":
        await candidateStatus(interaction, context);
        return;
      case "candidate-add":
        await candidateAdd(interaction, context);
        return;
      case "nominee-set":
        await nomineeSet(interaction, context);
        return;
      case "adjustment-add":
        await adjustmentAdd(interaction, context);
        return;
      case "votes-enter":
        await votesEnter(interaction, context);
        return;
      case "results":
        await results(interaction, context);
        return;
      case "audit-export":
        await auditExport(interaction, context);
        return;
      case "status":
        await status(interaction, context);
        return;
      default:
        throw new Error("Unknown FEC command.");
    }
  } catch (error) {
    await replyWithError(interaction, error);
  }
}

async function auditExport(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const events = await context.repository.listAuditEvents(interaction.guildId!);
  const rows = [
    [
      "Timestamp",
      "Event",
      "Actor User ID",
      "Entity Type",
      "Entity ID",
      "Details",
    ],
    ...events.map((event) => [
      new Date(event.created_at).toISOString(),
      event.event_type,
      event.actor_user_id ?? "",
      event.entity_type ?? "",
      event.entity_id ?? "",
      JSON.stringify(event.details),
    ]),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  await interaction.editReply({
    content: `Exported ${events.length.toLocaleString()} audit events.`,
    files: [
      {
        attachment: Buffer.from(csv, "utf8"),
        name: `fec-audit-${DateTime.utc().toFormat("yyyy-LL-dd-HHmm")}.csv`,
      },
    ],
  });
}

async function deadlineSet(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  requireSecretaryOrOwner(interaction, context);
  const cycleId = interaction.options.getString("cycle", true);
  const deadlineType = interaction.options.getString(
    "deadline",
    true,
  ) as DeadlineType;
  const when = interaction.options.getString("when", true);
  const cycle = await context.repository.getCycle(
    cycleId,
    interaction.guildId ?? undefined,
  );
  if (!cycle) throw new Error("That cycle does not exist.");
  const parsed = DateTime.fromFormat(when, "yyyy-MM-dd HH:mm", {
    zone: context.config.timeZone,
    setZone: true,
  });
  if (!parsed.isValid) {
    throw new Error(
      "Enter the deadline as YYYY-MM-DD HH:MM in Eastern Time, for example 2026-08-15 20:00.",
    );
  }
  const deadlineAt = parsed.toJSDate();
  if (deadlineAt.getTime() <= Date.now()) {
    throw new Error("The deadline must be in the future.");
  }
  await context.repository.setCycleDeadline({
    guildId: interaction.guildId!,
    cycleId,
    deadlineType,
    deadlineAt,
    actorUserId: interaction.user.id,
  });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Cycle deadline set")
        .setDescription(
          `**${cycle.name}** ${deadlineType} deadline: ` +
            `${time(deadlineAt, TimestampStyles.LongDateTime)} ` +
            `(${time(deadlineAt, TimestampStyles.RelativeTime)})`,
        )
        .setFooter({
          text: "The bot will issue 24-hour, 6-hour, and 1-hour reminders.",
        })
        .setColor(0x234f9d)
        .setTimestamp(),
    ],
  });
}

async function candidateAdd(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const displayName = interaction.options.getString("name", true).trim();
  const party = interaction.options.getString("party", true) as Party;
  const ideology = interaction.options.getString("ideology", true);
  const stateInput = interaction.options.getString("home-state", true);
  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason", true).trim();
  const homeState = findState(stateInput);
  if (!homeState) throw new Error("Select one of the 50 United States.");
  const [cycle, race] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getRace(raceId),
  ]);
  if (!cycle || !race || race.cycle_id !== cycle.id) {
    throw new Error("The selected cycle or race is invalid.");
  }
  if (user?.bot) throw new Error("A replacement candidate cannot be a bot.");

  const entry = await context.repository.registerCandidate({
    guildId: interaction.guildId!,
    discordUserId: user?.id ?? `writein:${cycleId}:${randomUUID()}`,
    displayName,
    party,
    ideology,
    homeState,
    cycleId,
    raceId,
  });
  await context.repository.recordAudit({
    guildId: interaction.guildId!,
    actorUserId: interaction.user.id,
    eventType: user ? "candidate.replacement_added" : "candidate.write_in_added",
    entityType: "candidate_entry",
    entityId: entry.id,
    details: { reason, replacementUserId: user?.id ?? null },
  });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(user ? "Replacement candidate added" : "Write-in candidate added")
        .setDescription(
          `**${entry.display_name}** was added to **${entry.race_display_name}**.`,
        )
        .addFields(
          { name: "Home state", value: homeState, inline: true },
          { name: "Party", value: party, inline: true },
          { name: "Reason", value: reason },
        )
        .setColor(0xd4a72c)
        .setTimestamp(),
    ],
  });
}

async function cycleCreate(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  requireSecretaryOrOwner(interaction, context);
  const name = interaction.options.getString("name", true).trim();
  const electionKind = interaction.options.getString(
    "kind",
    true,
  ) as ElectionKind;
  const senateClass = interaction.options.getInteger("senate-class", true);
  const governorInput = interaction.options.getString("governors", true);
  const governorRegions = normalizeCommonwealthList(governorInput);
  const raceSeeds = buildRaceSeeds(
    electionKind,
    senateClass,
    governorRegions,
  );

  const cycle = await context.repository.createCycle({
    guildId: interaction.guildId!,
    name,
    electionKind,
    senateClass,
    governorRegions,
    createdByUserId: interaction.user.id,
    races: raceSeeds,
  });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Election cycle created")
        .setDescription(
          `**${cycle.name}** was created in draft status with ${raceSeeds.length} races.`,
        )
        .addFields(
          { name: "Election", value: electionKind, inline: true },
          {
            name: "Election path",
            value: "Primary → General",
            inline: true,
          },
          {
            name: "Senate class",
            value: romanNumeral(senateClass),
            inline: true,
          },
          {
            name: "Governor races",
            value:
              governorRegions.length > 0
                ? governorRegions.join(", ")
                : "None",
          },
        )
        .setFooter({
          text: "Use /fec cycle-phase to open candidate signup.",
        })
        .setColor(0x234f9d)
        .setTimestamp(),
    ],
  });
}

async function cycleDelete(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  requireSecretaryOrOwner(interaction, context);
  const cycleId = interaction.options.getString("cycle", true);
  const confirmationName = interaction.options
    .getString("confirm-name", true)
    .trim();
  const reason = interaction.options.getString("reason", true).trim();
  const deletedName = await context.repository.deleteClosedCycle({
    guildId: interaction.guildId!,
    cycleId,
    confirmationName,
    reason,
    actorUserId: interaction.user.id,
  });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Election cycle permanently deleted")
        .setDescription(
          `**${deletedName}** and all election data attached to it were removed from the database.`,
        )
        .addFields({ name: "Reason", value: reason })
        .setColor(0x7a271a)
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function cyclePhase(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const phase = interaction.options.getString(
    "phase",
    true,
  ) as CyclePhaseAction;
  if (
    phase === "signup" ||
    phase === "primary_campaign" ||
    phase === "general_campaign"
  ) {
    requireSecretaryOrOwner(interaction, context);
  }
  const cycle = await context.repository.setCyclePhase(
    interaction.guildId!,
    cycleId,
    phase,
    interaction.user.id,
  );
  if (!cycle) throw new Error("That cycle does not exist.");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Cycle phase changed")
        .setDescription(`**${cycle.name}** is now **${cycle.phase}**.`)
        .setColor(
          cycle.phase === "paused" || cycle.phase === "closed"
            ? 0x7a271a
            : 0x157f3b,
        )
        .setFooter(
          cycle.phase === "general_campaign"
            ? {
                text: "Primary campaign submissions, points, votes, adjustments, and duplicate-use records were permanently reset.",
              }
            : null,
        )
        .setTimestamp(),
    ],
  });
}

function requireSecretaryOrOwner(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): void {
  if (context.config.ownerUserIds.has(interaction.user.id)) return;
  if (
    interaction.inCachedGuild() &&
    interaction.member.roles.cache.has(context.config.secretaryRoleId)
  ) {
    return;
  }
  throw new Error(
    "Only the Secretary of Elections or configured owner may create cycles, set deadlines, or open signup and campaigning.",
  );
}

async function candidateStatus(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const entryId = interaction.options.getString("candidate", true);
  const newStatus = interaction.options.getString("status", true) as
    | "active"
    | "withdrawn"
    | "disqualified";
  const reason = interaction.options.getString("reason", true).trim();
  const [cycle, existingEntry] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getCandidateEntry(entryId),
  ]);
  if (!cycle || !existingEntry || existingEntry.cycle_id !== cycle.id) {
    throw new Error("The selected cycle and candidate do not match.");
  }
  const entry = await context.repository.setCandidateStatus(
    interaction.guildId!,
    entryId,
    newStatus,
    interaction.user.id,
    reason,
  );
  if (!entry) throw new Error("That candidate does not exist.");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Candidate status updated")
        .setDescription(
          `**${entry.display_name}** is now **${newStatus}** in **${entry.race_display_name}**.`,
        )
        .addFields({ name: "Reason", value: reason })
        .setColor(newStatus === "active" ? 0x157f3b : 0x7a271a)
        .setTimestamp(),
    ],
  });
}

async function nomineeSet(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const entryId = interaction.options.getString("candidate", true);
  const isNominee = interaction.options.getBoolean("is-nominee", true);
  const [cycle, existingEntry] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getCandidateEntry(entryId),
  ]);
  if (
    !cycle ||
    !existingEntry ||
    existingEntry.cycle_id !== cycle.id
  ) {
    throw new Error("The selected cycle and candidate do not match.");
  }
  if (isNominee && existingEntry.status !== "active") {
    throw new Error("Only an active candidate can be marked as a nominee.");
  }
  const entry = await context.repository.setGeneralElectionNominee(
    interaction.guildId!,
    entryId,
    isNominee,
    interaction.user.id,
  );
  if (!entry) {
    throw new Error("That candidate entry does not exist.");
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("General-election nominee status updated")
        .setDescription(
          isNominee
            ? `**${entry.display_name}** is now recognized as a general-election nominee${entry.office_type === "president" ? " and may appoint a running mate" : ""}.`
            : `**${entry.display_name}** is no longer marked as a general-election nominee.`,
        )
        .setColor(isNominee ? 0x157f3b : 0x7a271a)
        .setTimestamp(),
    ],
  });
}

async function adjustmentAdd(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const candidateEntryId = interaction.options.getString("candidate", true);
  const percentagePoints = interaction.options.getNumber(
    "percentage-points",
    true,
  );
  const reason = interaction.options.getString("reason", true).trim();
  await validateRaceCandidate(context, cycleId, raceId, candidateEntryId);
  const race = await context.repository.getRace(raceId);
  if (race?.office_type === "president") {
    throw new Error(
      "The presidential report contains campaign points by state only; percentage adjustments do not apply.",
    );
  }
  await context.repository.addAdjustment({
    guildId: interaction.guildId!,
    cycleId,
    raceId,
    candidateEntryId,
    percentagePoints,
    reason,
    actorUserId: interaction.user.id,
  });
  const candidate =
    await context.repository.getCandidateEntry(candidateEntryId);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Result adjustment recorded")
        .setDescription(
          `**${percentagePoints >= 0 ? "+" : ""}${percentagePoints.toFixed(2)} percentage points** for ` +
            `**${candidate?.display_name ?? "candidate"}**.`,
        )
        .addFields({ name: "Reason", value: reason })
        .setColor(percentagePoints >= 0 ? 0x157f3b : 0xb42318)
        .setTimestamp(),
    ],
  });
}

async function votesEnter(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const candidateEntryId = interaction.options.getString("candidate", true);
  const votes = interaction.options.getInteger("votes", true);
  await validateRaceCandidate(context, cycleId, raceId, candidateEntryId);
  const race = await context.repository.getRace(raceId);
  if (race?.office_type === "president") {
    throw new Error(
      "Presidential votes are not entered here. The bot reports only presidential campaign points by state.",
    );
  }
  await context.repository.setVoteTotal({
    guildId: interaction.guildId!,
    cycleId,
    raceId,
    candidateEntryId,
    rawVotes: votes,
    actorUserId: interaction.user.id,
  });
  const candidate =
    await context.repository.getCandidateEntry(candidateEntryId);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Vote total recorded")
        .setDescription(
          `**${candidate?.display_name ?? "Candidate"}:** ${votes.toLocaleString()} raw votes`,
        )
        .setFooter({ text: "Entering another total replaces this value." })
        .setColor(0x234f9d)
        .setTimestamp(),
    ],
  });
}

async function results(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const action = interaction.options.getString("action", true) as
    | "calculate"
    | "publish";
  const [cycle, race] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getRace(raceId),
  ]);
  if (!cycle || !race || race.cycle_id !== cycle.id) {
    throw new Error("The selected cycle or race is invalid.");
  }
  if (
    cycle.phase !== "primary_results" &&
    cycle.phase !== "general_results"
  ) {
    throw new Error(
      "Results can be calculated only during the Primary Results or General Results phase.",
    );
  }
  const isPrimary = cycle.phase === "primary_results";

  if (action === "calculate" || race.office_type === "president") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } else {
    await interaction.deferReply();
  }

  if (race.office_type === "president") {
    const report = await context.repository.getPresidentialCampaignReport(
      raceId,
      UNITED_STATES,
      !isPrimary,
    );
    if (report.length === 0) {
      throw new Error("No presidential campaign points have been recorded.");
    }
    const data = { kind: "presidential-campaign-points", report };
    await context.repository.saveResultSnapshot({
      guildId: interaction.guildId!,
      cycleId,
      raceId,
      resultData: data,
      actorUserId: interaction.user.id,
      publish: action === "publish",
    });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${cycle.name} — presidential campaign points`)
          .setDescription(
            "The complete candidate-by-state point table is attached as a CSV file. " +
              "Each candidate automatically receives 20 points in their home state.",
          )
          .setFooter({
            text:
              action === "publish"
                ? "FEC snapshot saved. Presidential point reports remain private."
                : "Private preview. The bot does not declare presidential winners.",
          })
          .setColor(0x234f9d)
          .setTimestamp(),
      ],
      files: [
        {
          attachment: Buffer.from(presidentialReportCsv(report), "utf8"),
          name: `${safeFilename(cycle.name)}-presidential-campaign-points.csv`,
        },
      ],
    });
    return;
  }

  const inputs = await context.repository.getResultInputs(raceId, !isPrimary);
  if (inputs.length === 0) {
    throw new Error("No active candidates are registered in that race.");
  }
  const missingVotes = inputs.filter((input) => !input.votesEntered);
  if (missingVotes.length > 0) {
    throw new Error(
      "Enter a raw vote total for every active candidate before calculating results. " +
        `Missing: ${missingVotes.map((item) => item.displayName).join(", ")}`,
    );
  }
  const groups = isPrimary
    ? groupByParty(inputs)
    : new Map([["general", inputs]]);
  const sections: string[] = [];
  const resultData: Array<{
    group: string;
    calculated: ReturnType<typeof calculateResults>;
    outcome: ReturnType<typeof determineWinner>;
  }> = [];
  for (const [group, groupInputs] of groups) {
    const calculated = calculateResults(groupInputs);
    const outcome = determineWinner(calculated);
    const resultLines = calculated
      .sort((left, right) => right.finalPercentage - left.finalPercentage)
      .map(
        (item) =>
          `**${item.displayName} — ${item.finalPercentage.toFixed(2)}%**\n` +
          `Votes: ${item.rawVotes.toLocaleString()} → ${item.voteComponent.toFixed(2)}% · ` +
          `Campaign: ${item.campaignPoints} pts → ${item.campaignComponent.toFixed(2)}% · ` +
          `Adjustments: ${item.adjustments >= 0 ? "+" : ""}${item.adjustments.toFixed(2)}%`,
      );
    let outcomeText = "No winner could be determined.";
    if (outcome.kind === "winner") {
      outcomeText =
        isPrimary
          ? `**${capitalize(group)} nominee: ${outcome.result.displayName}**`
          : `**Winner: ${outcome.result.displayName}**`;
    } else if (outcome.kind === "tie") {
      outcomeText =
        `**Tie reported to the FEC:** ` +
        outcome.results.map((item) => item.displayName).join(", ");
    }
    sections.push(
      `${isPrimary ? `### ${capitalize(group)} primary\n` : ""}` +
        `${resultLines.join("\n\n")}\n\n${outcomeText}`,
    );
    resultData.push({ group, calculated, outcome });
  }
  const data = { kind: "combined-result", groups: resultData };
  await context.repository.saveResultSnapshot({
    guildId: interaction.guildId!,
    cycleId,
    raceId,
    resultData: data,
    actorUserId: interaction.user.id,
    publish: action === "publish",
  });
  if (action === "publish" && isPrimary) {
    const nomineeEntryIds = resultData.flatMap((group) =>
      group.outcome.kind === "winner"
        ? [group.outcome.result.candidateEntryId]
        : [],
    );
    await context.repository.replaceGeneralElectionNominees(
      interaction.guildId!,
      raceId,
      nomineeEntryIds,
      interaction.user.id,
    );
  }

  const fullDescription = sections.join("\n\n");
  const visibleDescription =
    action === "publish"
      ? publicResultDescription(resultData)
      : fullDescription.length <= 4_096
      ? fullDescription
      : `${resultData.map(resultGroupSummary).join("\n")}\n\n` +
        "The complete calculation exceeded Discord's display limit and is attached as CSV.";
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${race.display_name} result`)
        .setDescription(visibleDescription)
        .setFooter({
          text:
            action === "publish"
              ? isPrimary
                ? "Official primary publication · winners automatically qualified for the general election"
                : "Official FEC publication · detailed campaign points remain private"
              : "Private calculation preview",
        })
        .setColor(
          resultData.some((group) => group.outcome.kind === "tie")
            ? 0xd4a72c
            : 0x234f9d,
        )
        .setTimestamp(),
    ],
    files:
      action === "calculate"
        ? [
            {
              attachment: Buffer.from(combinedResultCsv(resultData), "utf8"),
              name: `${safeFilename(cycle.name)}-${safeFilename(race.display_name)}-result.csv`,
            },
          ]
        : [],
  });
}

function groupByParty<T extends { party?: string }>(
  inputs: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const input of inputs) {
    const party = input.party ?? "independent";
    const group = groups.get(party) ?? [];
    group.push(input);
    groups.set(party, group);
  }
  return groups;
}

function presidentialReportCsv(
  report: Array<{
    display_name: string;
    home_state: string;
    target_state: string;
    points: number;
  }>,
): string {
  const rows = [["State", "Candidate", "Home State", "Campaign Points"]];
  for (const item of report) {
    rows.push([
      item.target_state,
      item.display_name,
      item.home_state,
      String(item.points),
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function combinedResultCsv(
  groups: Array<{
    group: string;
    calculated: ReturnType<typeof calculateResults>;
    outcome: ReturnType<typeof determineWinner>;
  }>,
): string {
  const rows = [
    [
      "Group",
      "Candidate",
      "Raw Votes",
      "Campaign Points",
      "Vote Component",
      "Campaign Component",
      "Adjustments",
      "Final Percentage",
    ],
  ];
  for (const group of groups) {
    for (const item of group.calculated) {
      rows.push([
        group.group,
        item.displayName,
        String(item.rawVotes),
        String(item.campaignPoints),
        item.voteComponent.toFixed(3),
        item.campaignComponent.toFixed(3),
        item.adjustments.toFixed(3),
        item.finalPercentage.toFixed(3),
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function resultGroupSummary(group: {
  group: string;
  outcome: ReturnType<typeof determineWinner>;
}): string {
  if (group.outcome.kind === "winner") {
    return group.group === "general"
      ? `**Winner:** ${group.outcome.result.displayName}`
      : `**${capitalize(group.group)} nominee:** ${group.outcome.result.displayName}`;
  }
  if (group.outcome.kind === "tie") {
    return (
      `**${group.group === "general" ? "Result" : capitalize(group.group)} tie:** ` +
      group.outcome.results.map((item) => item.displayName).join(", ")
    );
  }
  return `**${capitalize(group.group)}:** no result`;
}

function publicResultDescription(
  groups: Array<{
    group: string;
    calculated: ReturnType<typeof calculateResults>;
    outcome: ReturnType<typeof determineWinner>;
  }>,
): string {
  return groups
    .map((group) => {
      const heading =
        group.group === "general" ? "" : `**${capitalize(group.group)} primary**\n`;
      const scores = [...group.calculated]
        .sort((left, right) => right.finalPercentage - left.finalPercentage)
        .map(
          (item) =>
            `• ${item.displayName}: **${item.finalPercentage.toFixed(2)}%**`,
        )
        .join("\n");
      return `${heading}${scores}\n${resultGroupSummary(group)}`;
    })
    .join("\n\n")
    .slice(0, 4_096);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "cycle"
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function status(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycles = await context.repository.listCycles(interaction.guildId!);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("FEC bot status")
        .setDescription("The bot and PostgreSQL connection are operational.")
        .addFields(
          {
            name: "Known cycles",
            value: String(cycles.length),
            inline: true,
          },
          {
            name: "Campaign channel",
            value: `<#${context.config.submissionChannelId}>`,
            inline: true,
          },
          {
            name: "Staff logging",
            value: context.config.logChannelId
              ? `<#${context.config.logChannelId}>`
              : "Not configured",
            inline: true,
          },
        )
        .setColor(0x157f3b)
        .setTimestamp(),
    ],
  });
}

async function validateRaceCandidate(
  context: CommandContext,
  cycleId: string,
  raceId: string,
  candidateEntryId: string,
): Promise<void> {
  const [cycle, race, candidate] = await Promise.all([
    context.repository.getCycle(cycleId),
    context.repository.getRace(raceId),
    context.repository.getCandidateEntry(candidateEntryId),
  ]);
  if (
    !cycle ||
    !race ||
    !candidate ||
    race.cycle_id !== cycle.id ||
    candidate.cycle_id !== cycle.id ||
    candidate.race_id !== race.id
  ) {
    throw new Error("The cycle, race, and candidate selections do not match.");
  }
  if (
    cycle.phase !== "primary_results" &&
    cycle.phase !== "general_results"
  ) {
    throw new Error(
      "Votes and result adjustments may be entered only during a results phase.",
    );
  }
  if (cycle.phase === "general_results" && !candidate.advanced_to_general) {
    throw new Error("That candidate did not qualify for the general election.");
  }
}
