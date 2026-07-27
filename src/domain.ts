import { createHash } from "node:crypto";
import type {
  ResultCandidateInput,
  ResultCandidateOutput,
  SubmissionType,
} from "./types.js";

export const SUBMISSION_RULES = {
  poster: {
    points: 1,
    useLimit: 8,
    cooldownMs: 60 * 60 * 1_000,
    maxBytes: 10 * 1024 * 1024,
    extensions: new Set(["png", "jpg", "jpeg", "webp"]),
  },
  video: {
    points: 2,
    useLimit: 5,
    cooldownMs: 2 * 60 * 60 * 1_000,
    maxBytes: 50 * 1024 * 1024,
    extensions: new Set(["mp4", "mov", "webm"]),
  },
  speech: {
    points: null,
    useLimit: 1,
    cooldownMs: 4 * 60 * 60 * 1_000,
    maxBytes: 0,
    extensions: new Set<string>(),
  },
} as const;

export interface ReuseCheckInput {
  submissionType: SubmissionType;
  candidateEntryId: string;
  raceId: string;
  previousUses: Array<{
    candidateEntryId: string;
    raceId: string;
    submitterUserId: string;
    createdAt: Date;
  }>;
  now?: Date;
}

export type ReuseCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "different-candidate" | "different-race" | "limit" | "cooldown";
      priorSubmitterUserId: string;
      retryAt?: Date;
    };

export function normalizeSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function speechPoints(text: string): number {
  const length = [...text].length;
  if (length < 1 || length > 2_000) {
    throw new Error("Speeches must contain between 1 and 2,000 characters.");
  }
  return Math.ceil(length / 500);
}

export function hashSpeech(text: string): string {
  return createHash("sha256").update(normalizeSpeech(text), "utf8").digest("hex");
}

export function fileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}

export function validateAttachment(
  type: "poster" | "video",
  filename: string,
  size: number,
): void {
  const rule = SUBMISSION_RULES[type];
  const extension = fileExtension(filename);
  if (!rule.extensions.has(extension)) {
    throw new Error(
      `${type === "poster" ? "Posters" : "Videos"} must use one of: ` +
        [...rule.extensions].map((item) => `.${item}`).join(", "),
    );
  }
  if (size < 1 || size > rule.maxBytes) {
    const maxMb = rule.maxBytes / (1024 * 1024);
    throw new Error(
      `${type === "poster" ? "Poster" : "Video"} files must be no larger than ${maxMb} MB.`,
    );
  }
}

export function checkReuse(input: ReuseCheckInput): ReuseCheckResult {
  if (input.previousUses.length === 0) {
    return { allowed: true };
  }

  const first = input.previousUses[0];
  if (!first) {
    return { allowed: true };
  }
  if (first.candidateEntryId !== input.candidateEntryId) {
    return {
      allowed: false,
      reason: "different-candidate",
      priorSubmitterUserId: first.submitterUserId,
    };
  }
  if (first.raceId !== input.raceId) {
    return {
      allowed: false,
      reason: "different-race",
      priorSubmitterUserId: first.submitterUserId,
    };
  }

  const rule = SUBMISSION_RULES[input.submissionType];
  if (input.previousUses.length >= rule.useLimit) {
    return {
      allowed: false,
      reason: "limit",
      priorSubmitterUserId: first.submitterUserId,
    };
  }

  const latest = input.previousUses.reduce((left, right) =>
    left.createdAt > right.createdAt ? left : right,
  );
  const retryAt = new Date(latest.createdAt.getTime() + rule.cooldownMs);
  if (retryAt.getTime() > (input.now ?? new Date()).getTime()) {
    return {
      allowed: false,
      reason: "cooldown",
      priorSubmitterUserId: latest.submitterUserId,
      retryAt,
    };
  }

  return { allowed: true };
}

export function calculateResults(
  candidates: readonly ResultCandidateInput[],
): ResultCandidateOutput[] {
  const totalVotes = candidates.reduce((sum, item) => sum + item.rawVotes, 0);
  const totalCampaignPoints = candidates.reduce(
    (sum, item) => sum + item.campaignPoints,
    0,
  );

  return candidates.map((candidate) => {
    const voteShare =
      totalVotes === 0 ? 0 : candidate.rawVotes / totalVotes;
    const campaignShare =
      totalCampaignPoints === 0
        ? 0
        : candidate.campaignPoints / totalCampaignPoints;
    const voteComponent = voteShare * 60;
    const campaignComponent = campaignShare * 40;

    return {
      ...candidate,
      voteShare,
      campaignShare,
      voteComponent,
      campaignComponent,
      finalPercentage:
        voteComponent + campaignComponent + candidate.adjustments,
    };
  });
}

export function determineWinner(
  results: readonly ResultCandidateOutput[],
  epsilon = 0.000_001,
):
  | { kind: "none" }
  | { kind: "winner"; result: ResultCandidateOutput }
  | { kind: "tie"; results: ResultCandidateOutput[] } {
  if (results.length === 0) {
    return { kind: "none" };
  }

  const sorted = [...results].sort(
    (left, right) => right.finalPercentage - left.finalPercentage,
  );
  const highest = sorted[0];
  if (!highest) {
    return { kind: "none" };
  }
  const tied = sorted.filter(
    (item) =>
      Math.abs(item.finalPercentage - highest.finalPercentage) <= epsilon,
  );
  if (tied.length > 1) {
    return { kind: "tie", results: tied };
  }
  return { kind: "winner", result: highest };
}
