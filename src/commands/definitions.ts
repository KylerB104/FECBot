import {
  ApplicationCommandOptionType,
  SlashCommandBuilder,
} from "discord.js";
import { COMMONWEALTHS } from "../geography.js";
import { IDEOLOGY_VALUES, PARTY_VALUES } from "../types.js";

const partyLabels: Record<(typeof PARTY_VALUES)[number], string> = {
  democratic: "Democratic",
  republican: "Republican",
  reform: "Reform",
  independent: "Independent",
};

const ideologyLabels: Record<(typeof IDEOLOGY_VALUES)[number], string> = {
  progressive: "Progressive",
  "social-democratic": "Social Democratic",
  liberal: "Liberal",
  centrist: "Centrist",
  moderate: "Moderate",
  conservative: "Conservative",
  libertarian: "Libertarian",
  populist: "Populist",
  nationalist: "Nationalist",
  other: "Other",
};

const candidate = new SlashCommandBuilder()
  .setName("candidate")
  .setDescription("Register and view election candidates")
  .addSubcommand((command) =>
    command
      .setName("register")
      .setDescription("Register yourself as a candidate during signup")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Office you are seeking")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Candidate name shown publicly")
          .setMinLength(1)
          .setMaxLength(80)
          .setRequired(true),
      )
      .addStringOption((option) => {
        option
          .setName("party")
          .setDescription("Political party")
          .setRequired(true);
        for (const value of PARTY_VALUES) {
          option.addChoices({ name: partyLabels[value], value });
        }
        return option;
      })
      .addStringOption((option) => {
        option
          .setName("ideology")
          .setDescription("Political ideology")
          .setRequired(true);
        for (const value of IDEOLOGY_VALUES) {
          option.addChoices({ name: ideologyLabels[value], value });
        }
        return option;
      })
      .addStringOption((option) =>
        option
          .setName("home-state")
          .setDescription("Home state")
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("withdraw")
      .setDescription("Withdraw your candidacy")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("list")
      .setDescription("Show registered candidates")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Optionally limit the list to one race")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("view")
      .setDescription("View a candidate profile")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate")
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("running-mate")
      .setDescription("Invite a running mate after the FEC marks you as nominee")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Presidential election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Proposed running mate")
          .setRequired(true),
      ),
  );

const campaign = new SlashCommandBuilder()
  .setName("campaign")
  .setDescription("Submit and review campaign activity")
  .addSubcommand((command) =>
    command
      .setName("submit")
      .setDescription("Preview a campaign submission before confirming it")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Open campaign cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Race receiving the campaign")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate receiving the campaign")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("state")
          .setDescription("One of the 50 United States")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Campaign type")
          .setRequired(true)
          .addChoices(
            { name: "Poster — 1 point", value: "poster" },
            { name: "Video advertisement — 2 points", value: "video" },
            { name: "Speech — 1 point per 500 characters", value: "speech" },
          ),
      )
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription("Required for posters and videos"),
      )
      .addStringOption((option) =>
        option
          .setName("speech")
          .setDescription("Required for speeches; maximum 2,000 characters")
          .setMaxLength(2_000),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("history")
      .setDescription("View public submission history without private point totals")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Optionally limit history to one candidate")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((command) =>
    command.setName("calendar").setDescription("Show current election-cycle phases"),
  )
  .addSubcommand((command) =>
    command.setName("help").setDescription("Explain campaign rules and commands"),
  );

