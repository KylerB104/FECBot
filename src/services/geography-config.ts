import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { COMMONWEALTHS, UNITED_STATES } from "../geography.js";

const assignmentSchema = z.object({
  commonwealth: z.string().nullable(),
  houseDistrict: z.string().nullable(),
});

const geographySchema = z.record(z.string(), z.unknown());

export interface StateAssignment {
  commonwealth: string | null;
  houseDistrict: string | null;
}

export type StateGeography = Map<string, StateAssignment>;

export async function loadStateGeography(
  filename: string | null,
): Promise<StateGeography> {
  if (!filename) return new Map();
  const absolute = isAbsolute(filename) ? filename : resolve(process.cwd(), filename);
  const parsed = geographySchema.parse(
    JSON.parse(await readFile(absolute, "utf8")) as unknown,
  );
  const allowedStates = new Set<string>(UNITED_STATES);
  const allowedCommonwealths = new Set<string>(
    COMMONWEALTHS.map((region) => region.name),
  );
  const result = new Map<string, StateAssignment>();

  for (const [state, rawAssignment] of Object.entries(parsed)) {
    if (state.startsWith("_")) continue;
    const assignment = assignmentSchema.parse(rawAssignment);
    if (!allowedStates.has(state)) {
      throw new Error(`Geography file contains an unknown state: ${state}`);
    }
    if (
      assignment.commonwealth &&
      !allowedCommonwealths.has(assignment.commonwealth)
    ) {
      throw new Error(
        `Geography file assigns ${state} to an unknown commonwealth: ${assignment.commonwealth}`,
      );
    }
    if (assignment.houseDistrict) {
      const match =
        /^(Sierra|Amarillo|Franklin|Lincoln|Dixieland) D([1-5])$/.exec(
          assignment.houseDistrict,
        );
      const region = match
        ? COMMONWEALTHS.find((item) => item.name === match[1])
        : undefined;
      const districtNumber = Number(match?.[2] ?? 0);
      if (!region || districtNumber < 1 || districtNumber > region.houseDistricts) {
        throw new Error(
          `Geography file gives ${state} an invalid House district: ${assignment.houseDistrict}`,
        );
      }
      if (
        assignment.commonwealth &&
        region.name !== assignment.commonwealth
      ) {
        throw new Error(
          `Geography file gives ${state} conflicting commonwealth and House district assignments.`,
        );
      }
    }
    result.set(state, assignment);
  }
  return result;
}

export function validateStateForRace(
  geography: StateGeography,
  state: string,
  race: {
    office_type: "president" | "governor" | "senate" | "house";
    commonwealth: string | null;
    district_number: number | null;
  },
): void {
  if (race.office_type === "president") return;
  const assignment = geography.get(state);
  if (!assignment) return;

  if (
    (race.office_type === "governor" || race.office_type === "senate") &&
    assignment.commonwealth &&
    assignment.commonwealth !== race.commonwealth
  ) {
    throw new Error(
      `${state} is assigned to ${assignment.commonwealth}, not ${race.commonwealth}.`,
    );
  }
  if (
    race.office_type === "house" &&
    assignment.houseDistrict &&
    assignment.houseDistrict !== `${race.commonwealth} D${race.district_number}`
  ) {
    throw new Error(
      `${state} is assigned to ${assignment.houseDistrict}, not ` +
        `${race.commonwealth} D${race.district_number}.`,
    );
  }
}
