import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../src/commands/definitions.js";

function fecSubcommand(name: string) {
  const fec = commandDefinitions.find((command) => command.name === "fec");
  const option = fec?.options?.find((item) => item.name === name);
  if (!option || !("options" in option)) {
    throw new Error(`Missing /fec ${name} command`);
  }
  return option;
}

describe("integrated election commands", () => {
  it("creates one election without a separate primary/general option", () => {
    const command = fecSubcommand("cycle-create");
    expect(command.options?.map((option) => option.name)).toEqual([
      "name",
      "kind",
      "senate-class",
      "governors",
    ]);
  });

  it("exposes the integrated primary-to-general phase sequence", () => {
    const command = fecSubcommand("cycle-phase");
    const phase = command.options?.find((option) => option.name === "phase");
    expect(phase && "choices" in phase ? phase.choices?.map((item) => item.value) : []).toEqual([
      "signup",
      "primary_campaign",
      "primary_results",
      "general_campaign",
      "general_results",
      "paused",
      "resume",
      "closed",
    ]);
  });

  it("provides permanent closed-cycle deletion with confirmation", () => {
    const command = fecSubcommand("cycle-delete");
    expect(command.options?.map((option) => option.name)).toEqual([
      "cycle",
      "confirm-name",
      "reason",
    ]);
  });

  it("defines separate primary and general deadlines", () => {
    const command = fecSubcommand("deadline-set");
    const deadline = command.options?.find(
      (option) => option.name === "deadline",
    );
    expect(
      deadline && "choices" in deadline
        ? deadline.choices?.map((item) => item.value)
        : [],
    ).toEqual([
      "signup",
      "primary_campaign",
      "primary_voting",
      "general_campaign",
      "general_voting",
    ]);
  });
});
