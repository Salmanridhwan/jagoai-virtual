export interface MentionTarget {
  provider: "bluesky" | "mastodon" | "linkedin";
  kind: "person" | "page";
  id: string;
  authority?: string;
  handle?: string;
}
export interface MentionSpan {
  start: number;
  end: number;
  text: string;
  target: MentionTarget;
}
export interface Mentions {
  version: 1;
  spans: MentionSpan[];
}
export interface PublicationSegmentSettings {
  mentions?: Mentions;
  [key: string]: unknown;
}
export interface MentionCandidate {
  label: string;
  detail: string;
  target: MentionTarget;
}
export interface MentionLookup {
  candidates: MentionCandidate[];
  mode: "accounts" | "exact_company";
}
export interface RenditionSourceOverride {
  publication_segment_id: string;
  body_override?: string;
  mentions?: Mentions;
  media_inherited: boolean;
  media?: PublicationMediaInput[];
}
// Hand-written shapes for the SDK v1 surface. Response types mirror the wire
// format served by the API (apps/web/openapi.json components.schemas); new
// contract fields are added as optional so widening never breaks consumers.
// src/types-parity.test.ts fails the build when a declared field is absent
// from the matching schema or a required schema field is missing here.

export type ContentProfile =
  | "short_text"
  | "thread"
  | "link_share"
  | "image_post"
  | "carousel"
  | "story"
  | "short_video"
  | "long_video";

export type PublicationStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type CreationSource = "web" | "api" | "sdk" | "mcp" | "cli" | "autopost" | "unknown";

export type RenditionStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface PublicationMediaInput {
  media_id: string;
  role?: string;
  alt_text?: string;
  thumbnail_timestamp_ms?: number;
  settings?: Record<string, unknown>;
}

export interface PublicationSegmentInput {
  id?: string;
  body?: string;
  title?: string;
  description?: string;
  url?: string;
  settings?: PublicationSegmentSettings;
  media?: PublicationMediaInput[];
}

export interface RenditionSegmentInput {
  id?: string;
  publication_segment_id?: string;
  body?: string;
  title?: string;
  description?: string;
  url?: string;
  body_override?: string | null;
  title_override?: string | null;
  description_override?: string | null;
  url_override?: string | null;
  source_overrides?: RenditionSourceOverride[];
  settings?: PublicationSegmentSettings;
  media_inherited?: boolean;
  media?: PublicationMediaInput[];
}

export interface RenditionInput {
  social_account_id: string;
  target_key?: string;
  profile?: string;
  output_profile?: string;
  format_locked?: boolean;
  schedule_override?: string;
  body?: string;
  title?: string;
  description?: string;
  settings?: Record<string, unknown>;
  media?: PublicationMediaInput[];
  segments?: RenditionSegmentInput[];
}

export interface CreatePublicationInput {
  workspace_id: string;
  title: string;
  content_profile: string;
  source_text: string;
  intent?: string;
  creation_preset?: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  scheduled_at?: string;
  random_delay_minutes?: number;
  metadata?: Record<string, unknown>;
  social_account_ids?: string[];
  social_set_id?: string;
  media?: PublicationMediaInput[];
  segments?: PublicationSegmentInput[];
  renditions?: RenditionInput[];
}

export interface UpdatePublicationInput {
  expected_revision: number;
  force?: boolean;
  title?: string;
  content_profile?: string;
  source_text?: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  scheduled_at?: string | null;
  clear_schedule?: boolean;
  random_delay_minutes?: number;
  metadata?: Record<string, unknown>;
  social_set_id?: string;
  segments?: PublicationSegmentInput[];
  renditions?: RenditionInput[];
}

export interface ListPublicationsQuery {
  workspace_id?: string;
  status?: string;
  activity_bucket?: string;
  content_profile?: string;
  platform?: string;
  calendar_from?: string;
  calendar_before?: string;
  limit?: number;
  offset?: number;
}

export interface RenditionSegment {
  id: string;
  publication_segment_id: string;
  position: number;
  body: string;
  title: string;
  description: string;
  media_inherited: boolean;
  settings: PublicationSegmentSettings;
  status: string;
  error_retryable: boolean;
  media: MediaSummary[];
  url?: string;
  body_override?: string | null;
  title_override?: string | null;
  description_override?: string | null;
  url_override?: string | null;
  output_media?: MediaSummary[];
  external_id?: string;
  external_url?: string;
  error_message?: string;
  error_kind?: string;
  error_code?: string;
  source_overrides?: RenditionSourceOverride[];
}

