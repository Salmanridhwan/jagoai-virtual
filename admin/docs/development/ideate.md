# Ideate

Ideate turns one source idea into four complete alternatives. The author compares actual posts, edits text or visual fields, switches account previews, and chooses one to create a draft. It does not publish automatically.

## Product flow

### Interface contract

This is a code-led Operate extension of the incumbent orange-brown Dither Workspace interface, using existing tokens and shared controls. No new visual world is introduced.

- **Thesis:** one idea becomes four actual posts; an explicit choice creates a draft.
- **First viewport:** labelled idea field, Attach, destination selector, Voice and context disclosure, and Give me four posts. Explain the disabled action when no account is selected.
- **Signature interaction:** switching accounts changes all four native previews together. Choosing one saves its editable visual and opens the draft composer.
- **Motion:** inherit restrained shared-control feedback and reduced-motion behavior, with no decorative or entrance animation.
- **User state:** preserve authored text and visual fields across reload. Draft selection and publication remain separate actions.

The entry screen has one idea field, optional attachments, the existing Social Set control, and **Give me four posts**. Voice, links, source notes, and explicit direction sit behind **Voice and context**. Attachments start as private generation context; the author explicitly permits each asset to appear in a post.

Results collapse the input into a short source summary. Four cards show native previews through `@openpost/social-preview`. Switching the account changes all four previews. Inline text edits and existing visual-field editors save to the durable build with its expected revision. Reloading restores the idea, attachments, account selection, context, voice selection, and edited alternatives.

There is no format quota. All four may be text when media would weaken the idea. Other supported treatments are an existing publishable source asset, a filled meme, a filled messages/group-chat/receipt/status-page document, or a required image/video upload. A visual may have an empty caption where the destination permits it.

**Use this post** saves only the selected generated visuals to the Workspace media library, retains editable recipes, and creates the canonical Publication and account Renditions. The composer retains its existing conflict review and undo behavior when applying a build to an open post.

## Generation and model roles

`publicationbuilder/options.go` owns the four-alternative path. `option_count: 4` selects it; omitted or zero preserves existing single-build behavior and persisted results.

1. Resolve one source, voice, and account-capability snapshot.
2. Plan four treatments using a compact semantic index of the complete meme catalogue and supported screenshot families. Preserve explicit author direction.
3. Load full metadata and blank images for selected meme templates. Generate captions and visual documents together, using source attachments as multimodal context.
4. Validate exact count, known accounts, native output limits, source references, publishability, compatible media, document structure, caption slots, and distinct authored content. One repair is allowed per generation stage within the build deadline.
5. Check concrete consistency with the configured Workflow decision model when available. Compare all four alternatives in one generative review for voice, caption/visual fit, and meaningfully different payoffs. Return actionable feedback for the bounded writer repair. Recheck structural and concrete consistency after that rewrite; do not start another subjective critique cycle.

The decider uses the existing `ai.Decider` boundary and `OPENPOST_WORKFLOW_DECISION_MODEL`, including Jev. Its criterion checks concrete source contradictions, explicit instruction mismatches, and meme panel-role reversals. It does not score humor, voice quality, distinctness, engagement, or virality. The live integration exposed over-rejection when these subjective criteria were combined; they are deliberately excluded. A rejection requests one writer repair. A separately unavailable decision provider falls back to the generative set reviewer. All returned call usage is recorded.

Each generation attempt has a 180-second deadline. The existing durable build job may retry a failed attempt once. Readers keep polling while that job remains runnable, instead of presenting a terminal failure prematurely. This version returns four validated options together, or a terminal failed build with explicit retry. It does not promise partial results or per-option AI regeneration. Individual visual rendering can be retried without regenerating the posts.

Account capability snapshots include all authoring shapes sharing the native output key. A text post and an image post may both use `x.post` or `linkedin.post`; retaining only the first catalogue entry would incorrectly remove memes and screenshot templates from generation. Native publication validation still checks the chosen output's actual attachment shape.

Standalone meme suggestions use the same complete semantic routing index. Selection sees meanings and mechanisms; caption writing sees only the selected full template metadata and blank images. Optional overlays can remain unused. Catalogue annotations help route the joke but are not proof that every template is interpreted correctly.

