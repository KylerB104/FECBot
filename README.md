# The Federalist Project — FEC Bot

A PostgreSQL-backed Discord bot for candidate registration, campaign submissions,
duplicate enforcement, election administration, and 60/40 election results.

The bot is configured for **The Federalist Project** by default. It does not store
campaign media on its own disk. It temporarily reads each attachment to calculate
a SHA-256 fingerprint, then stores the fingerprint, Discord message reference,
submission metadata, and awarded points.

## Implemented rules

- One server with the configured Citizen, FEC administrator, and owner permissions
- Five commonwealths: Sierra, Amarillo, Franklin, Lincoln, and Dixieland
- 21 House districts
- One governor and three Senate classes per commonwealth
- Presidential and midterm cycles with separate primary/general stages
- One Senate class and selected governor races configured when a cycle is created
- One active race per candidate in each cycle
- Democratic, Republican, Reform, and Independent parties
- Presidential running-mate invitation and required acceptance
- FEC-added replacements and write-ins
- Posters: 1 point, 10 MB, eight uses, one-hour per-item cooldown
- Video advertisements: 2 points, 50 MB, five uses, two-hour per-item cooldown
- Speeches: 1–4 points, one point per 500 characters, 2,000-character maximum,
  one use
- Exact-file hashing and normalized copied-speech detection
- Content locked to its first candidate and race for the cycle
- Different original content may be submitted immediately
- Public preview with Confirm and Cancel buttons
- FEC duplicate exceptions with a required audit reason
- Presidential home-state bonus of 20 campaign points
- Private presidential FEC reports show only campaign points for every candidate
  in every state, exported as CSV; the bot never declares a presidential winner
- Governor, Senate, and House results use 60% raw vote share and 40% campaign
  point share
- Primary results are calculated separately by party
- Percentage-point buffs and debuffs with required reasons
- Ties are reported to the FEC and never resolved randomly
- Signup, campaign, and voting deadlines with 24-hour, 6-hour, and 1-hour notices
- Full PostgreSQL audit history

## Discord commands

### Candidate commands

- `/candidate register`
- `/candidate withdraw`
- `/candidate list`
- `/candidate view`
- `/candidate running-mate`

### Campaign commands

- `/campaign submit`
- `/campaign history`
- `/campaign calendar`
- `/campaign help`

### FEC commands

- `/fec cycle-create`
- `/fec cycle-phase`
- `/fec deadline-set`
- `/fec candidate-add`
- `/fec candidate-status`
- `/fec nominee-set`
- `/fec adjustment-add`
- `/fec votes-enter`
- `/fec results`
- `/fec audit-export`
- `/fec status`

## Normal election workflow

1. An election administrator creates a cycle with `/fec cycle-create`.
2. The FEC sets deadlines with `/fec deadline-set`.
3. The FEC changes the phase to `signup` with `/fec cycle-phase`.
4. Citizens register using `/candidate register`.
5. The FEC changes the phase to `campaign`.
6. Citizens use `/campaign submit` in the configured campaign channel.
7. For nonpresidential races, the FEC enters each candidate's raw votes with
   `/fec votes-enter`.
8. The FEC adds any approved buffs or debuffs with `/fec adjustment-add`.
9. The FEC privately checks the result using `/fec results` with the Calculate
   action.
10. The FEC repeats `/fec results` with the Publish action when ready.
11. Presidential cycles instead produce a candidate-by-state campaign-point CSV.
12. The FEC closes the cycle using `/fec cycle-phase`.

For a presidential primary, the bot reports campaign points but does not choose a
nominee. The FEC marks the official nominee with `/fec nominee-set`; that candidate
can then use `/candidate running-mate`.

## Local setup

Requirements:

- Node.js 22 or newer
- pnpm
- PostgreSQL
- A Discord application and bot

Install and verify:

```bash
pnpm install
pnpm check
```

Copy `.env.example` to `.env` and fill in:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DATABASE_URL`
- `LOG_CHANNEL_ID` when the staff channel is chosen

Never paste the Discord token into chat, place it in source code, or commit `.env`.

Start development:

```bash
pnpm dev
```

Database migrations run automatically at startup.

## Discord application permissions

Install the application in the configured server with:

- `bot`
- `applications.commands`

The bot needs permission to:

- View the campaign and staff-log channels
- Send messages
- Embed links
- Attach files
- Read message history

It does not need Administrator permission.

## Railway deployment

1. Put this project in a private GitHub repository.
2. Create a Railway project from that repository.
3. Add Railway PostgreSQL to the project.
4. Add the environment values from `.env.example` to the bot service.
5. Railway supplies `DATABASE_URL`; set `DATABASE_SSL=true` if required by the
   database connection.
6. Deploy. The included Dockerfile builds and starts the bot.
7. Configure the requested $20 spending ceiling and the $10-and-up alerts in the
   Railway billing controls separately; the bot cannot enforce the hosting bill.

The bot synchronizes its guild slash commands whenever it starts, so command
changes appear without a separate registration step.

## Geography configuration

Campaign targets are always the real 50 United States. The race itself determines
where points are aggregated:

- President: each state is reported separately
- Governor and Senate: points aggregate within the selected commonwealth race
- House: points aggregate within the selected district race

Until the FEC supplies exact assignments, the bot accepts any state selected for
any race. To turn on geographic validation:

1. Copy `config/geography.example.json` to `config/geography.json`.
2. Fill in each state's `commonwealth` and `houseDistrict`.
3. Set `GEOGRAPHY_FILE=config/geography.json`.
4. Restart the bot.

Example:

```json
{
  "Example State": {
    "commonwealth": "Sierra",
    "houseDistrict": "Sierra D2"
  }
}
```

Use real state names in the actual file. Valid district labels are `Sierra D1`,
`Amarillo D2`, and so forth.

## Data and privacy

Stored:

- Discord user, role-related, channel, message, and attachment IDs
- Candidate profile and election entry data
- Submission metadata and scores
- SHA-256 fingerprints
- Speech text
- Attachment URLs and filenames
- Vote totals, adjustments, results, and audit events

Not stored locally:

- Poster or video file contents

Discord attachment links may eventually become unavailable. The database record
and fingerprint remain, but the original media may not. External backup storage
can be added later if permanent media preservation becomes necessary.

## Verification

`pnpm check` performs:

- Strict TypeScript checking
- Automated rule tests
- Production compilation

The tests cover all scoring boundaries, normalized speech fingerprints, allowed
file types, file-size limits, item ownership, cooldowns, reuse limits, no-campaign
results, adjustments, ties, the 50-state list, five commonwealths, and 21 districts.
