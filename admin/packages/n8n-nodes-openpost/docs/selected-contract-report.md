# Selected OpenPost automation contract

Generated from the canonical OpenAPI `x-openpost-automation` metadata.

- Source version: 1.0.0
- Actions emitted: 22
- Checksum: 3824390aa6b182af8b196d457a4139491ba861c0d2e1e58faeaafba6e1b0ff7e

## Actions

| Resource         | Operation               | OpenAPI operation                                          | Effect          | Retry                | Idempotency |
| ---------------- | ----------------------- | ---------------------------------------------------------- | --------------- | -------------------- | ----------- |
| Workspace        | Get Many                | list-workspaces                                            | query           | transient            | none        |
| Account          | Get Many                | list-accounts                                              | query           | transient            | none        |
| Account          | Get Destination Options | get-account-destination-options                            | query           | transient            | none        |
| Account          | Lookup Mentions         | lookup-account-mentions                                    | query           | transient            | none        |
| Account          | Get Provider Readiness  | get-provider-readiness                                     | query           | transient            | none        |
| Social Set       | Get Many                | list-social-sets                                           | query           | transient            | none        |
| Social Set       | Get                     | get-social-set                                             | query           | transient            | none        |
| Posting Schedule | Get Next Available Slot | get-next-available-slot                                    | query           | transient            | none        |
| Media            | Get Many                | list-media                                                 | query           | transient            | none        |
| Media            | Upload Binary           | create-media-upload-session, complete-media-upload-session | local-mutation  | idempotent-transient | required    |
| Publication      | Get Many                | list-publications                                          | query           | transient            | none        |
| Publication      | Create                  | create-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Get                     | get-publication                                            | query           | transient            | none        |
| Publication      | Update                  | update-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Set Renditions          | upsert-publication-renditions                              | local-mutation  | idempotent-transient | required    |
| Publication      | Validate                | validate-publication                                       | query           | transient            | none        |
| Publication      | Schedule                | schedule-publication                                       | local-mutation  | idempotent-transient | required    |
| Publication      | Cancel                  | cancel-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Publish Now             | publish-publication-now                                    | external-action | idempotent-transient | required    |
| Publication      | Retry Failed Renditions | retry-failed-publication-renditions                        | external-action | idempotent-transient | required    |
| Publication      | Get Events              | list-publication-events                                    | query           | transient            | none        |
| Job              | Get                     | get-job                                                    | query           | transient            | none        |

## Findings

No findings.
