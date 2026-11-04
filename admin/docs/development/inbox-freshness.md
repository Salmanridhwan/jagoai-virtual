# Maintain Inbox freshness and delivery identity

This page explains the server and client owners for Chats and Comments. Provider installation instructions are in [official Inbox ingress](provider-inbox-ingress.md) and [X messaging](x-messaging.md). Provider approval and live credentials must be verified in the target installation.

## Keep reads inside the shared query owner

Web and native consume stored data through `@openpost/query-catalog`. Opening a list or chat never calls the social provider directly. The canonical message page includes its conversation metadata, saved pagination cursor, and whether upstream history is available. Comment detail returns its item and known parent chain through `engagementDetailQueryOptions`.

`startInboxUpdates` runs only while its caller is foreground, online, and displaying Inbox. It sends activity heartbeats every 20 seconds and reads `/inbox/changes` with a maximum 25-second wait. The caller cancels it on identity, Workspace, view, connectivity, or visibility changes. Native also follows app state and screen focus. Responses from a prior identity cannot update the new identity's cache.

The runner cancels older in-flight message reads before applying committed events, so a late snapshot cannot overwrite a newer update. Cold reads restart after the observed commit. The runner patches known message IDs across cached pages, removes merged echo IDs, and updates open-chat conversation metadata. Server-filtered list membership is invalidated through the same query keys. Unseen historical messages do not append to the newest page. A history completion marker refreshes pagination while preserving cached rows. Incoming content must not steal scroll position from someone reading older messages.

## Commit data and feed records together

`services/inboxchanges` stores typed identifiers, not message bodies. Each visible mutation appends its records in the same transaction. A per-Workspace head row serializes revision allocation until commit. PostgreSQL sequences alone would allow a later revision to commit before an earlier one and let readers skip the late commit.

A feed page returns at most 200 changes and never reads beyond its captured committed head. Cursors bind to a Workspace. The server retains the last 10,000 changes per Workspace. An empty or expired cursor requests a fresh stored-data view. A deleted message remains a tombstone, and a merged duplicate emits its own removal record. Account-scoped provider deletion identities survive even when deletion arrives before local discovery or history. Conversation deletion retains its observed cutoff; a later provider message can reopen the conversation without exposing older content.

Long waits release database connections between one-second checks. Every check and completed response revalidates the credential and Workspace access. A revoked session, expired token, or removed member cannot keep reading an already-open feed.

## Collect once per account

Activity leases last 60 seconds. Opening Chats or a conversation wakes a cold account immediately while preserving a future provider failure backoff. Multiple devices share the same account checkpoint and active job. After the last lease expires, collection returns to its background cadence.

Bluesky uses one account log cursor. Initialization captures a real log head, pages conversation discovery, then replays from that head. Live batches contain touched conversations and event messages. Focused chat collection targets four seconds, and the Chats list targets 30 seconds. Older history has a separate conversation cursor and runs only through a durable history job.

Meta delivers signed callbacks into encrypted durable receipts. Mastodon uses one leased stream per account with REST repair after every connection. A healthy stream prevents the foreground REST cadence from duplicating live collection. Both keep periodic repair. X uses its durable quota owner for OAuth1 and supplemental OAuth2; foreground activity cannot bypass upstream limits or create paid subscriptions.

The account collector has a two-minute lease and a one-minute collection deadline. Live log work is bounded to four batches per job. Checkpoints and normalized provider changes commit together. A failed fetch retains the last committed cursor.

## Separate interactive writes from slow background jobs

The general worker excludes `messages_sync`, `message_send`, and `engagement_action`. A collection worker owns sync and receipt jobs. A separate interactive worker owns message sends and comment actions, so a long media job cannot block a reply. Worker groups and stream supervisors cancel and join at shutdown. The existing recovery sweep remains owned once by the general worker.

Provider callbacks persist receipts before acknowledgement and enqueue an immediate coalesced drain. A one-second pending-receipt scan repairs lost wakeups, and a one-minute maintenance wake handles expired X subscriptions. Receipt processing is idempotent, bounded, and independently retryable per account. No request launches an untracked background delivery goroutine.

## Preserve one user operation across retries

Native keeps drafts editable offline, disables Send and retry, and checks connectivity again before dispatch. Reconnection refreshes stored reads and enables the action, but never submits a saved draft. A definite disconnect during local admission restores the unsent draft.

The client saves a random `client_operation_id` before submitting a DM or public reply. Admission binds it to the actor, Workspace and conversation or comment, plus a hash of the submitted content. An identical replay returns the original message or job. Reusing the ID with different content returns a conflict. Two intentional messages with identical text have different operation IDs.

DM provider writes keep a stable fence based on the canonical local message ID. An echo received before the send response converges by remote message ID while retaining that local ID. The client reconciles optimistic rows using `client_operation_id`. Provider acceptance establishes Sent; it does not invent typing, delivery, or read state. Mastodon reply targets are captured at admission, so later incoming messages do not retarget a retry or change its provider-write fingerprint. Send finalization honors remote deletion identities even when deletion precedes the response or echo; it preserves the accepted receipt while redacting the canonical message.

A definite pre-send failure may be retried through the dedicated retry endpoint. An uncertain provider write remains inspectable and blocks automatic resend. Public-reply admission receipts outlive pruned job history, so a lost response cannot cause a second public reply on replay. Refresh responses expose active Workspace collection job IDs, and `/jobs/{id}` authorizes Inbox receipts through their Workspace scope. A refresh is complete only after those jobs finish, not when they are enqueued. Moderation completion updates stored state and the change journal in one transaction.

## Verify and operate

Migrations 165 through 169 are additive for SQLite and PostgreSQL. Run migration once before separate Hosted web and worker roles. Self-hosted `all` follows the existing automatic migration policy. Downgrading binaries requires stopping new Inbox workers and explicit paid subscriptions first; keep the additive tables and unreconciled provider-write/cost records.

The focused tests cover request replay, echo races, unread/archive behavior, stale reaction snapshots, credential revocation, foreground coalescing, queue separation, and PostgreSQL commit ordering. Run them in Devenv:

```sh
devenv shell -- bash -c 'cd apps/server && go test ./internal/services/messaging ./internal/services/engagement ./internal/services/inboxchanges ./internal/services/providerinbox ./internal/services/oauth2messaging ./internal/queue ./internal/services/encryptionrotation'
```

Set `OPENPOST_TEST_POSTGRES_URL` to a disposable local PostgreSQL database for tests that create isolated temporary schemas. Native screenshots use the maintained sample entry and flow in `apps/mobile/tests/screenshots/`; they prove rendering and interaction with sample data, not a live provider round trip. Mobile push notifications and encrypted XChat are outside this implementation.
