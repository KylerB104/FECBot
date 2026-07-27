import { describe, expect, it } from "vitest";
import {
  calculateResults,
  checkReuse,
  determineWinner,
  hashSpeech,
  normalizeSpeech,
  speechPoints,
  validateAttachment,
} from "../src/domain.js";

describe("speech rules", () => {
  it.each([
    [1, 1],
    [500, 1],
    [501, 2],
    [1_000, 2],
    [1_001, 3],
    [1_500, 3],
    [1_501, 4],
    [2_000, 4],
  ])("awards %i characters %i point(s)", (length, expected) => {
    expect(speechPoints("a".repeat(length))).toBe(expected);
  });

  it("rejects empty and overlong speeches", () => {
    expect(() => speechPoints("")).toThrow(/between 1 and 2,000/);
    expect(() => speechPoints("a".repeat(2_001))).toThrow(
      /between 1 and 2,000/,
    );
  });

  it("normalizes case, spaces, and punctuation for duplicate detection", () => {
    const first = "A Better Union!";
    const second = "a---better      union";
    expect(normalizeSpeech(first)).toBe("abetterunion");
    expect(hashSpeech(first)).toBe(hashSpeech(second));
  });
});

describe("attachment rules", () => {
  it("accepts configured poster and video formats", () => {
    expect(() => validateAttachment("poster", "design.WEBP", 10)).not.toThrow();
    expect(() => validateAttachment("video", "ad.mp4", 10)).not.toThrow();
  });

  it("rejects GIFs and oversized files", () => {
    expect(() => validateAttachment("poster", "design.gif", 10)).toThrow(
      /must use one of/,
    );
    expect(() =>
      validateAttachment("poster", "design.png", 10 * 1024 * 1024 + 1),
    ).toThrow(/no larger than 10 MB/);
  });
});

describe("reuse enforcement", () => {
  const baseUse = {
    candidateEntryId: "candidate-a",
    raceId: "race-a",
    submitterUserId: "user-a",
    createdAt: new Date("2026-07-01T12:00:00Z"),
  };

  it("allows first use", () => {
    expect(
      checkReuse({
        submissionType: "poster",
        candidateEntryId: "candidate-a",
        raceId: "race-a",
        previousUses: [],
      }),
    ).toEqual({ allowed: true });
  });

  it("locks content to its first candidate", () => {
    expect(
      checkReuse({
        submissionType: "poster",
        candidateEntryId: "candidate-b",
        raceId: "race-a",
        previousUses: [baseUse],
      }),
    ).toMatchObject({
      allowed: false,
      reason: "different-candidate",
      priorSubmitterUserId: "user-a",
    });
  });

  it("locks content to its first race", () => {
    expect(
      checkReuse({
        submissionType: "poster",
        candidateEntryId: "candidate-a",
        raceId: "race-b",
        previousUses: [baseUse],
      }),
    ).toMatchObject({ allowed: false, reason: "different-race" });
  });

  it("enforces the per-item cooldown across the server", () => {
    const result = checkReuse({
      submissionType: "poster",
      candidateEntryId: "candidate-a",
      raceId: "race-a",
      previousUses: [baseUse],
      now: new Date("2026-07-01T12:59:59Z"),
    });
    expect(result).toMatchObject({ allowed: false, reason: "cooldown" });
  });

  it("allows a poster reuse after cooldown and before the eighth use", () => {
    expect(
      checkReuse({
        submissionType: "poster",
        candidateEntryId: "candidate-a",
        raceId: "race-a",
        previousUses: [baseUse],
        now: new Date("2026-07-01T13:00:00Z"),
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects a ninth poster use", () => {
    const priorUses = Array.from({ length: 8 }, (_, index) => ({
      ...baseUse,
      createdAt: new Date(`2026-07-0${index + 1}T12:00:00Z`),
    }));
    expect(
      checkReuse({
        submissionType: "poster",
        candidateEntryId: "candidate-a",
        raceId: "race-a",
        previousUses: priorUses,
        now: new Date("2026-07-20T12:00:00Z"),
      }),
    ).toMatchObject({ allowed: false, reason: "limit" });
  });
});

describe("60/40 election scoring", () => {
  it("calculates vote and campaign shares as percentage-point components", () => {
    const results = calculateResults([
      {
        candidateEntryId: "a",
        displayName: "Candidate A",
        rawVotes: 55,
        campaignPoints: 40,
        adjustments: 0,
      },
      {
        candidateEntryId: "b",
        displayName: "Candidate B",
        rawVotes: 45,
        campaignPoints: 60,
        adjustments: 0,
      },
    ]);
    expect(results[0]).toMatchObject({
      voteComponent: 33,
      campaignComponent: 16,
      finalPercentage: 49,
    });
    expect(results[1]).toMatchObject({
      voteComponent: 27,
      campaignComponent: 24,
      finalPercentage: 51,
    });
  });

  it("contributes zero campaign percentage when nobody campaigns", () => {
    const [result] = calculateResults([
      {
        candidateEntryId: "a",
        displayName: "Candidate A",
        rawVotes: 10,
        campaignPoints: 0,
        adjustments: 0,
      },
    ]);
    expect(result?.voteComponent).toBe(60);
    expect(result?.campaignComponent).toBe(0);
    expect(result?.finalPercentage).toBe(60);
  });

  it("applies percentage-point adjustments after the 60/40 components", () => {
    const [result] = calculateResults([
      {
        candidateEntryId: "a",
        displayName: "Candidate A",
        rawVotes: 10,
        campaignPoints: 10,
        adjustments: -3,
      },
    ]);
    expect(result?.finalPercentage).toBe(97);
  });

  it("reports ties to the FEC rather than resolving them randomly", () => {
    const results = calculateResults([
      {
        candidateEntryId: "a",
        displayName: "A",
        rawVotes: 10,
        campaignPoints: 10,
        adjustments: 0,
      },
      {
        candidateEntryId: "b",
        displayName: "B",
        rawVotes: 10,
        campaignPoints: 10,
        adjustments: 0,
      },
    ]);
    expect(determineWinner(results)).toMatchObject({ kind: "tie" });
  });
});
