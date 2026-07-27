import type { OfficeType } from "./types.js";

export const UNITED_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
] as const;

export type StateName = (typeof UNITED_STATES)[number];

export const COMMONWEALTHS = [
  { key: "sierra", name: "Sierra", houseDistricts: 5 },
  { key: "amarillo", name: "Amarillo", houseDistricts: 2 },
  { key: "franklin", name: "Franklin", houseDistricts: 5 },
  { key: "lincoln", name: "Lincoln", houseDistricts: 4 },
  { key: "dixieland", name: "Dixieland", houseDistricts: 5 },
] as const;

export type CommonwealthKey = (typeof COMMONWEALTHS)[number]["key"];

export interface RaceSeed {
  raceKey: string;
  displayName: string;
  officeType: OfficeType;
  commonwealth: string | null;
  districtNumber: number | null;
  senateClass: number | null;
}

export function normalizeCommonwealthList(value: string): CommonwealthKey[] {
  const requested = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (requested.includes("none") || requested.length === 0) {
    return [];
  }
  if (requested.includes("all")) {
    return COMMONWEALTHS.map((item) => item.key);
  }

  const allowed = new Set(COMMONWEALTHS.map((item) => item.key));
  const unknown = requested.filter((item) => !allowed.has(item as CommonwealthKey));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown commonwealth${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
        `Use Sierra, Amarillo, Franklin, Lincoln, Dixieland, all, or none.`,
    );
  }
  return [...new Set(requested)] as CommonwealthKey[];
}

export function buildRaceSeeds(
  electionKind: "presidential" | "midterm",
  senateClass: number,
  governorRegions: readonly CommonwealthKey[],
): RaceSeed[] {
  const races: RaceSeed[] = [];

  if (electionKind === "presidential") {
    races.push({
      raceKey: "president",
      displayName: "President of the United States",
      officeType: "president",
      commonwealth: null,
      districtNumber: null,
      senateClass: null,
    });
  }

  for (const region of COMMONWEALTHS) {
    if (governorRegions.includes(region.key)) {
      races.push({
        raceKey: `${region.key}-governor`,
        displayName: `Governor of ${region.name}`,
        officeType: "governor",
        commonwealth: region.name,
        districtNumber: null,
        senateClass: null,
      });
    }

    races.push({
      raceKey: `${region.key}-senate-${senateClass}`,
      displayName: `${region.name} Senate — Class ${romanNumeral(senateClass)}`,
      officeType: "senate",
      commonwealth: region.name,
      districtNumber: null,
      senateClass,
    });

    for (let district = 1; district <= region.houseDistricts; district += 1) {
      races.push({
        raceKey: `${region.key}-house-${district}`,
        displayName: `${region.name} House District ${district}`,
        officeType: "house",
        commonwealth: region.name,
        districtNumber: district,
        senateClass: null,
      });
    }
  }

  return races;
}

export function romanNumeral(value: number): string {
  return ["I", "II", "III"][value - 1] ?? String(value);
}

export function findState(input: string): StateName | null {
  const normalized = input.trim().toLowerCase();
  return (
    UNITED_STATES.find((state) => state.toLowerCase() === normalized) ?? null
  );
}
