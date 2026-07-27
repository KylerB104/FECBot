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
- One integrated primary-to-general sequence inside each election cycle
- Draft, signup, primary campaign, primary results, general campaign, general
  results, paused, and closed phases
- Permanent closed-cycle deletion with exact-name confirmation
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
- Content locked to its first candidate and race during the current election
  phase
- Primary submissions, points, votes, adjustments, and duplicate-use records
  permanently reset when general campaigning opens
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
- Separate signup, primary campaign, primary voting, general campaign, and
  general voting deadlines with 24-hour, 6-hour, and 1-hour notices
- State targeting restricted to the official commonwealth or House district
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
- `/fec cycle-delete`
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

1. The Secretary creates one election with `/fec cycle-create`.
2. The FEC sets signup and separate primary/general deadlines.
3. The FEC opens `signup`; citizens register with `/candidate register`.
4. The FEC advances to `primary_campaign`; citizens campaign.
5. The FEC advances to `primary_results`, enters nonpresidential votes, and
   previews then publishes every primary result.
6. Published Governor, Senate, and House primary winners automatically qualify
   for the general. The FEC marks presidential nominees with `/fec nominee-set`.
7. The FEC advances to `general_campaign`. This permanently deletes primary
   submissions, points, vote totals, adjustments, and duplicate-use records.
8. General-election campaign scoring begins from zero.
9. The FEC advances to `general_results`, enters votes, previews results, and
   publishes them. Presidential races instead produce the private state-by-state
   campaign-point CSV.
10. The FEC closes the cycle. A closed cycle can later be permanently deleted
    with `/fec cycle-delete`.

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

## Geography enforcement

Campaign targets are always the real 50 United States. The race itself determines
where points are aggregated:

- President: each state is reported separately
- Governor and Senate: only states assigned to that commonwealth are accepted
- House: only states assigned to that exact district are accepted

The complete official mapping is stored in `config/geography.json` and loaded by
default. State autocomplete filters its choices after the user selects a race,
and the server validates the assignment again before recording a submission.
Presidential campaigning remains available in all 50 states. D.C. is part of
Franklin District 5 for project reference but is not a campaign target because
the bot targets the 50 states only.

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
results, adjustments, ties, integrated election commands, all 50 state
assignments, five commonwealths, and 21 districts.
