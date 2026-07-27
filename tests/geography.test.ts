import { describe, expect, it } from "vitest";
import {
  buildRaceSeeds,
  COMMONWEALTHS,
  normalizeCommonwealthList,
  UNITED_STATES,
} from "../src/geography.js";
import { validateStateForRace } from "../src/services/geography-config.js";

describe("federal geography", () => {
  it("contains exactly 50 states", () => {
    expect(UNITED_STATES).toHaveLength(50);
    expect(new Set(UNITED_STATES).size).toBe(50);
  });

  it("contains five commonwealths and 21 House districts", () => {
    expect(COMMONWEALTHS).toHaveLength(5);
    expect(
      COMMONWEALTHS.reduce((sum, region) => sum + region.houseDistricts, 0),
    ).toBe(21);
  });

  it("builds all expected presidential-cycle races", () => {
    const races = buildRaceSeeds(
      "presidential",
      2,
      normalizeCommonwealthList("Sierra, Franklin"),
    );
    expect(races.filter((race) => race.officeType === "president")).toHaveLength(
      1,
    );
    expect(races.filter((race) => race.officeType === "governor")).toHaveLength(
      2,
    );
    expect(races.filter((race) => race.officeType === "senate")).toHaveLength(5);
    expect(races.filter((race) => race.officeType === "house")).toHaveLength(21);
    expect(races).toHaveLength(29);
  });

  it("omits president from a midterm cycle", () => {
    const races = buildRaceSeeds("midterm", 1, []);
    expect(races.some((race) => race.officeType === "president")).toBe(false);
    expect(races).toHaveLength(26);
  });
});

describe("configured state-to-race validation", () => {
  const geography = new Map([
    [
      "California",
      { commonwealth: "Sierra", houseDistrict: "Sierra D2" },
    ],
  ]);

  it("allows presidential campaigning in every state", () => {
    expect(() =>
      validateStateForRace(geography, "California", {
        office_type: "president",
        commonwealth: null,
        district_number: null,
      }),
    ).not.toThrow();
  });

  it("enforces commonwealth assignment for governor and Senate", () => {
    expect(() =>
      validateStateForRace(geography, "California", {
        office_type: "governor",
        commonwealth: "Franklin",
        district_number: null,
      }),
    ).toThrow(/assigned to Sierra/);
  });

  it("enforces House-district assignment", () => {
    expect(() =>
      validateStateForRace(geography, "California", {
        office_type: "house",
        commonwealth: "Sierra",
        district_number: 1,
      }),
    ).toThrow(/assigned to Sierra D2/);
  });
});
