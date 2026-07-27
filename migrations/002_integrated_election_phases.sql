ALTER TABLE election_cycles
  DROP CONSTRAINT IF EXISTS election_cycles_phase_check;

ALTER TABLE election_cycles
  ADD COLUMN IF NOT EXISTS paused_from_phase TEXT;

UPDATE election_cycles
SET paused_from_phase = CASE
  WHEN stage = 'general' THEN 'general_campaign'
  ELSE 'primary_campaign'
END
WHERE phase = 'paused'
  AND paused_from_phase IS NULL;

UPDATE election_cycles
SET phase = CASE
  WHEN phase = 'campaign' AND stage = 'primary' THEN 'primary_campaign'
  WHEN phase = 'campaign' AND stage = 'general' THEN 'general_campaign'
  ELSE phase
END;

ALTER TABLE election_cycles
  ADD CONSTRAINT election_cycles_phase_check
  CHECK (
    phase IN (
      'draft',
      'signup',
      'primary_campaign',
      'primary_results',
      'general_campaign',
      'general_results',
      'paused',
      'closed'
    )
  );

ALTER TABLE election_cycles
  ADD CONSTRAINT election_cycles_paused_from_phase_check
  CHECK (
    paused_from_phase IS NULL OR
    paused_from_phase IN (
      'draft',
      'signup',
      'primary_campaign',
      'primary_results',
      'general_campaign',
      'general_results'
    )
  );

ALTER TABLE candidate_entries
  ADD COLUMN IF NOT EXISTS advanced_to_general BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE cycle_deadlines
  DROP CONSTRAINT IF EXISTS cycle_deadlines_deadline_type_check;

UPDATE cycle_deadlines cd
SET deadline_type = CASE
  WHEN cd.deadline_type = 'campaign' AND ec.stage = 'primary'
    THEN 'primary_campaign'
  WHEN cd.deadline_type = 'campaign' AND ec.stage = 'general'
    THEN 'general_campaign'
  WHEN cd.deadline_type = 'voting' AND ec.stage = 'primary'
    THEN 'primary_voting'
  WHEN cd.deadline_type = 'voting' AND ec.stage = 'general'
    THEN 'general_voting'
  ELSE cd.deadline_type
END
FROM election_cycles ec
WHERE ec.id = cd.cycle_id;

UPDATE deadline_reminders dr
SET deadline_type = CASE
  WHEN dr.deadline_type = 'campaign' AND ec.stage = 'primary'
    THEN 'primary_campaign'
  WHEN dr.deadline_type = 'campaign' AND ec.stage = 'general'
    THEN 'general_campaign'
  WHEN dr.deadline_type = 'voting' AND ec.stage = 'primary'
    THEN 'primary_voting'
  WHEN dr.deadline_type = 'voting' AND ec.stage = 'general'
    THEN 'general_voting'
  ELSE dr.deadline_type
END
FROM election_cycles ec
WHERE ec.id = dr.cycle_id;

ALTER TABLE cycle_deadlines
  ADD CONSTRAINT cycle_deadlines_deadline_type_check
  CHECK (
    deadline_type IN (
      'signup',
      'primary_campaign',
      'primary_voting',
      'general_campaign',
      'general_voting'
    )
  );

-- Draft and signup cycles now always begin at the primary phase. Existing
-- campaign, results, paused, and closed cycles retain their current stage.
UPDATE election_cycles
SET stage = 'primary'
WHERE phase IN ('draft', 'signup');
