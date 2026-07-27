export const PARTY_VALUES = [
  "democratic",
  "republican",
  "reform",
  "independent",
] as const;

export type Party = (typeof PARTY_VALUES)[number];

export const IDEOLOGY_VALUES = [
  "progressive",
  "social-democratic",
  "liberal",
  "centrist",
  "moderate",
  "conservative",
  "libertarian",
  "populist",
  "nationalist",
  "other",
] as const;

export type Ideology = (typeof IDEOLOGY_VALUES)[number];

export type ElectionKind = "presidential" | "midterm";
export type ElectionStage = "primary" | "general";
export type CyclePhase =
  | "draft"
  | "signup"
  | "primary_campaign"
  | "primary_results"
  | "general_campaign"
  | "general_results"
  | "paused"
  | "closed";
export type CyclePhaseAction = CyclePhase | "resume";
export type DeadlineType =
  | "signup"
  | "primary_campaign"
  | "primary_voting"
  | "general_campaign"
  | "general_voting";
export type OfficeType = "president" | "governor" | "senate" | "house";
export type SubmissionType = "poster" | "video" | "speech";

export interface CycleRow {
  id: string;
  guild_id: string;
  name: string;
  election_kind: ElectionKind;
  stage: ElectionStage;
  senate_class: number;
  phase: CyclePhase;
  paused_from_phase: Exclude<CyclePhase, "paused" | "closed"> | null;
  governor_regions: string[];
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface RaceRow {
  id: string;
  cycle_id: string;
  race_key: string;
  display_name: string;
  office_type: OfficeType;
  commonwealth: string | null;
  district_number: number | null;
  senate_class: number | null;
}

export interface CandidateEntryRow {
  id: string;
  cycle_id: string;
  race_id: string;
  candidate_profile_id: string;
  status: "active" | "withdrawn" | "disqualified";
  is_presidential_nominee: boolean;
  advanced_to_general: boolean;
  running_mate_user_id: string | null;
  discord_user_id: string;
  display_name: string;
  party: Party;
  ideology: string;
  home_state: string;
  race_display_name: string;
  office_type: OfficeType;
}

export interface PendingSubmissionRow {
  id: string;
  guild_id: string;
  cycle_id: string;
  race_id: string;
  candidate_entry_id: string;
  submitter_user_id: string;
  target_state: string;
  submission_type: SubmissionType;
  content_hash: string;
  content_text: string | null;
  attachment_id: string | null;
  attachment_name: string | null;
  attachment_content_type: string | null;
  attachment_size_bytes: string | null;
  attachment_url: string | null;
  points: number;
  response_channel_id: string;
  response_message_id: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface CampaignSubmissionRow {
  id: string;
  cycle_id: string;
  race_id: string;
  candidate_entry_id: string;
  submitter_user_id: string;
  target_state: string;
  submission_type: SubmissionType;
  content_hash: string;
  points: number;
  response_channel_id: string;
  response_message_id: string | null;
  created_at: Date;
}

export interface ResultCandidateInput {
  candidateEntryId: string;
  displayName: string;
  party?: Party;
  rawVotes: number;
  votesEntered?: boolean;
  campaignPoints: number;
  adjustments: number;
}

export interface ResultCandidateOutput extends ResultCandidateInput {
  voteShare: number;
  campaignShare: number;
  voteComponent: number;
  campaignComponent: number;
  finalPercentage: number;
}