export interface PublicationSegment {
  id: string;
  position: number;
  body: string;
  title: string;
  description: string;
  settings: PublicationSegmentSettings;
  media: MediaSummary[];
  url?: string;
}

export interface MediaSummary {
  id: string;
  mime_type: string;
  size: number;
  original_filename: string;
  url?: string;
  alt_text?: string;
  role?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  aspect_ratio?: string;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderDelivery {
  target_key: string;
  state: string;
  recovery_action: string;
  current_attempt_id?: string;
  current_attempt_number?: number;
  current_attempt_created_at?: string;
  external_id?: string;
  external_url?: string;
  error_kind?: string;
  error_code?: string;
  error_http_status?: number;
}

export interface RepostOverride {
  mode: string;
  target_account_ids?: string[];
  rule?: Record<string, unknown>;
}

export interface RenditionAccountIdentity {
  platform: string;
  display_name: string;
  avatar_url?: string;
}

export interface Rendition {
  account?: RenditionAccountIdentity;
  id: string;
  social_account_id: string;
  platform: string;
  profile: string;
  body: string;
  title: string;
  description: string;
  settings: Record<string, unknown>;
  status: string;
  publication_id?: string;
  target_key?: string;
  output_profile?: string;
  format_locked?: boolean;
  schedule_override?: string;
  segments?: RenditionSegment[];
  media?: MediaSummary[];
  delivery?: ProviderDelivery;
  external_id?: string;
  external_url?: string;
  error_message?: string;
  error_kind?: string;
  error_code?: string;
  error_action?: string;
  error_http_status?: number;
  error_retry_at?: string;
  error_retryable?: boolean;
}

export interface Publication {
  id: string;
  workspace_id: string;
  created_by: string;
  creation_source: CreationSource;
  title: string;
  intent: string;
  content_profile: string;
  source_text: string;
  source_url?: string;
  goal?: string;
  audience?: string;
  metadata?: Record<string, unknown>;
  status: PublicationStatus;
  revision: number;
  creation_preset?: string;
  social_set_id?: string;
  segments?: PublicationSegment[];
  media?: MediaSummary[];
  random_delay_minutes?: number;
  random_delay_inherited?: boolean;
  repost_override?: RepostOverride;
  review_state?: string;
  review_id?: string;
  review_epoch?: number;
  failure_dismissed_at?: string;
  scheduled_at?: string;
  actual_run_at?: string;
  created_at: string;
  updated_at: string;
  renditions: Rendition[];
}

export interface ValidationIssue {
  severity: string;
  code: string;
  message: string;
  provider?: string;
  profile?: string;
  field?: string;
}

export interface PublicationValidation {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface PublicationAction {
  message: string;
  job_id?: string;
  revision?: number;
}

export interface PublicationEventActor {
  type?: string;
  id?: string;
  label?: string;
}

export interface PublicationEventDestination {
  rendition_id: string;
  social_account_id: string;
  target_key: string;
  platform: string;
  label: string;
  status: string;
}

export interface PublicationEvent {
  id: string;
  workspace_id: string;
  publication_id: string;
  rendition_id?: string;
  type: string;
  status: string;
  summary: string;
  actor?: PublicationEventActor;
  platform?: string;
  revision?: number;
  scheduled_at?: string;
  destination?: PublicationEventDestination;
  delivery?: Record<string, unknown>;
  superseded?: boolean;
  error?: Record<string, unknown>;
  created_at: string;
}

export interface SocialAccount {
  id: string;
  platform: string;
  slug?: string;
  account_id?: string;
  account_username?: string;
  account_avatar_url?: string;
  account_kind?: string;
  alias?: string;
  instance_url?: string;
  is_active?: boolean;
  limit_profile?: string;
  messaging_supported?: boolean;
  messages_enabled?: boolean;
  thread_replies_supported?: boolean;
  grant_destination_count?: number;
  shared_grant?: boolean;
  provider_installation_id?: string;
  capability_checked_at?: string;
  fediverse_software?: string;
  /**
   * @deprecated The wire format never sends `username`; AccountResponse
   * carries `account_username`. Kept as `never` for one release so stale
   * reads fail the build instead of compiling against `undefined`.
   */
  username?: never;
  /**
   * @deprecated The wire format never sends `display_name`; use
   * `account_username` or `alias`. Kept as `never` for one release so stale
   * reads fail the build instead of compiling against `undefined`.
   */
  display_name?: never;
  /**
   * @deprecated The wire format never sends `status`; AccountResponse
   * carries `is_active`. Kept as `never` for one release so stale reads fail
   * the build instead of compiling against `undefined`.
   */
  status?: never;
  [key: string]: unknown;
}

export interface ProviderInfo {
  platform: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface DestinationOption {
  key?: string;
  label?: string;
  [key: string]: unknown;
}

export interface DestinationOptionGroups {
  [group: string]: DestinationOption[];
}

export interface ProviderReadiness {
  platform?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SocialSet {
  id: string;
  workspace_id: string;
  name?: string;
  [key: string]: unknown;
}

export interface MediaItem {
  id: string;
  workspace_id: string;
  mime_type: string;
  size: number;
  original_filename: string;
  alt_text?: string;
  url?: string;
  thumbnail_url?: string;
  processing_status?: string;
  [key: string]: unknown;
}

export interface MediaPage {
  media: MediaItem[];
  total: number;
}

export interface MediaUploadResult {
  width?: number;
  height?: number;
  parent_media_id?: string;
  source?: string;
  asset_kind?: string;
  retention_class?: "library" | "temporary";
  id: string;
  mime_type: string;
  url: string;
  size: number;
  deduped?: boolean;
  alt_text?: string;
  original_filename?: string;
  processing_status?: string;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  run_at?: string;
  attempts?: number;
  max_attempts?: number;
  last_error?: string;
  created_at?: string;
  publication_id?: string;
  payload?: string;
  locked_at?: string;
  [key: string]: unknown;
}

export interface ListJobsQuery {
  workspace_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface Workspace {
  id: string;
  name: string;
  created_at?: string;
  organization_id?: string;
  organization_name?: string;
  avatar_url?: string;
  color?: string;
  role?: string;
  can_edit?: boolean;
  can_connect?: boolean;
  can_approve?: boolean;
  client_reviews_enabled?: boolean;
  sso_required?: boolean;
  sso_authenticated?: boolean;
  sso_identity_linked?: boolean;
  sso_provider_id?: string;
  sso_provider_name?: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface PrepareMediaImageInput {
  account_id: string;
  output_profile: string;
  settings?: Record<string, unknown>;
  alt_text?: string;
}
export interface PreparedMediaImage {
  media: MediaUploadResult;
  status: "ready";
}

// Stored Inbox activity, shared with the REST contract.
export interface EngagementItem {
  account_username?: string;
  archived_at?: string;
  attachments: EngagementAttachment[] | null;
  author_avatar_url: string;
  author_handle: string;
  author_name: string;
  author_remote_id: string;
  body: string;
  can_delete: boolean;
  can_delete_reply?: boolean;
  can_hide: boolean;
  can_like: boolean;
  can_reply: boolean;
  can_unlike: boolean;
  conversation_remote_id: string;
  created_at: string;
  deleted_at?: string;
  edited_at?: string;
  hidden: boolean;
  id: string;
  is_ours: boolean;
  kind?: string;
  last_seen_at: string;
  liked: boolean;
  parent_remote_id: string;
  platform: string;
  provider_post_url?: string;
  publication_excerpt?: string;
  publication_id?: string;
  publication_title?: string;
  read_at?: string;
  remote_created_at?: string;
  remote_id: string;
  rendition_id?: string;
  reply_job_id?: string;
  reply_operation_state?: string;
  social_account_id: string;
  subject?: EngagementSubject;
  updated_at: string;
  workspace_id: string;
}
export interface EngagementAttachment {
  alt_text?: string;
  mime_type?: string;
  name?: string;
  thumbnail?: string;
  type: string;
  url: string;
}
export interface EngagementSubject {
  kind: string;
  parent?: PostReference;
  remote_id: string;
  review?: ReviewContext;
  root?: PostReference;
  url?: string;
  visibility?: string;
}
export interface ReviewContext {
  anonymous: boolean;
  owner_reply?: ReviewReply;
  stars?: number;
}
export interface ReviewReply {
  policy_violation?: string;
  state: string;
  text: string;
  updated_at?: string;
}
export interface PostReference {
  cid: string;
  uri: string;
}
export interface EngagementPage {
  items: EngagementItem[] | null;
  next_cursor?: string;
  sync_states: EngagementSyncState[] | null;
  total: number;
}
export interface EngagementDetail {
  item: EngagementItem;
  parents: EngagementItem[] | null;
}
export interface EngagementSyncState {
  error_code: string;
  error_message: string;
  feed?: string;
  id: string;
  last_success_at?: string;
  next_sync_at?: string;
  platform: string;
  rendition_id: string;
  social_account_id: string;
  status: string;
}
export interface RefreshCapabilityOutcome {
  error_code?: string;
  job_ids?: string[] | null;
  queued: number;
  status: "queued" | "failed" | "unavailable";
}
