# Link management for OpenPost

Research date: 20 October 2026. Proposal only, not an implemented capability or a pricing change. Companion evidence: [Shlink and Dub review](link-management-competitors-2026-10-20.md).

## Recommendation

Build a focused Links feature inside each Workspace. Include one branded domain, link creation, and useful click analytics in every paid Workspace. Connect those links to the posts and variants that distribute them. Keep the existing Solo, Team, and Agency prices for launch.

Use the existing Go backend for redirects as well as management, permissions, subscriptions, and reports. Start with the application database and existing durable workers. Hosted uses PostgreSQL; self-hosting retains SQLite support. Add caching or a separate redirect deployment only when measurements establish a need. Workers, D1, and an external queue are not part of the initial design.

This replaces the initial edge-first recommendation following the user's architecture review. The initial proposal optimized for hypothetical global traffic before establishing a backend limitation. No redirect benchmark was performed, so neither backend capacity nor a need for serverless infrastructure has been demonstrated.

Published links must keep redirecting when a monthly analytics allowance runs out. Restrict analytics collection or detail, rather than turning a successful campaign into broken links. This commitment does not override deliberate deletion, expiry, abuse intervention, or an explicitly disclosed account-closure policy.

## Existing product and ownership

The [live pricing page](https://openpo.st/pricing) and [plan catalogue](../../packages/plan-catalog/src/catalog.json) currently agree: Solo is $29/month or $290/year for one Workspace; Team is $59/$590 for three; Agency is $99/$990 for ten. Prices are USD before tax. The existing plans share tools and most per-Workspace allowances. There is no current Pro tier.

[Billing and usage](../development/billing-and-usage.md) records Organization subscriptions, Workspace usage counters, saved entitlement snapshots, and no automatic usage billing. [PRODUCT.md](../../PRODUCT.md) makes Workspaces the boundary for a brand's accounts, content, and collaborators. The [models](../../apps/server/internal/models/models.go) and [workspace access service](../../apps/server/internal/services/workspaceaccess/access.go) implement that split.

| Resource or decision                                | Proposed owner                | Reason                                                                                |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Links, destinations, tags, campaigns, click reports | Workspace                     | Keep a client's brand and results together and isolated from other clients.           |
| Connected branded hostname                          | One Workspace                 | Avoid ambiguous slug ownership, domain transfers, and cross-client analytics.         |
| Subscription and purchased capacity                 | Organization                  | Reuse existing billing and entitlement authority.                                     |
| Included allowances                                 | Each Workspace, independently | Match current pricing. Do not introduce pooled link allowances in this first release. |
| Hostname uniqueness                                 | Whole deployment              | The same hostname cannot be claimed by two Workspaces or Organizations.               |

Workspace admins connect or remove domains; editors manage links and placement choices; viewers can inspect authorized reports. Implement through existing access checks rather than a new role system. Require a distinct audited workflow for any later domain or Workspace transfer. Domain verification establishes control of a hostname, not ownership of every brand name in its slug space.

Do not share one branded hostname across Workspaces initially. An Organization-wide domain pool could come later if real customers need it. It introduces reservation, assignment, transfer, and namespace policies without improving the first founder workflow.

## Product scope

The [competitor review](link-management-competitors-2026-10-20.md) supports three concrete lessons. [Shlink](https://shlink.io/features/) provides a strong self-hosted baseline: multiple domains, custom slugs, tags, API access, and visit reporting. [Dub](https://dub.co/pricing/links) adds a polished hosted experience and a larger attribution product; Pro currently lists $30/month, 1,000 new links, 50,000 tracked events, and ten domains. Its free plan already includes three domains, so a single bundled domain is useful convenience rather than a category-leading domain allowance. [Dub keeps redirects running over normal analytics quotas](https://dub.co/help/article/dub-analytics-limits), but gates analytics access. OpenPost should preserve already-collected history and disclose any subsequent gap instead.

Shlink is MIT-licensed; Dub's core is AGPLv3 with separate enterprise terms. The companion report pins reviewed source revisions and licensing links. Build the small native OpenPost boundary rather than embedding another product's authorization and subscription model. This proposal makes the final recommendation where the independent review suggests alternatives: keep allowances per Workspace, defer bulk migration until the core works, and offer basic expiry in the first release.

### Ship first

1. **Link library:** destination URL, generated or custom slug, title, campaign/tags, search, copy, edit, pause, optional expiry, and export. Keep an audit trail for destination edits. Do not reuse deleted slugs. Pausing a link must be a deliberate action with an inspectable result.
2. **Branded domains:** start with a subdomain such as `go.example.com`, DNS ownership verification, managed HTTPS, a default domain, and useful pending/error/recovery states. Offer an OpenPost-managed short domain so users can start before changing DNS. Keep that domain separate from the main marketing, login, and transactional-email domains.
3. **Composer integration:** an explicit “Track this link” action, destination preview, optional UTMs, and the choice to use one link or separate links for each variant. Save link identities before publishing, reuse them on retries, and preserve the user's original URL and authored text decisions.
4. **Reports:** clicks over time, country, referrer domain, broad device category, campaign, and originating post/variant. Show last processed time, collection gaps, and unknown dimensions. Export reports. Distinguish our link clicks from provider-reported clicks and impressions.
5. **Portable access:** typed HTTP API and the same Workspace/scoped authorization through CLI and MCP; basic mobile create/copy/view support. Reuse generated contracts and query-catalog reads. Web owns initial DNS setup and detailed reports.
6. **Simple QR download:** encode the saved short URL locally as SVG/PNG. The QR stays useful after destination edits; do not introduce a separate “dynamic QR” object or charge per scan.
7. **Abuse controls:** authenticated creation, creation-rate limits, destination validation, reporting/takedown, and domain-level or link-level suspension. Domain certificates and traffic must never be accepted solely because someone typed a hostname. Accept only HTTP(S) destinations, reject embedded credentials, control characters, unsafe/local targets, and known redirect loops. Any server-side preview or safety fetch must also validate DNS resolution and every redirect hop against SSRF. Do not fetch destinations on the redirect path.

Illustrative workflow: a founder publishes a launch to LinkedIn and X and shares it in a newsletter. Each placement gets a stable branded link pointing to the launch page. The founder sees which placement generated clicks next to its post. Sharing a placement link elsewhere still attributes to that link, so this measures link placement, not a provable visitor acquisition source.

### Defer until demand exists

| Feature                                        | Disposition                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV/domain migration from Dub or Shlink        | Add after the core path works; preserving existing URLs requires control of the original hostname and slug. Export is available from launch. |
| Estimated unique visitors                      | Add only with a documented privacy-preserving definition and accuracy limits. V1 click counts are simpler and more honest.                   |
| Geographic/device routing and A/B destinations | Defer. They complicate cache keys, statistical interpretation, and previews.                                                                 |
| Password-protected links                       | Defer. Authentication/interstitials are a separate product contract.                                                                         |
| Conversion/purchase attribution                | Defer. A redirect cannot observe a sale without destination-side integration.                                                                |
| Custom social preview cards                    | Defer. They need crawler-specific behavior, safe asset handling, and platform tests.                                                         |
| Link-in-bio pages                              | Separate product decision; these are hosted pages rather than redirects.                                                                     |
| Click event webhooks                           | Later, through the existing external-webhook owner, not an independent delivery system.                                                      |
| Apex domains and wildcard domains              | Defer. Subdomain CNAME onboarding covers the useful first case.                                                                              |
| Organization-shared branded domains            | Defer until cross-Workspace namespace rules are justified.                                                                                   |

Do not build affiliate programs, payouts, ad retargeting pixels, fingerprinting, arbitrary scripts, a domain registrar, or a public anonymous shortening endpoint as part of this feature. The useful connection to OpenPost is publishing and understanding content outcomes.

### Existing URL semantics to preserve

[`services/publicationlink`](../../apps/server/internal/services/publicationlink/link.go) already resolves canonical segment `settings.link.destinations[accountID]` into provider URL settings. [Social preview contracts](../development/social-previews.md) distinguish authored choices from generated projections. This service is not an existing URL shortener.

Introduce a separate link-management owner. Integrate through the existing composer and Publication mutation boundaries, with explicit stored placement references. Do not create short URLs inside a provider retry, silently replace all authored URLs, flatten independent account choices, or make opening a preview create links. Resolve relevant provider rules and previews using the effective URL that will actually publish. Saved placements retain the link ID, Publication/Rendition/segment identity where applicable, and destination version used for interpretation. Deleting a post does not delete its distributed link.

UTM application is opt-in and previews the resulting destination. Preserve saved query strings and fragments; warn or decline mutation of signed URLs. Do not blindly append arbitrary visitor query parameters to the destination. Never interpret `?url=...` as an alternative redirect destination.

## Pricing proposal

### Included at the current prices

|                                          |      Solo |      Team |    Agency |
| ---------------------------------------- | --------: | --------: | --------: |
| Existing monthly price                   |       $29 |       $59 |       $99 |
| Existing annual total                    |      $290 |      $590 |      $990 |
| Workspaces                               |         1 |         3 |        10 |
| Included branded hostnames               |         1 |         3 |        10 |
| New links per month, per Workspace       |     1,000 |     1,000 |     1,000 |
| Analyzed clicks per month, per Workspace |   100,000 |   100,000 |   100,000 |
| Daily total history                      | 12 months | 12 months | 12 months |
| Dimension breakdown history              |   30 days |   30 days |   30 days |

One branded hostname means one connected hostname, such as `go.example.com`; it is not a supplied domain registration. It does not include wildcard hostnames. New-link and click allowances reset in the UTC calendar month, including annual subscriptions. Custom and shared-domain links consume the same link allowance. Destination edits and publish retries do not create a new billable link. A deliberate clone or distinct channel placement does.

This retains the existing “same tools, more Workspaces and people” pricing model. Agency has up to one million analyzed clicks across ten independent Workspace allowances; include that scenario in load and cost verification. Avoid a separate Pro plan or a compulsory links subscription.

**Launch with fixed included allowances and no paid overages.** At 80% and 100%, show clear usage notices. At the analytics limit, retain the history already collected, mark subsequent reporting as incomplete, and keep redirects working. Stop persisting further detailed click events for that Workspace after the asynchronous limit decision propagates. The limit is a product allowance, not an exact synchronous traffic gate; account for a bounded pipeline overshoot. Never show capped totals as actual total traffic or hide already-earned analytics behind an upgrade.

Later add-on hypothesis, only after observing usage: **$5/month for another hostname** and **$10/month for another 100,000 analyzed clicks**, assigned to a named Workspace and bought explicitly. These are proposed value/support prices, not measured cost pass-throughs. They need catalogue, checkout, tax, entitlement, cancellation, and copy work. The current public “no additional usage charges” claim must be revised accurately before offering paid capacity; do not quietly introduce usage invoices. Do not offer paid analytics recovery unless those events were actually retained.

Normal quota exhaustion and cancellation are different. Proposed closure contract: redirects survive through the paid period and a clearly notified 30-day migration grace; then return a deliberate gone response. Export destinations and reports, never recycle slugs, and explain that OpenPost-managed shared-domain URLs cannot be moved to another provider under that hostname. Cancellation behavior needs an explicit product decision before launch; indefinite free hosting is not assumed in these economics.

## Backend architecture

### Redirect request

Use a small public handler in the existing Go HTTP stack. It resolves a verified hostname and slug before authenticated application or SPA fallback handling. It does not render the frontend, hydrate a session, invoke AI, call providers, or query billing. Keep application hostnames on their existing routing path.

1. Normalize and validate the hostname, method, and slug. Resolve only a registered active domain, with a globally unique hostname and a unique slug within that domain. Trust forwarded host/client information only through the existing trusted-proxy boundary.
2. Look up the destination, status, expiry, Workspace, and revision through an indexed database query. Check expiry at request time. Start with database reads rather than an extra replicated projection.
3. For an eligible click, attempt one compact event insert with a short bounded database deadline. Keep parsing/filtering bounded. If recording fails or times out, count the collection failure and still return the valid redirect. Heavy aggregation, enrichment, and reporting run later.
4. Return one `302` redirect to the saved destination, with browser caching disabled. `HEAD` resolves without counting a click; unsupported methods are rejected. Go already provides [HTTP redirect support](https://pkg.go.dev/net/http#Redirect); there is no need for an external redirect runtime.

The compact insert is deliberately on the request path to make accepted events durable without a new queue service. It adds a database operation, so measure its cost rather than describing collection as latency-free. Do not spawn an untracked goroutine per click or use an in-memory buffer as the only event record. If this write becomes the bottleneck, investigate bounded batching or a durable spool as a measured next step.

This is a single authoritative link store. A saved link is available after its transaction commits and its verified domain is active. There is no separate edge Preparing state or projection acknowledgement. Publication dispatch checks referenced links are still active and respects the author's explicit tracking choice. Retrying publishing never creates another link.

### Background analytics

Persist append-only sanitized click events in the same database. Reuse the existing database-backed worker for bounded aggregation batches and retention cleanup. Do not create a full job for every click. Aggregate a batch and mark its events processed in the same transaction, so job retries cannot increment totals twice. Multiple workers must claim batches safely and reports must not rescan the entire raw-event history on every read.

Keep 7 days of sanitized raw events, 30 days of bounded dimension breakdowns, and 12 months of daily totals. Aggregate before pruning. Preserve occurrence time across delayed processing and month boundaries. Bound dimension cardinality with an Other bucket. Treat filter changes as versioned semantics, not a silent historical rewrite.

V1 **analyzed click** means a successfully resolved GET after known bots, preview/prefetch requests, and our probes are filtered. Repeated valid GETs count again. This is neither unique people nor verified human activity. HEADs, failed lookups, and known crawlers do not consume the customer allowance. Country and referrer can be unknown or approximate. Country reporting needs an explicitly trusted ingress signal or a separately selected local geolocation database; do not trust arbitrary incoming location headers or add a remote geolocation call to each click.

Record timestamp, stable link/revision IDs, broad device category, country when available, and referrer hostname only. Do not persist full IPs, raw user agents, full referrer paths/queries, cookies, or URL secrets in click events or logs. Destination-side JavaScript is unnecessary for click counting. Review the actual data flow before launch rather than assuming cookie-free collection settles privacy obligations.

Enforce analytics admission through the existing durable usage owner and bounded batch transactions, outside destination resolution. Once a Workspace exhausts its allowance, stop retaining additional detailed analytics, preserve collected history, mark the gap, and continue redirects. Do not serialize all clicks on an Organization-wide usage row or call Paddle per request. Bound and measure any batch allowance overshoot.

### Cache only if needed

First benchmark indexed lookup plus compact event insertion. If lookups are a material contributor, add a bounded per-process cache keyed by hostname and slug. Keep status, destination revision, and expiry together. Invalidate local entries after committed mutations; handle delete, pause, and hostname removal as well as destination edits.

With multiple web replicas, local invalidation alone is insufficient. Keep reads authoritative until there is a tested cross-replica invalidation strategy and a documented stale-state bound. Never introduce a cache that makes emergency suspension or a just-created link unreliable merely to improve a benchmark. Avoid negative caching initially. Never cache the final HTTP redirect in a way that bypasses click collection.

### Custom-domain onboarding

Domains need DNS ownership verification, ingress routing, and certificates regardless of where the redirect code runs. Use the existing reverse-proxy/TLS boundary. Confirm its actual deployment and supported dynamic-hostname mechanism before choosing implementation details; the repository's Compose manifests alone do not establish the live ingress configuration.

Start with customer subdomains such as `go.example.com`, an unpredictable ownership challenge, and a CNAME to the short-link ingress. Provision routing and TLS only for verified hostnames. Show pending DNS, certificate, active, and recovery states; activate after live HTTPS and redirect probes pass. Reconcile renewal and failed provisioning through durable jobs. Limit pending reservations, and test CAA errors, domain removal, abandoned CNAMEs, and re-verification after loss of control. A random Host header must never authorize a domain claim or certificate issuance.

Managed certificate services can be considered if the existing ingress cannot safely automate this. They do not require moving redirects or analytics into serverless functions. This is the principal deployment integration still to inspect, rather than a reason to redesign the request runtime.

### Availability and scale

The first version shares the backend/database failure domain. It does not promise redirects continue through an application outage. Use existing readiness checks and deployment practices, and measure whether shared resource contention affects redirects or ordinary application use.

The larger reason for edge execution would be visitor-to-origin network distance or demonstrated availability/capacity requirements. It is not established that Go request handling is too slow. A very fast handler cannot remove a long network round trip, while a serverless label alone does not demonstrate faster user navigation.

Grow only in response to evidence:

| Observed limitation                                     | Next step to evaluate                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Lookup latency or database read pressure                | Query/index tuning, then a bounded cache with tested invalidation.                      |
| Analytics writes or aggregation contend with publishing | Tune batching, retention, and worker concurrency; isolate ingestion capacity if needed. |
| Redirect bursts disrupt the app                         | Separate redirect-serving Go processes using the same link owner and contracts.         |
| Single-origin availability is insufficient              | Dedicated redirect replicas/deployment and explicit failover requirements.              |
| Remote-region network latency misses the product target | Regional or edge serving behind the existing backend-owned model.                       |

Cloudflare Workers/D1/Queues are deferred options, not launch dependencies. The previous edge-vendor estimate is not a backend cost model and has been removed from this recommendation.

## Cost and verification

Reuse existing compute, database, and workers. This avoids another platform's fixed services and synchronization path, but traffic, event writes, retention, backups, domain certificates, and abuse response still consume resources. Do not claim zero incremental cost or quote a requests-per-second figure without measurement.

The proposed allowance is a monthly quantity, not a required instantaneous rate. For perspective, 100,000 clicks spread evenly across a 30-day month average about 0.039 requests/second; ten Workspaces using that amount average about 0.386 requests/second. Real campaigns have bursts, and abusive/filtered requests also consume server capacity, so these averages are not a capacity test.

Measure before adding infrastructure:

- Handler p50/p95/p99, separated into lookup, event insert, and other work; report errors and recording timeouts.
- End-to-end DNS/TLS/redirect timing from representative visitor regions, separately from handler duration.
- A viral hot link, many cold links, invalid-slug scans, and concurrent destination edits or suspensions.
- Event write throughput, connection-pool wait time, SQLite write contention, PostgreSQL pressure, and worker backlog while publishing and normal app reads continue.
- Compact event insertion versus bounded-write-failure behavior; successful navigation must not wait indefinitely for analytics.
- Analytics freshness, failed collection, duplicates, retention cleanup, and accurate quota-gap reporting.
- Backend restarts, multi-replica behavior, and the actual availability during deployment.

Keep the proposed product allowances and prices as hypotheses until these measurements establish operating headroom. No redirect benchmark or additional server deployment has been performed in this research session.

## Self-hosting and release boundary

Hosted and self-hosted use the same Go link owner, redirect behavior, database-backed events, and workers. Self-hosting supports SQLite by default and PostgreSQL as already documented. Operators map their verified short-link hostnames through their reverse proxy. No Cloudflare account, Redis, external queue, or analytics vendor is required.

Before implementation, record the spec and dependencies in Vikunja. Hindsight and Vikunja tools were not exposed in this research session, so no private task was inspected, created, or updated, and no durable decision was retained there. This file records research and a proposal, not approved product state or a mutable task board.

## Acceptance inputs for a future implementation

1. A paid Workspace connects a domain with verified DNS and TLS, creates a link, scans its QR, and changes the destination without changing the distributed URL.
2. Identical slugs on two domains never leak destinations or analytics. Workspace roles, delegated applications, API tokens, CLI, MCP, and mobile respect the same boundary.
3. Explicit per-variant tracking survives save/reopen, revision conflicts, scheduling, and publish retries. Provider previews and actual published URLs agree. A committed link on an active domain resolves without a separate projection step.
4. Bot/HEAD/prefetch requests do not consume the analyzed-click allowance; repeated valid GETs do. An aggregation retry increments totals once. Reports identify collection gaps and filter version.
5. Quota exhaustion preserves redirects and historical reports. Capacity is never billed without an explicit purchase. Annual subscriptions retain monthly UTC limits.
6. Destination edits, pause/delete, expiry, and hostname removal have authoritative outcomes. Any later cache addition proves cross-replica invalidation and refill races. Deleted slugs are not recycled.
7. Failed or slow analytics recording does not indefinitely delay navigation. Recording failures are visible; events never durably saved are not described as recoverable backlog. Backend/database outages are reported honestly.
8. DNS/CAA failure, certificate renewal failure, abandoned CNAMEs, duplicate claims, cancellation/export, and emergency takedown have exercised recovery paths.
9. Hosted ingress and backend revisions are proven against a test domain before rollout. Self-hosted SQLite works with the same feature. Relevant contracts and billing catalogue checks pass when those sources change.
10. Publish measured latency, burst capacity, resource contention, analytics freshness/loss, and operating costs before making performance claims.