const fec = new SlashCommandBuilder()
  .setName("fec")
  .setDescription("Election-administrator commands")
  .addSubcommand((command) =>
    command
      .setName("cycle-create")
      .setDescription("Create a cycle and its races")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Unique public cycle name")
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("kind")
          .setDescription("Presidential or midterm election")
          .setRequired(true)
          .addChoices(
            { name: "Presidential", value: "presidential" },
            { name: "Midterm", value: "midterm" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("senate-class")
          .setDescription("Senate class appearing in this cycle")
          .setMinValue(1)
          .setMaxValue(3)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("governors")
          .setDescription("Comma-separated regions, all, or none")
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("cycle-phase")
      .setDescription("Advance, pause, resume, or close an election cycle")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("phase")
          .setDescription("New phase")
          .setRequired(true)
          .addChoices(
            { name: "Signup open", value: "signup" },
            { name: "Primary campaigning", value: "primary_campaign" },
            { name: "Primary results", value: "primary_results" },
            { name: "General campaigning", value: "general_campaign" },
            { name: "General results", value: "general_results" },
            { name: "Paused", value: "paused" },
            { name: "Resume previous phase", value: "resume" },
            { name: "Closed", value: "closed" },
          ),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("deadline-set")
      .setDescription("Set an election deadline in Eastern Time")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("deadline")
          .setDescription("Deadline type")
          .setRequired(true)
          .addChoices(
            { name: "Candidate signup closes", value: "signup" },
            {
              name: "Primary campaigning closes",
              value: "primary_campaign",
            },
            { name: "Primary voting closes", value: "primary_voting" },
            {
              name: "General campaigning closes",
              value: "general_campaign",
            },
            { name: "General voting closes", value: "general_voting" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("when")
          .setDescription("Eastern Time: YYYY-MM-DD HH:MM, such as 2026-08-15 20:00")
          .setMinLength(16)
          .setMaxLength(16)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("cycle-delete")
      .setDescription("Permanently delete a closed election cycle")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Closed election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("confirm-name")
          .setDescription("Type the cycle name exactly to confirm deletion")
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Required audit explanation")
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("candidate-status")
      .setDescription("Withdraw, disqualify, or reactivate a candidate")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("status")
          .setDescription("New candidate status")
          .setRequired(true)
          .addChoices(
            { name: "Active", value: "active" },
            { name: "Withdrawn", value: "withdrawn" },
            { name: "Disqualified", value: "disqualified" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Required audit explanation")
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("candidate-add")
      .setDescription("Add a replacement or write-in candidate outside signup")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Race")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Public candidate or write-in name")
          .setMinLength(1)
          .setMaxLength(80)
          .setRequired(true),
      )
      .addStringOption((option) => {
        option
          .setName("party")
          .setDescription("Political party")
          .setRequired(true);
        for (const value of PARTY_VALUES) {
          option.addChoices({ name: partyLabels[value], value });
        }
        return option;
      })
      .addStringOption((option) => {
        option
          .setName("ideology")
          .setDescription("Political ideology")
          .setRequired(true);
        for (const value of IDEOLOGY_VALUES) {
          option.addChoices({ name: ideologyLabels[value], value });
        }
        return option;
      })
      .addStringOption((option) =>
        option
          .setName("home-state")
          .setDescription("Home state")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Required audit explanation")
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true),
      )
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Replacement member; omit for a write-in"),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("nominee-set")
      .setDescription("Mark or unmark a general-election nominee")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("is-nominee")
          .setDescription("Whether this candidate is the recognized nominee")
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("adjustment-add")
      .setDescription("Add a percentage-point buff or debuff with a reason")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Race")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addNumberOption((option) =>
        option
          .setName("percentage-points")
          .setDescription("Positive buff or negative debuff")
          .setMinValue(-100)
          .setMaxValue(100)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Required audit explanation")
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("votes-enter")
      .setDescription("Set a candidate's raw vote total")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Nonpresidential race")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("candidate")
          .setDescription("Candidate")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("votes")
          .setDescription("Raw votes; entering again replaces the prior total")
          .setMinValue(0)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("results")
      .setDescription("Calculate or publish a race result")
      .addStringOption((option) =>
        option
          .setName("cycle")
          .setDescription("Election cycle")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("race")
          .setDescription("Race")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Preview or publish the result")
          .setRequired(true)
          .addChoices(
            { name: "Calculate preview", value: "calculate" },
            { name: "Publish", value: "publish" },
          ),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("audit-export")
      .setDescription("Export the server's FEC audit history as a private CSV"),
  )
  .addSubcommand((command) =>
    command
      .setName("status")
      .setDescription("Show the bot and database status"),
  );

export const commandDefinitions = [candidate, campaign, fec].map((command) =>
  command.toJSON(),
);

// Compile-time guard: Discord permits at most 25 options per command.
for (const command of commandDefinitions) {
  const options = command.options ?? [];
  if (options.length > 25) {
    throw new Error(`${command.name} defines too many top-level options.`);
  }
  for (const option of options) {
    if (
      option.type === ApplicationCommandOptionType.Subcommand &&
      (option.options?.length ?? 0) > 25
    ) {
      throw new Error(`${command.name} ${option.name} defines too many options.`);
    }
  }
}

export const governorHelp = COMMONWEALTHS.map((item) => item.name).join(", ");
