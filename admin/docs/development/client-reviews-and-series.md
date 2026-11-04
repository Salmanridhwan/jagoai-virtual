# Client reviews, Ideate and selected-draft scheduling

Publications remain the authored post inventory. These features add optional authoring and review paths without changing ordinary draft or publishing behavior.

## Ideate owns the web authoring dialog

`workspace-shell.svelte` mounts one lazy `ideate-host`. Navigation and the composer provide an entry context to `post-builder/ideate.svelte.ts`. `/ideate` is a compatibility entry that opens that dialog and returns to Posts. It does not render a second authoring page.

The dialog keeps accepted server builds running when closed. Actor, workspace and entry identity fence subsequent mutations. Device session storage retains the input, idempotency key, build identity and exact pending option-edit requests. Server build records remain authoritative. A composer callback additionally compares its captured authorship before applying content. Undo includes account selection.

Four alternatives are competing versions of one post. A series contains complementary posts. Destination variants belong to one Publication. The controls and result copy must preserve these distinctions.

Series planning requests `series_count`, mutually exclusive with `option_count`. The maximum is three, matching the existing per-actor active-build bound. Planning returns fewer concepts when evidence is thin. It creates no child build or Publication. Each concept has editable direction, supplied evidence and source references. Generation reserves a deterministic child identity before enqueueing. Retries reuse that identity, and each child uses the source text frozen at planning time. Media content still crosses the existing media boundary. Failed or cancelled children can be retried individually.

A child uses the normal validated Builder writer, reviewer and option editor. Saving creates a draft with `metadata.series` containing its parent, item and item revision. Opening a child does not expose generic regeneration that would lose this origin. Edit the generated post directly, or return to a new series plan for new source material.

## Scheduling selected drafts

The batch scheduling endpoints preview dates and confirm them separately. They accept up to 20 selected Publications and a bounded date range. A preview cannot create jobs. Dates use workspace-local days and active posting slots or an explicit cadence. Nonexistent daylight-saving clock times are skipped; repeated clock times appear once. Existing authored dates are retained. Destination-specific schedules require individual scheduling. Before confirmation, each newly proposed date can be adjusted in the workspace timezone, and posts can be deselected without moving the remaining dates. Accepted attempts freeze their exact timestamps so a retry cannot reinterpret a lost response.

Confirmation uses the preview's exact timestamp and revision. Each post has a stable idempotency receipt scoped to principal, workspace and batch item. Authorization precedes replay, but lifecycle restrictions do not prevent replay of an item already delivered. A workspace transaction serializes placement checks, reserves metered usage, changes authored timing and invokes the canonical queue operation. Individual and batch scheduling share the atomic usage reservation. Failed items roll back independently. Retrying a partially completed batch never shifts dates or recreates successful jobs.

Same-series posts cannot share a workspace-local date, including posts already stored outside the current selection. Timing conflicts are checked again inside confirmation. Existing random dispatch delays remain separate from authored schedule times.

## Required client approval is explicit

The client role can read workspace content, connect or reconnect accounts, and decide assigned reviews. It cannot author posts, disconnect accounts, administer the workspace or publish. An editor or admin explicitly sends a saved draft to one active client. Ordinary posts have no review requirement.

The submitted snapshot is immutable. The record also pins effective destination text, media, settings, account identity and provider policy fingerprints. This catches changes to inherited library media text even when no Publication edit occurs. The assigned active client can approve or request changes. Identical lost-response retries return the same submission or decision. Neither action creates delivery jobs.

A monotonic review epoch prevents editing and reverting from reviving a prior approval. Authored content, destination, media or setting changes invalidate approval and cancel pending primary jobs atomically. Timing changes invalidate approval when the submitted version included timing. An untimed submission permits the author to choose its first schedule later. In-flight writes cannot be recalled through an ordinary edit.

Queue admission and fresh provider send/resume paths require the current approval. Media uploads also revalidate approval, including YouTube and PeerTube uploads that can create a public video. Resumable adapters check before mutations while retaining read-only provider reconciliation. First comments are part of the submitted destination settings and are checked before their own provider call. Immutable delivery receipts may still be inspected, replayed and reconciled after reviewer removal; that does not authorize another provider write.

Automatic native reposts of reviewed posts are blocked because a new placement is outside the submitted version. Create a separate post and submit it instead. Explicit Inbox replies are separately authored conversation actions, not client-approved variants of the parent post. Delegated external-app credentials cannot call review operations; the existing operation allowlist fails closed. Human session and personal API-token callers remain subject to the same membership and reviewer checks.

## Upgrade and rollback

Migration 158 is additive for SQLite and PostgreSQL. `OPENPOST_CLIENT_REVIEWS_ENABLED` defaults to false and controls admission of new review requests, not enforcement of existing reviews.

1. Keep review admission disabled while migrating and upgrading.
2. Drain and replace every old web process, worker and `all` process that can author or publish posts. Do not enable reviews during a mixed-version rollout.
3. Verify that all remaining processes run the review-aware revision, then set `OPENPOST_CLIENT_REVIEWS_ENABLED=true` on web and `all` processes.
4. Verify a pending review blocks queueing and that an approved test draft can be scheduled.

For rollback, disable new review admission first. Continue running review-aware workers for existing reviewed posts, or stop delivery entirely. Do not roll back to a binary that ignores review state while reviewed posts remain publishable. Keep the additive schema and immutable review history.
