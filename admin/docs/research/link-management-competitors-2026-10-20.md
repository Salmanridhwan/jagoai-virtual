# Link management: Shlink, Dub, and pricing checks

**Retrieved:** 2026-10-20. Official public pages and source only. No customer accounts, paid checkouts, performance benchmarks, or production redirects were exercised. Recommendations are product judgment, not existing OpenPost behavior.

The [synthesized proposal](link-management-proposal-2026-10-20.md) records the final recommended scope and pricing. Recommendations below are the independent competitor review, including alternatives considered during synthesis.

**Source snapshots:** Dub [`cd8a4f5`](https://github.com/dubinc/dub/tree/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2); Shlink develop [`63261c7`](https://github.com/shlinkio/shlink/tree/63261c70e1827df30bbc1243618b6b339e26e1d6). Shlink's snapshot can include unreleased work. Pricing pages describe public offers; repository constants corroborate them, but are not proof of checkout state.

## Recommendation

Build branded links as the measurable final step of publishing: one campaign or destination link can point back to its post, variant, social account, and campaign. Preserve links created outside a post too. A useful first release is substantially smaller than either competitor's whole product.

Keep domains, links, and analytics authorized inside a Workspace. Apply paid entitlements and aggregate usage through the existing billing owner. Do not infer that Dub's word “workspace” maps to both of OpenPost's organization and Workspace concepts: Dub describes its workspace as its team/business boundary and bills each separately. [Dub workspace model](https://dub.co/help/article/what-is-a-workspace)

Do not stop redirects because normal analytics allowance runs out. Put allowance, retention, and explicit add-ons around analytics and creation, with an independent abuse control. No shortener can establish every clicker's identity, guarantee bot-free counts, or recover analytics already discarded.

## Current Dub offer

The current [Dub Links pricing page](https://dub.co/pricing/links) uses **tracked events**. Older indexed results still show $25/$75/$250 annual-equivalent pricing. Those figures are stale relative to the live page and current [pricing constants](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/packages/utils/src/constants/pricing/pricing-plans.tsx).

| Plan       | Monthly | Annual equivalent / annual payment | New links / month | Tracked events / month | Custom domains | Analytics retention  |
| ---------- | ------: | ---------------------------------: | ----------------: | ---------------------: | -------------: | -------------------- |
| Free       |      $0 |                                 $0 |                25 |                  1,000 |              3 | 30 days              |
| Pro        |     $30 |                         $27 / $324 |             1,000 |                 50,000 |             10 | 1 year               |
| Business   |     $90 |                         $81 / $972 |            10,000 |                250,000 |            100 | 3 years              |
| Advanced   |    $300 |                      $270 / $3,240 |            50,000 |              1,000,000 |            250 | 5 years              |
| Enterprise |  Custom |              Custom annual billing |        Negotiated |             Negotiated |     Negotiated | Unlimited advertised |

Annual payments above are arithmetic from source constants. The live page advertises 10% annual savings and 12 times usage upfront. Annual tracked-event pools are explicitly 600,000, 3 million, and 12 million, respectively. Public Enterprise marketing says unlimited for several dimensions, while source has finite configurable defaults, so do not treat “unlimited” as contractual capacity. [Pricing](https://dub.co/pricing/links), [constants](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/packages/utils/src/constants/pricing/pricing-plans.tsx), [analytics allowances](https://dub.co/help/article/dub-analytics-limits)

**Exceeding analytics allowance:** Dub continues redirecting and tracking, but requires an upgrade to view analytics. It says it does not currently bill overages. Usage exceeding four times Free allowance or twice paid allowance can prevent the next-period reset. Excessive abuse may disable links. This is materially different from a hard redirect cap. [Allowance and overage policy](https://dub.co/help/article/dub-analytics-limits)

## What competitors actually provide

### Shlink

Shlink is MIT-licensed, self-hosted PHP software with API, CLI, and separate web client. It offers custom slugs, multiple domains, tags, dynamic routing, date/visit access limits, scoped API keys, and third-party imports including Bitly and YOURLS. There is no per-click SaaS price in the reviewed upstream offer: operators supply infrastructure and operations. [Project](https://shlink.io/), [features](https://shlink.io/features/), [license](https://github.com/shlinkio/shlink/blob/63261c70e1827df30bbc1243618b6b339e26e1d6/LICENSE)

Visit analytics include location, user agent, and referrer. Geolocation uses MaxMind GeoLite2 and requires the operator's license key for updates. IP anonymization is the default; IP, user-agent, referrer, or all tracking can be disabled. No subscription-based analytics-retention tier was found in the reviewed documentation. This is not evidence that storage, backups, or deletion take care of themselves. [Tracking documentation](https://shlink.io/documentation/tracking-visits/)

Shlink flags **potential** bots using user-agent detection and lets API consumers filter them. Its documentation explicitly says detection cannot be completely accurate. Query forwarding merges incoming parameters and allows them to override stored values by default, with per-link opt-out. QR generation through the Shlink server is deprecated from 4.5.0, so new OpenPost work should not depend on that endpoint. [Detailed behavior](https://shlink.io/documentation/some-features/)

### Dub

Dub combines branded links and analytics with a separate, much broader affiliate and conversion product. Its link product has custom previews, password/expiration controls, mobile deep links, geographic/device routing, QR codes, folders, tags, and APIs. Pro already has most advanced link controls; Business adds conversion analytics, A/B testing, and event webhooks. [Plan comparison](https://dub.co/pricing/links)

Its analytics supports time series, country/device/referrer/UTM breakdowns, domain/tag/folder filters, real-time event streams, and CSV export. These are practical reporting patterns to study, without adopting every facet or exposing identifying event detail. [Analytics guide](https://dub.co/help/article/dub-analytics)

Custom Open Graph previews let authors set image, title, and description on paid plans. Video previews also exist through the API. Dub identifies platform caching as a cause of stale cards. OpenPost should present these as requested metadata with provider-dependent rendering, never guarantee that a network displays or refreshes a card. [Custom preview documentation](https://dub.co/help/article/custom-link-previews)

Dub offers CSV migration with destination, short URL, and optional metadata; its Bitly importer retains destination, slug, creation date, tags, and archive status. Those documented fields do not establish historical click import. Import links and test before switching DNS, which Dub also recommends. Shared vendor-owned domains cannot simply become customer-owned domains. [CSV import](https://dub.co/help/article/how-to-import-csv), [Bitly migration](https://dub.co/help/article/migrating-from-bitly)

## Click semantics and performance evidence

### Counts are not interchangeable

Dub's reviewed ordinary redirect recording path excludes detected bots and deduplicates by domain, slug, and an identity hash with a one-hour Redis TTL. That hash is SHA-256 of IP plus user-agent. Specific tracking API paths can skip this deduplication. Thus its default tracked clicks are neither every HTTP request nor a count of unique people. Shared networks, changing IP addresses, and changed user agents affect such estimates. [Recording implementation](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/tinybird/record-click.ts), [identity](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/middleware/utils/get-identity-hash.ts), [TTL](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/api/links/record-click-cache.ts)

Dub's bot code handles HEAD requests and user-agent patterns with explicit false-positive exceptions. Shlink's request tracker also skips forwarded HEAD requests, configured addresses, and disabled-tracking parameters. These details matter for social preview crawlers: fetching a preview must not silently become a successful human click. [Dub detector](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/middleware/utils/detect-bot.ts), [Shlink tracker](https://github.com/shlinkio/shlink/blob/63261c70e1827df30bbc1243618b6b339e26e1d6/module/Core/src/Visit/RequestTracker.php)

Recommendation: distinguish raw successful redirect requests, filtered clicks, and estimated unique visitors. Choose and document the paid event definition before pricing. Never label a filtered heuristic “verified human.” Keep unknown/missing referrer and location visible as unknown. A first release can omit unique visitors entirely rather than add cross-request identity merely for a second metric.

### Architectural lessons, not benchmark claims

Shlink recommends RoadRunner, which keeps the PHP application in memory and supports background tasks. FrankenPHP worker mode is supported; classic PHP bootstrapping per request is described as the least performant option. Its published comparison scores are qualitative, not reproducible latency benchmarks. [Runtime documentation](https://shlink.io/documentation/supported-runtimes/)

In the reviewed Shlink source, redirect handling resolves a link and invokes request tracking before returning the response. The visit tracker persists through a Doctrine transaction and emits an event. This is a straightforward relational design, but not evidence of a globally replicated read-only redirect path. [Action](https://github.com/shlinkio/shlink/blob/63261c70e1827df30bbc1243618b6b339e26e1d6/module/Core/src/Action/AbstractTrackingAction.php), [persistence](https://github.com/shlinkio/shlink/blob/63261c70e1827df30bbc1243618b6b339e26e1d6/module/Core/src/Visit/VisitsTracker.php)

Dub separates link cache resolution from analytic ingestion. Middleware reads its Redis cache, falls back to its database adapter, and schedules click processing with `waitUntil`. Redis failover deliberately skips tracking to preserve redirects; analytic recording sends events to Tinybird and streams. This explicitly favors redirect availability over complete analytics in some outages. Source establishes the design, not live latency, event durability, or zero-loss guarantees. [Middleware](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/middleware/link.ts), [recording](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/apps/web/lib/tinybird/record-click.ts)

For OpenPost, adopt the separation of fast redirect lookup from ingestion, enrichment, aggregation, billing, and webhook delivery. Do not copy the entire Dub stack merely to get this property. Measure warm and cold lookup latency, mutation propagation, and analytics loss under failure before promising speed or completeness.

## Adopt, defer, avoid

| Disposition         | Capability                                                                                             | Reason                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First release       | Verified custom domain/subdomain, managed TLS, custom slug, destination edits, root/404 behavior       | Core branded-link task and recovery. Domain ownership and slug collisions are correctness requirements.                                                 |
| First release       | Explicit composer integration, post/variant/campaign attribution, UTM templates                        | The reason to choose this inside a publishing tool. Unique per-placement links provide observable attribution; referrer alone cannot do that.           |
| First release       | Filtered click timeline, top links, country/device/referrer, CSV export, published counting rules      | Useful outcomes with limited dashboard complexity.                                                                                                      |
| First release       | CSV import/export, conflict preview, resumable import, DNS cutover checklist                           | Makes existing branded-domain adoption possible and keeps exit practical. Preserve slugs; do not fabricate historical counts.                           |
| First release       | Reuse existing QR rendering for link downloads                                                         | QR encodes the same redirect, not a separate routing system or measurement guarantee.                                                                   |
| Next                | Custom OG image/title/description                                                                      | Strong fit for social publishing, but crawler responses, caching, media storage, and provider-specific verification need their own acceptance criteria. |
| Next                | Expiration, scheduled destination changes, richer campaign filters and durable workflow events         | Useful after stable links and trustworthy counts.                                                                                                       |
| Defer               | A/B tests, geographic/device routing, deep links, public dashboards                                    | Increase redirect-path branching, privacy exposure, and support burden. Add when concrete customer needs justify them.                                  |
| Avoid in this scope | Affiliate payouts, lead/customer identity, conversion SDK, cloaking, email-open pixels, ad retargeting | These create different products and obligations with little benefit to initial post-click reporting.                                                    |
| Avoid               | Permanent redirects by default, surprise query overwrites, quota-driven dead links                     | Prevents editable-link behavior, attribution integrity, or durable published content.                                                                   |

This disposition is an OpenPost recommendation, not a claim that the competitors lack deferred capabilities.

## Pricing assessment for OpenPost

Against current Solo $29/month, Team $59, Agency $99, the proposed inclusion of **one domain, 1,000 new links, and 100,000 tracked filtered clicks per Workspace per month**, with no normal redirect cap, is credible bundled value. Solo approximately matches Dub Pro's new-link allowance and doubles its event volume, but Dub includes ten domains and is a fuller dedicated product. The distinction should be joined-up publishing outcomes, not a claim to be the cheapest shortener.

One domain is enough for a brand; an agency may need one per client Workspace. With ten workspaces, Agency could consume ten domains, 10,000 new links, and one million events for $99. Validate that aggregate scenario, concentrated bursts, malicious traffic, and non-paying link persistence before committing to it. Organization-level pooled analytics with Workspace-level access boundaries avoids stranded allowance, if compatible with existing billing behavior.

**$5/month per extra domain and $10 per extra 100,000 tracked clicks** are reasonable initial value-pricing hypotheses, not infrastructure-cost-derived prices. Domain count mostly expresses brand/support value, while event volume should reflect ingestion and retention cost. Use prepaid, explicit opt-in capacity or a visible analytics pause at the allowance. Show a coverage gap if collection stops; never silently discard data and imply complete charts. Keep normal redirects working. Do not enable automatic overage billing by default.

### Sanity checks

Bitly lists Free, annual-only Core $10/month, Growth $35 monthly or $29 annual-equivalent, and Premium $300 monthly or $199 annual-equivalent. Branded links start at Growth, with 500 links/month and 120 days of history; Premium gives 3,000 and one year. All list unlimited link clicks. Bitly's pricing row called “Redirects” means **destination edits**, not visits served, a terminology trap to avoid. [Official pricing](https://bitly.com/pages/pricing?_sm_nck=1)

Rebrandly's current page offers two custom domains/250 monthly links on Essentials, three/1,500 on Professional, and ten/3,500 on Growth. Its extracted HTML includes multiple price variants ($11/$8 and $16/$9 for Essentials, for example), so a single current monthly-versus-annual price is **not confirmed** here. Do not use it as a precise price anchor without checking the rendered locale and purchase flow. Its free plan advertises unlimited clicks/scans. [Official pricing](https://www.rebrandly.com/pricing)

## Reuse and licensing

Study both products' public behavior and architecture; implement the small redirect and management boundary in OpenPost's own stack. Shlink's MIT license is permissive, but adopting its complete PHP/Doctrine runtime would add a second operations and authorization system. Individual compatible libraries may be useful; none was selected by this research. [Shlink license](https://github.com/shlinkio/shlink/blob/63261c70e1827df30bbc1243618b6b339e26e1d6/LICENSE)

Dub is open core: AGPLv3 outside designated enterprise directories, which have separate terms. “Open source” does not mean unrestricted copying into OpenPost. Any code reuse needs explicit file-level license and compatibility review; do not transplant its application as an incidental implementation shortcut. [Dub license](https://github.com/dubinc/dub/blob/cd8a4f5816a953fffefcbd780c84f86d9e6a6ba2/LICENSE.md)

## Remaining uncertainty

No hosted latency or outage claims were independently measured. OpenPost-specific domain/TLS vendor cost, geographic latency, anti-abuse load, queue guarantees, privacy policy, and retention budget need separate architecture validation. Public pricing can change and checkout taxes were not assessed. The listed OpenPost proposals are not approved or shipped plan changes. Retention periods must distinguish detailed event retention from aggregated reporting before being sold.
