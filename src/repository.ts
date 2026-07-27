import { randomUUID } from "node:crypto";
import { checkReuse } from "./domain.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";
import type { RaceSeed } from "./geography.js";
import type {
  CampaignSubmissionRow,
  CandidateEntryRow,
  CyclePhase,
  CycleRow,
  ElectionKind,
  ElectionStage,
  Party,
  PendingSubmissionRow,
  RaceRow,
  ResultCandidateInput,
  SubmissionType,
} from "./types.js";

interface AuditInput {
  guildId: string;
  actorUserId?: string | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export interface CreateCycleInput {
  guildId: string;
  name: string;
  electionKind: ElectionKind;
  stage: ElectionStage;
  senateClass: number;
  governorRegions: string[];
  createdByUserId: string;
  races: RaceSeed[];
}

export interface RegisterCandidateInput {
  guildId: string;
  discordUserId: string;
  displayName: string;
  party: Party;
  ideology: string;
  homeState: string;
  cycleId: string;
  raceId: string;
}

export interface CreatePendingSubmissionInput {
  guildId: string;
  cycleId: string;
  raceId: string;
  candidateEntryId: string;
  submitterUserId: string;
  targetState: string;
  submissionType: SubmissionType;
  contentHash: string;
  contentText?: string | null;
  attachmentId?: string | null;
  attachmentName?: string | null;
  attachmentContentType?: string | null;
  attachmentSizeBytes?: number | null;
  attachmentUrl?: string | null;
  points: number;
  responseChannelId: string;
}

export type ConfirmSubmissionResult =
  | { accepted: true; submission: CampaignSubmissionRow }
  | {
      accepted: false;
      reason: "different-candidate" | "different-race" | "limit" | "cooldown";
      priorSubmitterUserId: string;
      retryAt?: Date;
    };

const ENTRY_SELECT = `
  SELECT
    ce.id,
    ce.cycle_id,
    ce.race_id,
    ce.candidate_profile_id,
    ce.status,
    ce.is_presidential_nominee,
    ce.running_mate_user_id,
    cp.discord_user_id,
    cp.display_name,
    cp.party,
    cp.ideology,
    cp.home_state,
    r.display_name AS race_display_name,
    r.office_type
  FROM candidate_entries ce
  JOIN candidate_profiles cp ON cp.id = ce.candidate_profile_id
  JOIN races r ON r.id = ce.race_id
`;

export class Repository {
  constructor(private readonly pool: DatabasePool) {}

  async createCycle(input: CreateCycleInput): Promise<CycleRow> {
    return withTransaction(this.pool, async (client) => {
      const cycleId = randomUUID();
      const cycle = await client.query<CycleRow>(
        `INSERT INTO election_cycles (
          id, guild_id, name, election_kind, stage, senate_class,
          governor_regions, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          cycleId,
          input.guildId,
          input.name,
          input.electionKind,
          input.stage,
          input.senateClass,
          input.governorRegions,
          input.createdByUserId,
        ],
      );

      for (const race of input.races) {
        await client.query(
          `INSERT INTO races (
            id, cycle_id, race_key, display_name, office_type,
            commonwealth, district_number, senate_class
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            cycleId,
            race.raceKey,
            race.displayName,
            race.officeType,
            race.commonwealth,
            race.districtNumber,
            race.senateClass,
          ],
        );
      }

      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.createdByUserId,
        eventType: "cycle.created",
        entityType: "cycle",
        entityId: cycleId,
        details: {
          name: input.name,
          electionKind: input.electionKind,
          stage: input.stage,
          senateClass: input.senateClass,
          governorRegions: input.governorRegions,
          raceCount: input.races.length,
        },
      });