## Voice ownership

Existing reusable Voice Profiles remain authoritative. A Workspace default applies unless the account has an assignment or the build explicitly selects a profile. `/voice-profiles` edits identity, language, guidance, humor, formality, preferred words, avoided phrases, and approved examples. Other existing definition fields are preserved. Account assignment is explicit. Profile edits affect future generation, not saved builds or posts. Ordinary post edits do not silently train the profile.

## Missing assets and publication readiness

The first rendition segment stores `settings.attachment_requirement` with a typed image or video requirement and brief. It survives draft creation, composer hydration, and saving. Capability validation blocks scheduling and delivery until a ready asset of the matching type is attached. A video requirement cannot be satisfied by an image.

The author may remove a requirement, but must review and optionally change the associated text in an explicit dialog before saving without the attachment. This also releases that account's generated image/video format selection so capability resolution can choose a supported format for the revised content. Other accounts retain their requirements. Saving an incomplete draft remains allowed.

`option_commit.go` validates author edits, source references, document media ownership, and rendered asset readiness before choosing an option. Selection uses the revision read with the option snapshot. Competing choices cannot replace it; retries of the selected choice reuse the normal idempotent commit path. Every read and mutation remains actor- and Workspace-authorized.

## Platform research and editorial limits

Research checked on 2026-10-10 informed the design, rather than supplying universal writing formulas:

- X describes personalized action predictions and separate visibility filtering. Its parameter values are implementation defaults, not a universal post quality score. Keep ranking coefficients out of writing prompts. [Official algorithm](https://github.com/xai-org/x-algorithm)
- Meta reports aggregate associations between Threads conversations, original content, contextualized media, and views. These do not establish that every post needs a question or every cross-post needs rewriting. [Creator guidance](https://about.fb.com/news/2024/10/find-your-community-with-new-threads-educational-insights/)
- Bluesky supports custom feeds with independently chosen selection rules. There is no single public feed-eligibility formula. Feed-rule inference is outside this version. [Custom feeds](https://bsky.social/about/blog/7-27-2023-custom-feeds)
- Mastodon follows, boosts, hashtags, and visibility settings affect distribution. Preserve useful source links and media descriptions. [Posting documentation](https://docs.joinmastodon.org/user/posting/)

Reuse wording when it works. Adapt for actual voice, audience, limits, or media constraints. Never fabricate evidence to make a claim stronger. Fictional artifacts should read as jokes and use visible parody framing when plausible correspondence could be mistaken for real evidence.

Structural tests and successful live generation establish operation, not better humor or higher reach. Evaluate changes against representative ideas and approved voices, with blind author review. Track source fidelity, voice fit, meaningful alternatives, panel-role correctness, readable visuals, caption/visual fit, required edits, latency, and cost. Allow rejection of both the old and new result sets. No measured publishability uplift is claimed.

## Native mobile

The native `/ideate` screen uses the same durable four-option Builder, decision model, account capabilities, and voice defaults. Open it from Quick Capture or the Workspace menu. Attachments default to private context; the author explicitly allows each one to appear in a post. Voice and extra context stay behind a disclosure.

Results are four plain cards, with the proposed text and visual rather than platform preview shells. Different account wording is available in a compact disclosure. The displayed caption and visual come from the same destination. A failed secondary visual has a visible retry action. Source videos appear as labelled attachments.

Meme PNGs use the existing server renderer. Messages, group chats, receipts, and status pages use native SVG rendering and export the displayed artifact as a PNG. Selection uploads only the chosen option's visuals, retains each editable recipe, and calls the same option commit endpoint. It opens an ordinary draft and never publishes automatically. Native draft saves preserve destination formats, explicit empty captions, segment settings, and media. Adding a matching real asset satisfies the stored requirement without deleting it.

The latest build ID is restored from device storage scoped to the server, actor, and Workspace. A fresh Quick Capture handoff takes precedence. Generation continues through server jobs when the app closes; foregrounding resumes inspection. In-flight responses and selection are fenced against identity changes. Native screenshot fixtures remain outside the shipping entry.
