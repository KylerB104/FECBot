import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
  TimestampStyles,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  hashSpeech,
  speechPoints,
  SUBMISSION_RULES,
  validateAttachment,
} from "../domain.js";
import { findState } from "../geography.js";
import { mayCampaign } from "../permissions.js";
import type { SubmissionType } from "../types.js";
import { hashRemoteFile } from "../services/media.js";
import { validateStateForRace } from "../services/geography-config.js";
import {
  replyWithError,
  requireConfiguredGuild,
  type CommandContext,
} from "./shared.js";

export async function handleCampaignCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!(await requireConfiguredGuild(interaction, context.config))) return;
  const subcommand = interaction.options.getSubcommand();
  try {
    switch (subcommand) {
      case "submit":
        await submit(interaction, context);
        return;
      case "history":
        await history(interaction, context);
        return;
      case "calendar":
        await calendar(interaction, context);
        return;
      case "help":
        await help(interaction);
        return;
      default:
        throw new Error("Unknown campaign command.");
    }
  } catch (error) {
    await replyWithError(interaction, error);
  }
}

async function submit(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (interaction.channelId !== context.config.submissionChannelId) {
    throw new Error(
      `Campaign submissions are accepted only in <#${context.config.submissionChannelId}>.`,
    );
  }
  if (!mayCampaign(interaction, context.config)) {
    throw new Error(
      "You need the Citizen of the United States role to submit campaigns.",
    );
  }

  const cycleId = interaction.options.getString("cycle", true);
  const raceId = interaction.options.getString("race", true);
  const candidateEntryId = interaction.options.getString("candidate", true);
  const stateInput = interaction.options.getString("state", true);
  const type = interaction.options.getString("type", true) as SubmissionType;
  const attachment = interaction.options.getAttachment("file");
  const speech = interaction.options.getString("speech");

  const state = findState(stateInput);
  if (!state) throw new Error("Select one of the 50 United States.");
  const [cycle, race, candidate, campaignDeadline] = await Promise.all([
    context.repository.getCycle(cycleId, interaction.guildId ?? undefined),
    context.repository.getRace(raceId),
    context.repository.getCandidateEntry(candidateEntryId),
    context.repository.getCycleDeadline(cycleId, "campaign"),
  ]);
  if (!cycle || cycle.phase !== "campaign") {
    throw new Error("Campaigning is not open for that cycle.");
  }
  if (campaignDeadline && campaignDeadline.getTime() <= Date.now()) {
    throw new Error("The campaign deadline has passed.");
  }
  if (!race || race.cycle_id !== cycle.id) {
    throw new Error("The selected race does not belong to that cycle.");
  }
  validateStateForRace(context.geography, state, race);
  if (
    !candidate ||
    candidate.cycle_id !== cycle.id ||
    candidate.race_id !== race.id ||
    candidate.status !== "active"
  ) {
    throw new Error("The selected candidate is not active in that race.");
  }

  await interaction.deferReply();
  const media = await prepareContent(type, attachment, speech);

  const pending = await context.repository.createPendingSubmission({
    guildId: interaction.guildId!,
    cycleId,
    raceId,
    candidateEntryId,
    submitterUserId: interaction.user.id,
    targetState: state,
    submissionType: type,
    contentHash: media.hash,
    contentText: type === "speech" ? speech!.trim() : null,
    attachmentId: attachment?.id ?? null,
    attachmentName: attachment?.name ?? null,
    attachmentContentType: attachment?.contentType ?? null,
    attachmentSizeBytes: attachment?.size ?? null,
    attachmentUrl: attachment?.url ?? null,
    points: media.points,
    responseChannelId: interaction.channelId,
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`campaign:confirm:${pending.id}`)
      .setLabel("Confirm submission")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`campaign:cancel:${pending.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
  const preview = new EmbedBuilder()
    .setTitle("Campaign submission preview")
    .setDescription(
      "Review these details. Nothing is recorded until you press **Confirm submission**.",
    )
    .addFields(
      { name: "Candidate", value: candidate.display_name, inline: true },
      { name: "Race", value: race.display_name, inline: true },
      { name: "Target state", value: state, inline: true },
      { name: "Type", value: submissionTypeLabel(type), inline: true },
      {
        name: "Content",
        value:
          type === "speech"
            ? "The complete speech appears below."
            : `[${attachment!.name}](${attachment!.url}) (${formatBytes(attachment!.size)})`,
      },
    )
    .setFooter({ text: "This preview expires in 10 minutes." })
    .setColor(0xd4a72c);
  if (type === "poster") {
    preview.setImage(attachment!.url);
  }
  const previewEmbeds =
    type === "speech"
      ? [
          preview,
          new EmbedBuilder()
            .setTitle("Speech preview")
            .setDescription(speech!.trim())
            .setColor(0x667085),
        ]
      : [preview];

  const message = await interaction.editReply({
    embeds: previewEmbeds,
    components: [row],
  });
  await context.repository.setPendingMessageId(pending.id, message.id);
}

async function prepareContent(
  type: SubmissionType,
  attachment: Attachment | null,
  speech: string | null,
): Promise<{ hash: string; points: number }> {
  if (type === "speech") {
    if (attachment) {
      throw new Error("A speech must be entered as text without an attachment.");
    }
    if (!speech?.trim()) {
      throw new Error("Enter the speech text.");
    }
    const value = speech.trim();
    return { hash: hashSpeech(value), points: speechPoints(value) };
  }

  if (speech?.trim()) {
    throw new Error("Poster and video submissions must not include speech text.");
  }
  if (!attachment) {
    throw new Error(`Attach the ${type} file.`);
  }
  validateAttachment(type, attachment.name, attachment.size);
  const hash = await hashRemoteFile(
    attachment.url,
    SUBMISSION_RULES[type].maxBytes,
  );
  return { hash, points: SUBMISSION_RULES[type].points };
}

async function history(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycleId = interaction.options.getString("cycle", true);
  const candidateEntryId =
    interaction.options.getString("candidate") ?? undefined;
  const cycle = await context.repository.getCycle(
    cycleId,
    interaction.guildId ?? undefined,
  );
  if (!cycle) throw new Error("That cycle does not exist.");
  const rows = await context.repository.listCampaignHistory(cycleId, {
    ...(candidateEntryId ? { candidateEntryId } : {}),
  });
  if (rows.length === 0) {
    await interaction.reply("No campaign submissions match that request.");
    return;
  }

  const lines = rows.map((row) => {
    const link = row.response_message_id
      ? `https://discord.com/channels/${interaction.guildId}/${row.response_channel_id}/${row.response_message_id}`
      : null;
    const label =
      `**${row.candidate_name}** · ${submissionTypeLabel(row.submission_type)} ` +
      `in ${row.target_state}`;
    return link ? `• [${label}](${link})` : `• ${label}`;
  });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${cycle.name} campaign history`)
        .setDescription(lines.join("\n"))
        .setFooter({
          text: "Point totals remain available only to election administrators.",
        })
        .setColor(0x234f9d),
    ],
  });
}

async function calendar(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const cycles = await context.repository.listCycles(
    interaction.guildId!,
    undefined,
  );
  if (cycles.length === 0) {
    await interaction.reply("No election cycles have been created.");
    return;
  }
  const deadlines = await context.repository.listCycleDeadlines(
    cycles.map((cycle) => cycle.id),
  );
  const deadlineMap = new Map<string, typeof deadlines>();
  for (const deadline of deadlines) {
    const rows = deadlineMap.get(deadline.cycle_id) ?? [];
    rows.push(deadline);
    deadlineMap.set(deadline.cycle_id, rows);
  }
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Election calendar")
        .setDescription(
          cycles
            .slice(0, 15)
            .map((cycle) => {
              const dates = deadlineMap.get(cycle.id) ?? [];
              const deadlineText =
                dates.length === 0
                  ? ""
                  : `\n  ${dates
                      .map(
                        (deadline) =>
                          `${deadline.deadline_type}: ${time(new Date(deadline.deadline_at), TimestampStyles.ShortDateTime)}`,
                      )
                      .join(" · ")}`;
              return (
                `• **${cycle.name}** — ${cycle.stage} ${cycle.election_kind} · ` +
                `**${cycle.phase}**${deadlineText}`
              );
            })
            .join("\n"),
        )
        .setFooter({
          text: "Cycle dates are controlled manually by the Secretary of Elections.",
        })
        .setColor(0x234f9d),
    ],
  });
}

async function help(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Campaign rules")
        .setDescription(
          [
            "**Posters:** 1 point, 10 MB maximum, eight uses per cycle, one-hour reuse cooldown.",
            "**Video advertisements:** 2 points, 50 MB maximum, five uses per cycle, two-hour reuse cooldown.",
            "**Speeches:** 1 point per 500 characters, 2,000-character maximum, one use per cycle.",
            "",
            "The same material may be reused only for the same candidate and race. Different original material may be submitted immediately. External media links and GIFs are not accepted.",
            "",
            "Use `/campaign submit` in the designated campaign channel. Review the preview and confirm it within ten minutes.",
          ].join("\n"),
        )
        .setColor(0x234f9d),
    ],
  });
}

export async function handleCampaignButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith("campaign:")) return false;
  const [, action, pendingId] = interaction.customId.split(":");
  if (
    !pendingId ||
    (action !== "confirm" && action !== "cancel" && action !== "override")
  ) {
    await interaction.reply({
      content: "This campaign action is malformed.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    if (action === "override") {
      if (!isElectionAdministratorButton(interaction, context)) {
        await interaction.reply({
          content: "Only an election administrator may approve this exception.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`campaign-override:${pendingId}`)
        .setTitle("Approve duplicate exception")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Required audit reason")
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(3)
              .setMaxLength(500)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return true;
    }

    if (action === "cancel") {
      const cancelled = await context.repository.cancelPendingSubmission(
        pendingId,
        interaction.user.id,
      );
      if (!cancelled) {
        throw new Error(
          "Only the submitting user may cancel this preview, or it has already expired.",
        );
      }
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Campaign submission cancelled")
            .setColor(0x667085),
        ],
        components: [],
      });
      return true;
    }

    const pending = await context.repository.getPendingSubmission(pendingId);
    if (!pending) throw new Error("This submission preview has expired.");
    const cycle = await context.repository.getCycle(
      pending.cycle_id,
      pending.guild_id,
    );
    if (!cycle || cycle.phase !== "campaign") {
      throw new Error("The campaign phase closed before this was confirmed.");
    }

    await interaction.deferUpdate();
    const result = await context.repository.confirmPendingSubmission(
      pendingId,
      interaction.user.id,
      interaction.message.id,
    );
    if (!result.accepted) {
      const description = rejectionDescription(result);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Campaign submission rejected")
            .setDescription(description)
            .setColor(0xb42318),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`campaign:override:${pendingId}`)
              .setLabel("FEC override")
              .setStyle(ButtonStyle.Danger),
          ),
        ],
      });
      return true;
    }

    const [candidate, race] = await Promise.all([
      context.repository.getCandidateEntry(pending.candidate_entry_id),
      context.repository.getRace(pending.race_id),
    ]);
    const acceptedEmbed = new EmbedBuilder()
      .setTitle("Campaign submission accepted")
      .setDescription(
        `A ${submissionTypeLabel(pending.submission_type).toLowerCase()} was recorded for ` +
          `**${candidate?.display_name ?? "the candidate"}**.`,
      )
      .addFields(
        {
          name: "Race",
          value: race?.display_name ?? "Unknown race",
          inline: true,
        },
        { name: "Target state", value: pending.target_state, inline: true },
        {
          name: "Submitted by",
          value: `<@${pending.submitter_user_id}>`,
          inline: true,
        },
      )
      .setFooter({
        text: "Campaign point totals are visible only to election administrators.",
      })
      .setColor(0x157f3b)
      .setTimestamp();
    if (pending.submission_type === "poster" && pending.attachment_url) {
      acceptedEmbed
        .addFields({
          name: "Poster",
          value: `[Open original file](${pending.attachment_url})`,
        })
        .setImage(pending.attachment_url);
    } else if (
      pending.submission_type === "video" &&
      pending.attachment_url
    ) {
      acceptedEmbed.addFields({
        name: "Video advertisement",
        value: `[Open video](${pending.attachment_url})`,
      });
    }
    const acceptedEmbeds =
      pending.submission_type === "speech" && pending.content_text
        ? [
            acceptedEmbed,
            new EmbedBuilder()
              .setTitle("Speech")
              .setDescription(pending.content_text)
              .setColor(0x667085),
          ]
        : [acceptedEmbed];
    await interaction.editReply({
      embeds: acceptedEmbeds,
      components: [],
    });
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The action could not be completed.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Campaign action failed")
            .setDescription(message)
            .setColor(0xb42318),
        ],
        components: [],
      });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }
}

export async function handleCampaignOverrideModal(
  interaction: ModalSubmitInteraction,
  context: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith("campaign-override:")) return false;
  const pendingId = interaction.customId.split(":")[1];
  if (!pendingId) {
    await interaction.reply({
      content: "This override request is malformed.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (!isElectionAdministratorModal(interaction, context)) {
    await interaction.reply({
      content: "Only an election administrator may approve this exception.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const pending = await context.repository.getPendingSubmission(pendingId);
    if (!pending) throw new Error("This rejected submission has expired.");
    const cycle = await context.repository.getCycle(
      pending.cycle_id,
      pending.guild_id,
    );
    if (!cycle || cycle.phase !== "campaign") {
      throw new Error("The campaign phase is no longer open.");
    }
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    await context.repository.overridePendingSubmission({
      pendingId,
      actorUserId: interaction.user.id,
      reason,
      responseMessageId:
        pending.response_message_id ?? "unknown",
    });
    const [candidate, race] = await Promise.all([
      context.repository.getCandidateEntry(pending.candidate_entry_id),
      context.repository.getRace(pending.race_id),
    ]);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Campaign exception approved")
          .setDescription(
            `**${candidate?.display_name ?? "Candidate"}** received an FEC-approved ` +
              `${submissionTypeLabel(pending.submission_type).toLowerCase()} submission.`,
          )
          .addFields(
            {
              name: "Race",
              value: race?.display_name ?? "Unknown race",
              inline: true,
            },
            { name: "State", value: pending.target_state, inline: true },
            {
              name: "Approved by",
              value: `<@${interaction.user.id}>`,
              inline: true,
            },
            { name: "Reason", value: reason },
          )
          .setColor(0xd4a72c)
          .setTimestamp(),
      ],
      components: [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The override could not be completed.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, components: [] });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  return true;
}

function isElectionAdministratorButton(
  interaction: ButtonInteraction,
  context: CommandContext,
): boolean {
  if (context.config.ownerUserIds.has(interaction.user.id)) return true;
  if (!interaction.inCachedGuild()) return false;
  return [...context.config.adminRoleIds].some((roleId) =>
    interaction.member.roles.cache.has(roleId),
  );
}

function isElectionAdministratorModal(
  interaction: ModalSubmitInteraction,
  context: CommandContext,
): boolean {
  if (context.config.ownerUserIds.has(interaction.user.id)) return true;
  if (!interaction.inCachedGuild()) return false;
  return [...context.config.adminRoleIds].some((roleId) =>
    interaction.member.roles.cache.has(roleId),
  );
}

function rejectionDescription(result: {
  reason: "different-candidate" | "different-race" | "limit" | "cooldown";
  priorSubmitterUserId: string;
  retryAt?: Date;
}): string {
  const prior = `<@${result.priorSubmitterUserId}>`;
  switch (result.reason) {
    case "different-candidate":
      return `That material was already used for another candidate by ${prior}. It cannot be transferred to this candidate.`;
    case "different-race":
      return `That material was already used in another race by ${prior}. Each item is locked to one race per cycle.`;
    case "limit":
      return `That material has reached its reuse limit. Its first recorded use was submitted by ${prior}.`;
    case "cooldown":
      return `That material is still on cooldown after a use by ${prior}. Try again ${time(result.retryAt!, TimestampStyles.RelativeTime)}.`;
  }
}

function submissionTypeLabel(type: SubmissionType): string {
  return {
    poster: "Poster",
    video: "Video advertisement",
    speech: "Speech",
  }[type];
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