      const row = cycle.rows[0];
      if (!row) throw new Error("Cycle creation returned no row.");
      return row;
    });
  }

  async setCyclePhase(
    guildId: string,
    cycleId: string,
    phase: CyclePhase,
    actorUserId: string,
  ): Promise<CycleRow | null> {
    return withTransaction(this.pool, async (client) => {
      const currentResult = await client.query<CycleRow>(
        `SELECT * FROM election_cycles
         WHERE id = $1 AND guild_id = $2
         FOR UPDATE`,
        [cycleId, guildId],
      );
      const current = currentResult.rows[0];
      if (!current) return null;
      if (current.phase === "closed") {
        throw new Error("A closed election cycle cannot be reopened.");
      }
      const allowedTransitions: Record<CyclePhase, CyclePhase[]> = {
        draft: ["signup", "closed"],
        signup: ["campaign", "paused", "closed"],
        campaign: ["paused", "closed"],
        paused: ["signup", "campaign", "closed"],
        closed: [],
      };
      if (
        phase !== current.phase &&
        !allowedTransitions[current.phase].includes(phase)
      ) {
        throw new Error(
          `A cycle cannot move directly from ${current.phase} to ${phase}.`,
        );
      }
      const result = await client.query<CycleRow>(
        `UPDATE election_cycles
         SET phase = $1, updated_at = now()
         WHERE id = $2 AND guild_id = $3
         RETURNING *`,
        [phase, cycleId, guildId],
      );
      const row = result.rows[0] ?? null;
      if (row) {
        await this.insertAudit(client, {
          guildId,
          actorUserId,
          eventType: "cycle.phase_changed",
          entityType: "cycle",
          entityId: cycleId,
          details: { phase },
        });
      }
      return row;
    });
  }

  async setCycleDeadline(input: {
    guildId: string;
    cycleId: string;
    deadlineType: "signup" | "campaign" | "voting";
    deadlineAt: Date;
    actorUserId: string;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const cycle = await client.query<{ phase: CyclePhase }>(
        `SELECT phase FROM election_cycles
         WHERE id = $1 AND guild_id = $2
         FOR UPDATE`,
        [input.cycleId, input.guildId],
      );
      const cycleRow = cycle.rows[0];
      if (!cycleRow) throw new Error("That cycle does not exist.");
      if (cycleRow.phase === "closed") {
        throw new Error("Deadlines cannot be changed after a cycle is closed.");
      }
      const existing = await client.query<{ deadline_at: Date }>(
        `SELECT deadline_at
         FROM cycle_deadlines
         WHERE cycle_id = $1 AND deadline_type = $2
         FOR UPDATE`,
        [input.cycleId, input.deadlineType],
      );
      const existingDeadline = existing.rows[0]?.deadline_at;
      if (
        existingDeadline &&
        input.deadlineAt.getTime() > new Date(existingDeadline).getTime()
      ) {
        throw new Error(
          "Election deadlines may be shortened or corrected earlier, but they cannot be extended.",
        );
      }
      await client.query(
        `INSERT INTO cycle_deadlines (
          id, cycle_id, deadline_type, deadline_at, set_by_user_id
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (cycle_id, deadline_type)
        DO UPDATE SET
          deadline_at = EXCLUDED.deadline_at,
          set_by_user_id = EXCLUDED.set_by_user_id,
          updated_at = now()`,
        [
          randomUUID(),
          input.cycleId,
          input.deadlineType,
          input.deadlineAt,
          input.actorUserId,
        ],
      );
      await client.query(
        `DELETE FROM deadline_reminders
         WHERE cycle_id = $1 AND deadline_type = $2`,
        [input.cycleId, input.deadlineType],
      );
      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        eventType: "cycle.deadline_set",
        entityType: "cycle",
        entityId: input.cycleId,
        details: {
          deadlineType: input.deadlineType,
          deadlineAt: input.deadlineAt.toISOString(),
        },
      });
    });
  }

  async listCycleDeadlines(
    cycleIds: readonly string[],
  ): Promise<
    Array<{
      cycle_id: string;
      deadline_type: "signup" | "campaign" | "voting";
      deadline_at: Date;
    }>
  > {
    if (cycleIds.length === 0) return [];
    const result = await this.pool.query<{
      cycle_id: string;
      deadline_type: "signup" | "campaign" | "voting";
      deadline_at: Date;
    }>(
      `SELECT cycle_id, deadline_type, deadline_at
       FROM cycle_deadlines
       WHERE cycle_id = ANY($1::uuid[])
       ORDER BY deadline_at`,
      [cycleIds],
    );
    return result.rows;
  }

  async getCycleDeadline(
    cycleId: string,
    deadlineType: "signup" | "campaign" | "voting",
  ): Promise<Date | null> {
    const result = await this.pool.query<{ deadline_at: Date }>(
      `SELECT deadline_at
       FROM cycle_deadlines
       WHERE cycle_id = $1 AND deadline_type = $2`,
      [cycleId, deadlineType],
    );
    const value = result.rows[0]?.deadline_at;
    return value ? new Date(value) : null;
  }

  async claimDueDeadlineReminders(
    guildId: string,
    now = new Date(),
  ): Promise<
    Array<{
      cycleId: string;
      cycleName: string;
      deadlineType: "signup" | "campaign" | "voting";
      deadlineAt: Date;
      hoursBefore: 24 | 6 | 1;
    }>
  > {
    return withTransaction(this.pool, async (client) => {
      const deadlines = await client.query<{
        cycle_id: string;
        cycle_name: string;
        deadline_type: "signup" | "campaign" | "voting";
        deadline_at: Date;
      }>(
        `SELECT
          cd.cycle_id,
          ec.name AS cycle_name,
          cd.deadline_type,
          cd.deadline_at
         FROM cycle_deadlines cd
         JOIN election_cycles ec ON ec.id = cd.cycle_id
         WHERE ec.guild_id = $1
           AND ec.phase NOT IN ('closed')
           AND cd.deadline_at > $2
           AND cd.deadline_at <= $2 + interval '24 hours'
         ORDER BY cd.deadline_at`,
        [guildId, now],
      );

      const claimed: Array<{
        cycleId: string;
        cycleName: string;
        deadlineType: "signup" | "campaign" | "voting";
        deadlineAt: Date;
        hoursBefore: 24 | 6 | 1;
      }> = [];
      for (const deadline of deadlines.rows) {
        const hoursRemaining =
          (new Date(deadline.deadline_at).getTime() - now.getTime()) /
          (60 * 60 * 1_000);
        const hoursBefore: 24 | 6 | 1 =
          hoursRemaining <= 1 ? 1 : hoursRemaining <= 6 ? 6 : 24;
        const inserted = await client.query(
          `INSERT INTO deadline_reminders (
            id, cycle_id, deadline_type, hours_before
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (cycle_id, deadline_type, hours_before) DO NOTHING
          RETURNING id`,
          [
            randomUUID(),
            deadline.cycle_id,
            deadline.deadline_type,
            hoursBefore,
          ],
        );
        if (inserted.rowCount) {
          claimed.push({
            cycleId: deadline.cycle_id,
            cycleName: deadline.cycle_name,
            deadlineType: deadline.deadline_type,
            deadlineAt: new Date(deadline.deadline_at),
            hoursBefore,
          });
        }
      }
      return claimed;
    });
  }

  async getCycle(cycleId: string, guildId?: string): Promise<CycleRow | null> {
    const values: string[] = [cycleId];
    let sql = "SELECT * FROM election_cycles WHERE id = $1";
    if (guildId) {
      values.push(guildId);
      sql += " AND guild_id = $2";
    }
    const result = await this.pool.query<CycleRow>(sql, values);
    return result.rows[0] ?? null;
  }

  async listCycles(
    guildId: string,
    phases?: CyclePhase[],
    search?: string,
  ): Promise<CycleRow[]> {
    const conditions = ["guild_id = $1"];
    const values: unknown[] = [guildId];
    if (phases?.length) {
      values.push(phases);
      conditions.push(`phase = ANY($${values.length})`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`name ILIKE $${values.length}`);
    }
    const result = await this.pool.query<CycleRow>(
      `SELECT * FROM election_cycles
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 25`,
      values,
    );
    return result.rows;
  }

  async listRaces(cycleId: string, search?: string): Promise<RaceRow[]> {
    const values: unknown[] = [cycleId];
    let searchClause = "";
    if (search) {
      values.push(`%${search}%`);
      searchClause = `AND display_name ILIKE $${values.length}`;
    }
    const result = await this.pool.query<RaceRow>(
      `SELECT * FROM races
       WHERE cycle_id = $1 ${searchClause}
       ORDER BY
         CASE office_type
           WHEN 'president' THEN 1
           WHEN 'governor' THEN 2
           WHEN 'senate' THEN 3
           WHEN 'house' THEN 4
         END,
         commonwealth NULLS FIRST,
         district_number NULLS FIRST
       LIMIT 25`,
      values,
    );
    return result.rows;
  }

  async getRace(raceId: string): Promise<RaceRow | null> {
    const result = await this.pool.query<RaceRow>(
      "SELECT * FROM races WHERE id = $1",
      [raceId],
    );
    return result.rows[0] ?? null;
  }

  async registerCandidate(
    input: RegisterCandidateInput,
  ): Promise<CandidateEntryRow> {
    return withTransaction(this.pool, async (client) => {
      const profileId = randomUUID();
      const profile = await client.query<{ id: string }>(
        `INSERT INTO candidate_profiles (
          id, guild_id, discord_user_id, display_name, party, ideology, home_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (guild_id, discord_user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          party = EXCLUDED.party,
          ideology = EXCLUDED.ideology,
          home_state = EXCLUDED.home_state,
          updated_at = now()
        RETURNING id`,
        [
          profileId,
          input.guildId,
          input.discordUserId,
          input.displayName,
          input.party,
          input.ideology,
          input.homeState,
        ],
      );
      const candidateProfileId = profile.rows[0]?.id;
      if (!candidateProfileId) {
        throw new Error("Candidate profile creation returned no row.");
      }

      const entryId = randomUUID();
      await client.query(
        `INSERT INTO candidate_entries (
          id, cycle_id, race_id, candidate_profile_id
        ) VALUES ($1, $2, $3, $4)`,
        [entryId, input.cycleId, input.raceId, candidateProfileId],
      );

      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.discordUserId,
        eventType: "candidate.registered",
        entityType: "candidate_entry",
        entityId: entryId,
        details: {
          displayName: input.displayName,
          cycleId: input.cycleId,
          raceId: input.raceId,
          party: input.party,
          ideology: input.ideology,
          homeState: input.homeState,
        },
      });

      const entry = await client.query<CandidateEntryRow>(
        `${ENTRY_SELECT} WHERE ce.id = $1`,
        [entryId],
      );
      const row = entry.rows[0];
      if (!row) throw new Error("Candidate registration returned no row.");
      return row;
    });
  }

  async getCandidateEntry(entryId: string): Promise<CandidateEntryRow | null> {
    const result = await this.pool.query<CandidateEntryRow>(
      `${ENTRY_SELECT} WHERE ce.id = $1`,
      [entryId],
    );
    return result.rows[0] ?? null;
  }

  async getUserEntry(
    cycleId: string,
    discordUserId: string,
  ): Promise<CandidateEntryRow | null> {
    const result = await this.pool.query<CandidateEntryRow>(
      `${ENTRY_SELECT}
       WHERE ce.cycle_id = $1 AND cp.discord_user_id = $2`,
      [cycleId, discordUserId],
    );
    return result.rows[0] ?? null;
  }

  async listCandidateEntries(
    cycleId: string,
    options: { raceId?: string; search?: string; activeOnly?: boolean } = {},
  ): Promise<CandidateEntryRow[]> {
    const conditions = ["ce.cycle_id = $1"];
    const values: unknown[] = [cycleId];
    if (options.raceId) {
      values.push(options.raceId);
      conditions.push(`ce.race_id = $${values.length}`);
    }
    if (options.search) {
      values.push(`%${options.search}%`);
      conditions.push(`cp.display_name ILIKE $${values.length}`);
    }
    if (options.activeOnly) {
      conditions.push("ce.status = 'active'");
    }
    const result = await this.pool.query<CandidateEntryRow>(
      `${ENTRY_SELECT}
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.display_name, cp.display_name
       LIMIT 25`,
      values,
    );
    return result.rows;
  }

  async setCandidateStatus(
    guildId: string,
    entryId: string,
    status: "active" | "withdrawn" | "disqualified",
    actorUserId: string,
    reason?: string,
  ): Promise<CandidateEntryRow | null> {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE candidate_entries
         SET status = $1, updated_at = now()
         WHERE id = $2
         RETURNING id`,
        [status, entryId],
      );
      if (!updated.rowCount) return null;
      await this.insertAudit(client, {
        guildId,
        actorUserId,
        eventType: "candidate.status_changed",
        entityType: "candidate_entry",
        entityId: entryId,
        details: { status, reason: reason ?? null },
      });
      const entry = await client.query<CandidateEntryRow>(
        `${ENTRY_SELECT} WHERE ce.id = $1`,
        [entryId],
      );
      return entry.rows[0] ?? null;
    });
  }

  async setPresidentialNominee(
    guildId: string,
    entryId: string,
    isNominee: boolean,
    actorUserId: string,
  ): Promise<CandidateEntryRow | null> {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE candidate_entries ce
         SET is_presidential_nominee = $1, updated_at = now()
         FROM races r
         WHERE ce.id = $2
           AND r.id = ce.race_id
           AND r.office_type = 'president'
         RETURNING ce.id`,
        [isNominee, entryId],
      );
      if (!updated.rowCount) return null;
      await this.insertAudit(client, {
        guildId,
        actorUserId,
        eventType: "candidate.presidential_nominee_changed",
        entityType: "candidate_entry",
        entityId: entryId,
        details: { isNominee },
      });
      const result = await client.query<CandidateEntryRow>(
        `${ENTRY_SELECT} WHERE ce.id = $1`,
        [entryId],
      );
      return result.rows[0] ?? null;
    });
  }

  async createRunningMateRequest(
    guildId: string,
    candidateEntryId: string,
    proposedUserId: string,
    requestedByUserId: string,
  ): Promise<string> {
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE running_mate_requests
         SET status = 'cancelled', responded_at = now()
         WHERE candidate_entry_id = $1 AND status = 'pending'`,
        [candidateEntryId],
      );
      const id = randomUUID();
      await client.query(
        `INSERT INTO running_mate_requests (
          id, candidate_entry_id, proposed_user_id, requested_by_user_id
        ) VALUES ($1, $2, $3, $4)`,
        [id, candidateEntryId, proposedUserId, requestedByUserId],
      );
      await this.insertAudit(client, {
        guildId,
        actorUserId: requestedByUserId,
        eventType: "ticket.running_mate_requested",
        entityType: "running_mate_request",
        entityId: id,
        details: { candidateEntryId, proposedUserId },
      });
      return id;
    });
  }

  async respondToRunningMateRequest(
    guildId: string,
    requestId: string,
    respondingUserId: string,
    accept: boolean,
  ): Promise<
    | { ok: true; candidateEntryId: string }
    | { ok: false; reason: "missing" | "wrong-user" | "resolved" }
  > {
    return withTransaction(this.pool, async (client) => {
      const request = await client.query<{
        candidate_entry_id: string;
        proposed_user_id: string;
        status: string;
      }>(
        `SELECT candidate_entry_id, proposed_user_id, status
         FROM running_mate_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId],
      );
      const row = request.rows[0];
      if (!row) return { ok: false, reason: "missing" };
      if (row.proposed_user_id !== respondingUserId) {
        return { ok: false, reason: "wrong-user" };
      }
      if (row.status !== "pending") {
        return { ok: false, reason: "resolved" };
      }

      const status = accept ? "accepted" : "declined";
      await client.query(
        `UPDATE running_mate_requests
         SET status = $1, responded_at = now()
         WHERE id = $2`,
        [status, requestId],
      );
      if (accept) {
        await client.query(
          `UPDATE candidate_entries
           SET running_mate_user_id = $1,
               running_mate_confirmed_at = now(),
               updated_at = now()
           WHERE id = $2`,
          [respondingUserId, row.candidate_entry_id],
        );
      }
      await this.insertAudit(client, {
        guildId,
        actorUserId: respondingUserId,
        eventType: accept
          ? "ticket.running_mate_accepted"
          : "ticket.running_mate_declined",
        entityType: "running_mate_request",
        entityId: requestId,
        details: { candidateEntryId: row.candidate_entry_id },
      });
      return { ok: true, candidateEntryId: row.candidate_entry_id };
    });
  }

  async createPendingSubmission(
    input: CreatePendingSubmissionInput,
  ): Promise<PendingSubmissionRow> {
    const id = randomUUID();
    const result = await this.pool.query<PendingSubmissionRow>(
      `INSERT INTO pending_submissions (
        id, guild_id, cycle_id, race_id, candidate_entry_id,
        submitter_user_id, target_state, submission_type, content_hash,
        content_text, attachment_id, attachment_name, attachment_content_type,
        attachment_size_bytes, attachment_url, points, response_channel_id,
        expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, now() + interval '10 minutes'
      )
      RETURNING *`,
      [
        id,
        input.guildId,
        input.cycleId,
        input.raceId,
        input.candidateEntryId,
        input.submitterUserId,
        input.targetState,
        input.submissionType,
        input.contentHash,
        input.contentText ?? null,
        input.attachmentId ?? null,
        input.attachmentName ?? null,
        input.attachmentContentType ?? null,
        input.attachmentSizeBytes ?? null,
        input.attachmentUrl ?? null,
        input.points,
        input.responseChannelId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Pending submission creation returned no row.");
    return row;
  }

  async setPendingMessageId(
    pendingId: string,
    messageId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pending_submissions
       SET response_message_id = $1
       WHERE id = $2`,
      [messageId, pendingId],
    );
  }

  async getPendingSubmission(
    pendingId: string,
  ): Promise<PendingSubmissionRow | null> {
    const result = await this.pool.query<PendingSubmissionRow>(
      "SELECT * FROM pending_submissions WHERE id = $1",
      [pendingId],
    );
    return result.rows[0] ?? null;
  }

  async cancelPendingSubmission(
    pendingId: string,
    submitterUserId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM pending_submissions
       WHERE id = $1 AND submitter_user_id = $2`,
      [pendingId, submitterUserId],
    );
    return Boolean(result.rowCount);
  }

  async confirmPendingSubmission(
    pendingId: string,
    submitterUserId: string,
    responseMessageId: string,
  ): Promise<ConfirmSubmissionResult> {
    return withTransaction(this.pool, async (client) => {
      const pendingResult = await client.query<PendingSubmissionRow>(
        `SELECT * FROM pending_submissions
         WHERE id = $1
         FOR UPDATE`,
        [pendingId],
      );
      const pending = pendingResult.rows[0];
      if (!pending) {
        throw new Error("This submission preview no longer exists.");
      }
      if (pending.submitter_user_id !== submitterUserId) {
        throw new Error("Only the person who created this preview can confirm it.");
      }
      if (new Date(pending.expires_at).getTime() <= Date.now()) {
        await client.query("DELETE FROM pending_submissions WHERE id = $1", [
          pendingId,
        ]);
        throw new Error("This preview expired. Please submit it again.");
      }
      const eligibility = await client.query(
        `SELECT 1
         FROM election_cycles ec
         JOIN candidate_entries ce ON ce.id = $2
         WHERE ec.id = $1
           AND ec.phase = 'campaign'
           AND NOT EXISTS (
             SELECT 1
             FROM cycle_deadlines cd
             WHERE cd.cycle_id = ec.id
               AND cd.deadline_type = 'campaign'
               AND cd.deadline_at <= now()
           )
           AND ce.cycle_id = ec.id
           AND ce.race_id = $3
           AND ce.status = 'active'
         FOR SHARE`,
        [pending.cycle_id, pending.candidate_entry_id, pending.race_id],
      );
      if (!eligibility.rowCount) {
        throw new Error(
          "The campaign phase closed or the candidate is no longer active.",
        );
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${pending.cycle_id}:${pending.content_hash}`,
      ]);

      const uses = await client.query<{
        candidate_entry_id: string;
        race_id: string;
        submitter_user_id: string;
        created_at: Date;
      }>(
        `SELECT candidate_entry_id, race_id, submitter_user_id, created_at
         FROM campaign_submissions
         WHERE cycle_id = $1 AND content_hash = $2
         ORDER BY created_at ASC`,
        [pending.cycle_id, pending.content_hash],
      );

      const reuse = checkReuse({
        submissionType: pending.submission_type,
        candidateEntryId: pending.candidate_entry_id,
        raceId: pending.race_id,
        previousUses: uses.rows.map((row) => ({
          candidateEntryId: row.candidate_entry_id,
          raceId: row.race_id,
          submitterUserId: row.submitter_user_id,
          createdAt: new Date(row.created_at),
        })),
      });

      if (!reuse.allowed) {
        await client.query(
          `UPDATE pending_submissions
           SET expires_at = now() + interval '24 hours'
           WHERE id = $1`,
          [pendingId],
        );
        await this.insertAudit(client, {
          guildId: pending.guild_id,
          actorUserId: pending.submitter_user_id,
          eventType: "campaign.rejected",
          entityType: "pending_submission",
          entityId: pending.id,
          details: {
            reason: reuse.reason,
            priorSubmitterUserId: reuse.priorSubmitterUserId,
            retryAt: reuse.retryAt?.toISOString() ?? null,
          },
        });
        return {
          accepted: false,
          reason: reuse.reason,
          priorSubmitterUserId: reuse.priorSubmitterUserId,
          ...(reuse.retryAt ? { retryAt: reuse.retryAt } : {}),
        };
      }

      const submissionId = randomUUID();
      const inserted = await client.query<CampaignSubmissionRow>(
        `INSERT INTO campaign_submissions (
          id, guild_id, cycle_id, race_id, candidate_entry_id,
          submitter_user_id, target_state, submission_type, content_hash,
          content_text, attachment_id, attachment_name, attachment_content_type,
          attachment_size_bytes, attachment_url, points,
          response_channel_id, response_message_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18
        )
        RETURNING
          id, cycle_id, race_id, candidate_entry_id, submitter_user_id,
          target_state, submission_type, content_hash, points,
          response_channel_id, response_message_id, created_at`,
        [
          submissionId,
          pending.guild_id,
          pending.cycle_id,
          pending.race_id,
          pending.candidate_entry_id,
          pending.submitter_user_id,
          pending.target_state,
          pending.submission_type,
          pending.content_hash,
          pending.content_text,
          pending.attachment_id,
          pending.attachment_name,
          pending.attachment_content_type,
          pending.attachment_size_bytes,
          pending.attachment_url,
          pending.points,
          pending.response_channel_id,
          responseMessageId,
        ],
      );
      await client.query("DELETE FROM pending_submissions WHERE id = $1", [
        pendingId,
      ]);
      await this.insertAudit(client, {
        guildId: pending.guild_id,
        actorUserId: pending.submitter_user_id,
        eventType: "campaign.accepted",
        entityType: "campaign_submission",
        entityId: submissionId,
        details: {
          cycleId: pending.cycle_id,
          raceId: pending.race_id,
          candidateEntryId: pending.candidate_entry_id,
          targetState: pending.target_state,
          submissionType: pending.submission_type,
          points: pending.points,
          useNumber: uses.rows.length + 1,
        },
      });

      const submission = inserted.rows[0];
      if (!submission) throw new Error("Submission insertion returned no row.");
      return { accepted: true, submission };
    });
  }

  async overridePendingSubmission(input: {
    pendingId: string;
    actorUserId: string;
    reason: string;
    responseMessageId: string;
  }): Promise<CampaignSubmissionRow> {
    return withTransaction(this.pool, async (client) => {
      const pendingResult = await client.query<PendingSubmissionRow>(
        `SELECT * FROM pending_submissions
         WHERE id = $1
         FOR UPDATE`,
        [input.pendingId],
      );
      const pending = pendingResult.rows[0];
      if (!pending) {
        throw new Error("This rejected submission is no longer available.");
      }
      if (new Date(pending.expires_at).getTime() <= Date.now()) {
        await client.query("DELETE FROM pending_submissions WHERE id = $1", [
          input.pendingId,
        ]);
        throw new Error("The rejected submission expired.");
      }
      const eligibility = await client.query(
        `SELECT 1
         FROM election_cycles ec
         JOIN candidate_entries ce ON ce.id = $2
         WHERE ec.id = $1
           AND ec.phase = 'campaign'
           AND NOT EXISTS (
             SELECT 1
             FROM cycle_deadlines cd
             WHERE cd.cycle_id = ec.id
               AND cd.deadline_type = 'campaign'
               AND cd.deadline_at <= now()
           )
           AND ce.cycle_id = ec.id
           AND ce.race_id = $3
           AND ce.status = 'active'
         FOR SHARE`,
        [pending.cycle_id, pending.candidate_entry_id, pending.race_id],
      );
      if (!eligibility.rowCount) {
        throw new Error(
          "The campaign phase closed or the candidate is no longer active.",
        );
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${pending.cycle_id}:${pending.content_hash}`,
      ]);
      const submissionId = randomUUID();
      const inserted = await client.query<CampaignSubmissionRow>(
        `INSERT INTO campaign_submissions (
          id, guild_id, cycle_id, race_id, candidate_entry_id,
          submitter_user_id, target_state, submission_type, content_hash,
          content_text, attachment_id, attachment_name, attachment_content_type,
          attachment_size_bytes, attachment_url, points,
          response_channel_id, response_message_id,
          overridden_by_user_id, override_reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20
        )
        RETURNING
          id, cycle_id, race_id, candidate_entry_id, submitter_user_id,
          target_state, submission_type, content_hash, points,
          response_channel_id, response_message_id, created_at`,
        [
          submissionId,
          pending.guild_id,
          pending.cycle_id,
          pending.race_id,
          pending.candidate_entry_id,
          pending.submitter_user_id,
          pending.target_state,
          pending.submission_type,
          pending.content_hash,
          pending.content_text,
          pending.attachment_id,
          pending.attachment_name,
          pending.attachment_content_type,
          pending.attachment_size_bytes,
          pending.attachment_url,
          pending.points,
          pending.response_channel_id,
          input.responseMessageId,
          input.actorUserId,
          input.reason,
        ],
      );
      await client.query("DELETE FROM pending_submissions WHERE id = $1", [
        input.pendingId,
      ]);
      await this.insertAudit(client, {
        guildId: pending.guild_id,
        actorUserId: input.actorUserId,
        eventType: "campaign.duplicate_override",
        entityType: "campaign_submission",
        entityId: submissionId,
        details: {
          pendingId: input.pendingId,
          originalSubmitterUserId: pending.submitter_user_id,
          reason: input.reason,
        },
      });
      const row = inserted.rows[0];
      if (!row) throw new Error("Override insertion returned no row.");
      return row;
    });
  }

  async listCampaignHistory(
    cycleId: string,
    options: { candidateEntryId?: string; submitterUserId?: string } = {},
  ): Promise<
    Array<
      CampaignSubmissionRow & {
        candidate_name: string;
        race_name: string;
      }
    >
  > {
    const values: unknown[] = [cycleId];
    const conditions = ["cs.cycle_id = $1"];
    if (options.candidateEntryId) {
      values.push(options.candidateEntryId);
      conditions.push(`cs.candidate_entry_id = $${values.length}`);
    }
    if (options.submitterUserId) {
      values.push(options.submitterUserId);
      conditions.push(`cs.submitter_user_id = $${values.length}`);
    }
    const result = await this.pool.query<
      CampaignSubmissionRow & {
        candidate_name: string;
        race_name: string;
      }
    >(
      `SELECT
        cs.id, cs.cycle_id, cs.race_id, cs.candidate_entry_id,
        cs.submitter_user_id, cs.target_state, cs.submission_type,
        cs.content_hash, cs.points, cs.response_channel_id,
        cs.response_message_id, cs.created_at,
        cp.display_name AS candidate_name,
        r.display_name AS race_name
       FROM campaign_submissions cs
       JOIN candidate_entries ce ON ce.id = cs.candidate_entry_id
       JOIN candidate_profiles cp ON cp.id = ce.candidate_profile_id
       JOIN races r ON r.id = cs.race_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cs.created_at DESC
       LIMIT 20`,
      values,
    );
    return result.rows;
  }

  async addAdjustment(input: {
    guildId: string;
    cycleId: string;
    raceId: string;
    candidateEntryId: string;
    percentagePoints: number;
    reason: string;
    actorUserId: string;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO result_adjustments (
          id, cycle_id, race_id, candidate_entry_id,
          percentage_points, reason, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.cycleId,
          input.raceId,
          input.candidateEntryId,
          input.percentagePoints,
          input.reason,
          input.actorUserId,
        ],
      );
      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        eventType: "result.adjustment_added",
        entityType: "result_adjustment",
        entityId: id,
        details: {
          candidateEntryId: input.candidateEntryId,
          percentagePoints: input.percentagePoints,
          reason: input.reason,
        },
      });
    });
  }

  async setVoteTotal(input: {
    guildId: string;
    cycleId: string;
    raceId: string;
    candidateEntryId: string;
    rawVotes: number;
    actorUserId: string;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO vote_totals (
          id, cycle_id, race_id, candidate_entry_id,
          raw_votes, entered_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (race_id, candidate_entry_id)
        DO UPDATE SET
          raw_votes = EXCLUDED.raw_votes,
          entered_by_user_id = EXCLUDED.entered_by_user_id,
          updated_at = now()`,
        [
          randomUUID(),
          input.cycleId,
          input.raceId,
          input.candidateEntryId,
          input.rawVotes,
          input.actorUserId,
        ],
      );
      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        eventType: "result.votes_entered",
        entityType: "candidate_entry",
        entityId: input.candidateEntryId,
        details: { raceId: input.raceId, rawVotes: input.rawVotes },
      });
    });
  }

  async getResultInputs(raceId: string): Promise<ResultCandidateInput[]> {
    const result = await this.pool.query<{
      candidate_entry_id: string;
      display_name: string;
      party: Party;
      raw_votes: string | number;
      votes_entered: boolean;
      campaign_points: string | number;
      adjustments: string | number;
    }>(
      `SELECT
        ce.id AS candidate_entry_id,
        cp.display_name,
        cp.party,
        COALESCE(vt.raw_votes, 0) AS raw_votes,
        (vt.id IS NOT NULL) AS votes_entered,
        COALESCE(DISTINCT_CAMPAIGN.points, 0) AS campaign_points,
        COALESCE(DISTINCT_ADJUSTMENTS.percentage_points, 0) AS adjustments
       FROM candidate_entries ce
       JOIN candidate_profiles cp ON cp.id = ce.candidate_profile_id
       LEFT JOIN vote_totals vt
         ON vt.candidate_entry_id = ce.id AND vt.race_id = ce.race_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(cs.points), 0) AS points
         FROM campaign_submissions cs
         WHERE cs.candidate_entry_id = ce.id AND cs.race_id = ce.race_id
       ) DISTINCT_CAMPAIGN ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ra.percentage_points), 0) AS percentage_points
         FROM result_adjustments ra
         WHERE ra.candidate_entry_id = ce.id AND ra.race_id = ce.race_id
       ) DISTINCT_ADJUSTMENTS ON true
       WHERE ce.race_id = $1 AND ce.status = 'active'
       ORDER BY cp.display_name`,
      [raceId],
    );
    return result.rows.map((row) => ({
      candidateEntryId: row.candidate_entry_id,
      displayName: row.display_name,
      party: row.party,
      rawVotes: Number(row.raw_votes),
      votesEntered: row.votes_entered,
      campaignPoints: Number(row.campaign_points),
      adjustments: Number(row.adjustments),
    }));
  }

  async getPresidentialCampaignReport(
    raceId: string,
    states: readonly string[],
  ): Promise<
    Array<{
      candidate_entry_id: string;
      display_name: string;
      home_state: string;
      target_state: string;
      points: number;
    }>
  > {
    const result = await this.pool.query<{
      candidate_entry_id: string;
      display_name: string;
      home_state: string;
      target_state: string;
      points: string | number;
    }>(
      `SELECT
        ce.id AS candidate_entry_id,
        cp.display_name,
        cp.home_state,
        states.target_state,
        COALESCE(SUM(cs.points), 0)
          + CASE WHEN states.target_state = cp.home_state THEN 20 ELSE 0 END
          AS points
       FROM candidate_entries ce
       JOIN candidate_profiles cp ON cp.id = ce.candidate_profile_id
       CROSS JOIN unnest($2::text[]) AS states(target_state)
       LEFT JOIN campaign_submissions cs
         ON cs.candidate_entry_id = ce.id
         AND cs.race_id = $1
         AND cs.target_state = states.target_state
       WHERE ce.race_id = $1 AND ce.status = 'active'
       GROUP BY
         ce.id, cp.display_name, cp.home_state, states.target_state
       ORDER BY states.target_state, points DESC, cp.display_name`,
      [raceId, states],
    );
    return result.rows.map((row) => ({ ...row, points: Number(row.points) }));
  }

  async saveResultSnapshot(input: {
    guildId: string;
    cycleId: string;
    raceId: string;
    resultData: unknown;
    actorUserId: string;
    publish: boolean;
  }): Promise<string> {
    return withTransaction(this.pool, async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO result_snapshots (
          id, cycle_id, race_id, result_data, is_published,
          created_by_user_id, published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.cycleId,
          input.raceId,
          JSON.stringify(input.resultData),
          input.publish,
          input.actorUserId,
          input.publish ? new Date() : null,
        ],
      );
      await this.insertAudit(client, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        eventType: input.publish
          ? "result.published"
          : "result.calculated",
        entityType: "result_snapshot",
        entityId: id,
        details: { raceId: input.raceId },
      });
      return id;
    });
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.insertAudit(this.pool, input);
  }

  async listAuditEvents(guildId: string): Promise<
    Array<{
      id: string;
      actor_user_id: string | null;
      event_type: string;
      entity_type: string | null;
      entity_id: string | null;
      details: Record<string, unknown>;
      created_at: Date;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      actor_user_id: string | null;
      event_type: string;
      entity_type: string | null;
      entity_id: string | null;
      details: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT
        id, actor_user_id, event_type, entity_type,
        entity_id, details, created_at
       FROM audit_events
       WHERE guild_id = $1
       ORDER BY created_at ASC
       LIMIT 50000`,
      [guildId],
    );
    return result.rows;
  }

  async listUnsentAuditEvents(
    guildId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      actor_user_id: string | null;
      event_type: string;
      details: Record<string, unknown>;
      created_at: Date;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      actor_user_id: string | null;
      event_type: string;
      details: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, actor_user_id, event_type, details, created_at
       FROM audit_events
       WHERE guild_id = $1 AND discord_logged_at IS NULL
       ORDER BY created_at ASC
       LIMIT $2`,
      [guildId, limit],
    );
    return result.rows;
  }

  async markAuditEventsSent(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE audit_events
       SET discord_logged_at = now()
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async cleanupExpiredPending(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM pending_submissions WHERE expires_at <= now()",
    );
    return result.rowCount ?? 0;
  }

  private async insertAudit(
    client: Pick<DatabaseClient, "query"> | Pick<DatabasePool, "query">,
    input: AuditInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events (
        id, guild_id, actor_user_id, event_type,
        entity_type, entity_id, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.guildId,
        input.actorUserId ?? null,
        input.eventType,
        input.entityType ?? null,
        input.entityId ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    );
  }
}
