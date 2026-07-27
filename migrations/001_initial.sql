CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS election_cycles (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  election_kind TEXT NOT NULL CHECK (election_kind IN ('presidential', 'midterm')),
  stage TEXT NOT NULL CHECK (stage IN ('primary', 'general')),
  senate_class SMALLINT NOT NULL CHECK (senate_class BETWEEN 1 AND 3),
  phase TEXT NOT NULL DEFAULT 'draft'
    CHECK (phase IN ('draft', 'signup', 'campaign', 'paused', 'closed')),
  governor_regions TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, name)
);

CREATE INDEX IF NOT EXISTS election_cycles_guild_phase_idx
  ON election_cycles (guild_id, phase);

CREATE TABLE IF NOT EXISTS cycle_deadlines (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  deadline_type TEXT NOT NULL
    CHECK (deadline_type IN ('signup', 'campaign', 'voting')),
  deadline_at TIMESTAMPTZ NOT NULL,
  set_by_user_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, deadline_type)
);

CREATE INDEX IF NOT EXISTS cycle_deadlines_at_idx
  ON cycle_deadlines (deadline_at);

CREATE TABLE IF NOT EXISTS deadline_reminders (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  deadline_type TEXT NOT NULL,
  hours_before SMALLINT NOT NULL CHECK (hours_before IN (24, 6, 1)),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, deadline_type, hours_before)
);

CREATE TABLE IF NOT EXISTS races (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  office_type TEXT NOT NULL
    CHECK (office_type IN ('president', 'governor', 'senate', 'house')),
  commonwealth TEXT,
  district_number SMALLINT,
  senate_class SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, race_key)
);

CREATE INDEX IF NOT EXISTS races_cycle_idx ON races (cycle_id);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  party TEXT NOT NULL
    CHECK (party IN ('democratic', 'republican', 'reform', 'independent')),
  ideology TEXT NOT NULL,
  home_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS candidate_entries (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  candidate_profile_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'withdrawn', 'disqualified')),
  is_presidential_nominee BOOLEAN NOT NULL DEFAULT false,
  running_mate_user_id TEXT,
  running_mate_confirmed_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, candidate_profile_id)
);

CREATE INDEX IF NOT EXISTS candidate_entries_race_status_idx
  ON candidate_entries (race_id, status);

CREATE TABLE IF NOT EXISTS running_mate_requests (
  id UUID PRIMARY KEY,
  candidate_entry_id UUID NOT NULL REFERENCES candidate_entries(id) ON DELETE CASCADE,
  proposed_user_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS running_mate_one_pending_idx
  ON running_mate_requests (candidate_entry_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS pending_submissions (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  candidate_entry_id UUID NOT NULL REFERENCES candidate_entries(id) ON DELETE CASCADE,
  submitter_user_id TEXT NOT NULL,
  target_state TEXT NOT NULL,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('poster', 'video', 'speech')),
  content_hash TEXT NOT NULL,
  content_text TEXT,
  attachment_id TEXT,
  attachment_name TEXT,
  attachment_content_type TEXT,
  attachment_size_bytes BIGINT,
  attachment_url TEXT,
  points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 4),
  response_channel_id TEXT NOT NULL,
  response_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_submissions_expiry_idx
  ON pending_submissions (expires_at);

CREATE TABLE IF NOT EXISTS campaign_submissions (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  candidate_entry_id UUID NOT NULL REFERENCES candidate_entries(id) ON DELETE CASCADE,
  submitter_user_id TEXT NOT NULL,
  target_state TEXT NOT NULL,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('poster', 'video', 'speech')),
  content_hash TEXT NOT NULL,
  content_text TEXT,
  attachment_id TEXT,
  attachment_name TEXT,
  attachment_content_type TEXT,
  attachment_size_bytes BIGINT,
  attachment_url TEXT,
  points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 4),
  response_channel_id TEXT NOT NULL,
  response_message_id TEXT,
  overridden_by_user_id TEXT,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_submissions_cycle_hash_idx
  ON campaign_submissions (cycle_id, content_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_submissions_entry_idx
  ON campaign_submissions (candidate_entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_submissions_race_state_idx
  ON campaign_submissions (race_id, target_state);

CREATE TABLE IF NOT EXISTS result_adjustments (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  candidate_entry_id UUID NOT NULL REFERENCES candidate_entries(id) ON DELETE CASCADE,
  percentage_points NUMERIC(8, 3) NOT NULL,
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS result_adjustments_race_idx
  ON result_adjustments (race_id, candidate_entry_id);

CREATE TABLE IF NOT EXISTS vote_totals (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  candidate_entry_id UUID NOT NULL REFERENCES candidate_entries(id) ON DELETE CASCADE,
  raw_votes INTEGER NOT NULL CHECK (raw_votes >= 0),
  entered_by_user_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (race_id, candidate_entry_id)
);

CREATE TABLE IF NOT EXISTS result_snapshots (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES election_cycles(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  result_data JSONB NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS result_snapshots_race_idx
  ON result_snapshots (race_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  discord_logged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS audit_events_guild_created_idx
  ON audit_events (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_unsent_idx
  ON audit_events (guild_id, created_at)
  WHERE discord_logged_at IS NULL;
