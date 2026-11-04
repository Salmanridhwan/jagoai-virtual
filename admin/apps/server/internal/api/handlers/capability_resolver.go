package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/uptrace/bun"
)

type CapabilityResolverHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	providers   map[string]platform.Adapter
	providersMu sync.RWMutex
	tokenSource AccessTokenSource
	publicMedia *publicurl.MediaVerifier
	readiness   *providerreadiness.Service
	connectors  *connectors.Registry
	store       *connectors.Store
	cacheMu     sync.Mutex
	cache       map[string]accountCapabilityCacheEntry
	// resolveConcurrency bounds provider work per resolve request. Tests set it
	// to 1 to compare the concurrent response with the sequential one.
	resolveConcurrency int
}

type accountCapabilityCacheEntry struct {
	result    platform.AccountCapabilityResult
	expiresAt time.Time
	storedAt  time.Time
}

func NewCapabilityResolverHandler(
	db *bun.DB,
	auth middleware.Authenticator,
	providers map[string]platform.Adapter,
	tokenSource AccessTokenSource,
) *CapabilityResolverHandler {
	return &CapabilityResolverHandler{
		db:                 db,
		auth:               auth,
		providers:          cloneProviderAdapters(providers),
		tokenSource:        tokenSource,
		cache:              map[string]accountCapabilityCacheEntry{},
		resolveConcurrency: 4,
	}
}

// publicationBuildAccountConstraints freezes the live account limits used by
// the composer so generation does not target a catalog maximum that the
// connected account cannot publish.
func (h *CapabilityResolverHandler) publicationBuildAccountConstraints(
	ctx context.Context,
	account models.SocialAccount,
	outputProfile string,
) map[string]any {
	if h == nil {
		return nil
	}
	adapter := h.adapterForResolveAccount(account)
	_, hasDynamicProvider := adapter.(platform.AccountCapabilityProvider)
	if account.Platform != capabilities.ProviderX && (!hasDynamicProvider || h.tokenSource == nil) {
		return nil
	}

	base := capabilities.Resolve(account.Platform, capabilities.ResolveInput{
		RequestedOutputProfile: strings.TrimSpace(outputProfile),
	})
	resolved := base
	h.mergeAccountCapability(ctx, account, "", "", nil, nil, &resolved)

	constraints := map[string]any{}
	if resolved.TextLimit != base.TextLimit || account.Platform == capabilities.ProviderX {
		constraints["text_limit"] = resolved.TextLimit
	}
	for _, key := range []string{
		"media_max_count",
		"max_image_size_bytes",
		"max_image_pixels",
		"max_video_duration_seconds",
		"max_video_size_bytes",
		"allowed_mimes",
	} {
		if value, ok := resolved.ActiveConstraints[key]; ok {
			constraints[key] = value
		}
	}
	return constraints
}

func (h *CapabilityResolverHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	h.publicMedia = verifier
}

func (h *CapabilityResolverHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

func (h *CapabilityResolverHandler) SetProvider(name string, adapter platform.Adapter) {
	h.providersMu.Lock()
	defer h.providersMu.Unlock()
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.providers[name] = adapter
}

func (h *CapabilityResolverHandler) SetConnectorRegistry(registry *connectors.Registry, store *connectors.Store) {
	h.connectors = registry
	h.store = store
}

type ResolveCapabilityMediaInput struct {
	MediaID string `json:"media_id" doc:"Media attachment ID"`
	AltText string `json:"alt_text,omitempty" doc:"Destination alt-text override"`
}

type ResolveCapabilitySegmentInput struct {
	ID          string                        `json:"id" doc:"Stable segment ID"`
	Content     string                        `json:"content,omitempty" doc:"Canonical segment body"`
	Title       string                        `json:"title,omitempty" doc:"Canonical segment title"`
	Description string                        `json:"description,omitempty" doc:"Canonical segment description"`
	URL         string                        `json:"url,omitempty" doc:"Canonical segment URL"`
	Media       []ResolveCapabilityMediaInput `json:"media,omitempty" doc:"Ordered segment media"`
	Settings    map[string]any                `json:"settings,omitempty" doc:"Authored segment settings, including attachment requirements"`
}

type ResolveCapabilitiesInput struct {
	Body struct {
		AccountIDs              []string                                   `json:"account_ids" minItems:"1" uniqueItems:"true" doc:"Connected account IDs"`
		Intent                  string                                     `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
		CreationPreset          string                                     `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset used only to choose initial destination formats"`
		RequestedOutputProfiles map[string]string                          `json:"requested_output_profiles,omitempty" doc:"Explicit or saved output profiles keyed by connected account ID"`
		SourceURL               string                                     `json:"source_url,omitempty" doc:"Canonical source URL"`
		Locale                  string                                     `json:"locale,omitempty" doc:"BCP 47 locale for option labels"`
		Region                  string                                     `json:"region,omitempty" doc:"ISO 3166-1 alpha-2 region"`
		Segments                []ResolveCapabilitySegmentInput            `json:"segments" minItems:"1" doc:"Ordered canonical segments"`
		AccountSegments         map[string][]ResolveCapabilitySegmentInput `json:"account_segments,omitempty" doc:"Effective segments for customized destinations, keyed by selected connected account ID"`
		Settings                map[string]map[string]any                  `json:"account_settings,omitempty" doc:"Destination settings keyed by connected account ID"`
	}
}

type ResolvedAccountCapability struct {
	AccountID          string                     `json:"account_id"`
	ImmediateReadiness providerreadiness.Decision `json:"immediate_readiness"`
	ScheduledReadiness providerreadiness.Decision `json:"scheduled_readiness"`
	capabilities.ResolvedCapability
}

type ResolveCapabilitiesOutput struct {
	Body struct {
		Accounts []ResolvedAccountCapability `json:"accounts"`
	}
}

func (h *CapabilityResolverHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "resolve-publishing-capabilities",
		Method:      http.MethodPost,
		Path:        "/capabilities/resolve",
		Summary:     "Resolve publishing capabilities for connected accounts",
		Tags:        []string{tagCapabilities},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 502},
	}, func(ctx context.Context, input *ResolveCapabilitiesInput) (*ResolveCapabilitiesOutput, error) {
		accounts, workspaceID, err := h.loadResolveAccounts(ctx, input.Body.AccountIDs)
		if err != nil {
			return nil, err
		}
		if err := providerReadinessWorkspaceAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		segments, err := h.resolveSegments(ctx, workspaceID, input.Body.Segments)
		if err != nil {
			return nil, err
		}

		output := &ResolveCapabilitiesOutput{}
		readiness := h.readiness
		if readiness != nil {
			// One request-scoped service shares provider facts across accounts
			// without leaking them into scheduling or publishing.
			readiness = readiness.RequestScoped()
		}
		entries, err := h.resolveAccounts(ctx, workspaceID, input, segments, accounts, readiness)
		if err != nil {
			return nil, err
		}
		output.Body.Accounts = entries
		return output, nil
	})
}

// resolveAccounts resolves every selected destination, bounded to a few
// concurrent workers. Provider latency dominates this request, so running
// destinations together turns the sum of their round trips into roughly one.
// Response order and the first error in request order are preserved.
func (h *CapabilityResolverHandler) resolveAccounts(
	ctx context.Context,
	workspaceID string,
	input *ResolveCapabilitiesInput,
	segments []capabilities.ResolveSegment,
	accounts []models.SocialAccount,
	readiness *providerreadiness.Service,
) ([]ResolvedAccountCapability, error) {
	limit := h.resolveConcurrency
	if limit < 1 {
		limit = 1
	}
	if limit > len(accounts) {
		limit = len(accounts)
	}
	// Resolve destination segment payloads before fan-out. Each distinct payload
	// refreshes public media once, so concurrent destinations cannot race on the
	// same media row or repeat its verification.
	segmentsByAccount, err := h.resolveAccountSegments(ctx, workspaceID, input, segments, accounts)
	if err != nil {
		return nil, err
	}
	if limit <= 1 {
		return h.resolveAccountsSequential(ctx, input, segmentsByAccount, accounts, readiness)
	}
	return h.resolveAccountsParallel(ctx, input, segmentsByAccount, accounts, readiness, limit)
}

// resolveAccountsSequential resolves each destination in request order.
func (h *CapabilityResolverHandler) resolveAccountsSequential(
	ctx context.Context,
	input *ResolveCapabilitiesInput,
	segmentsByAccount map[string][]capabilities.ResolveSegment,
	accounts []models.SocialAccount,
	readiness *providerreadiness.Service,
) ([]ResolvedAccountCapability, error) {
	entries := make([]ResolvedAccountCapability, 0, len(accounts))
	for _, account := range accounts {
		entry, err := h.resolveAccountEntry(ctx, input, segmentsByAccount[account.ID], account, readiness)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// resolveAccountsParallel resolves a bounded number of destinations at once,
// preserving response order and the first error in request order.
func (h *CapabilityResolverHandler) resolveAccountsParallel(
	ctx context.Context,
	input *ResolveCapabilitiesInput,
	segmentsByAccount map[string][]capabilities.ResolveSegment,
	accounts []models.SocialAccount,
	readiness *providerreadiness.Service,
	limit int,
) ([]ResolvedAccountCapability, error) {
	entries := make([]ResolvedAccountCapability, len(accounts))
	errs := make([]error, len(accounts))
	panics := make([]any, len(accounts))
	accountContexts := make([]context.Context, len(accounts))
	cancels := make([]context.CancelFunc, len(accounts))
	for index := range accounts {
		accountContexts[index], cancels[index] = context.WithCancel(ctx)
	}
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()

	var (
		mu sync.Mutex
	)
	fail := func(index int) {
		mu.Lock()
		defer mu.Unlock()
		// Only later destinations can be cancelled: an earlier failure still
		// owns the response error, so their outcome can never be reported.
		for later := index + 1; later < len(accounts); later++ {
			cancels[later]()
		}
	}

	slots := make(chan struct{}, limit)
	var wg sync.WaitGroup
	started := 0
dispatch:
	for index := range accounts {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			break dispatch
		}
		started++
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			defer func() { <-slots }()
			defer func() {
				if recovered := recover(); recovered != nil {
					log.Printf("capability resolve panic account=%s: %v\n%s",
						accounts[index].ID, recovered, debug.Stack())
					panics[index] = recovered
					fail(index)
				}
			}()
			entry, err := h.resolveAccountEntry(
				accountContexts[index], input, segmentsByAccount[accounts[index].ID], accounts[index], readiness,
			)
			if err != nil {
				errs[index] = err
				fail(index)
				return
			}
			entries[index] = entry
		}(index)
	}
	wg.Wait()
	for index := range accounts {
		if panics[index] != nil {
			panic(panics[index])
		}
		if errs[index] != nil {
			return nil, errs[index]
		}
	}
	if started < len(accounts) {
		return nil, ctx.Err()
	}
	return entries, nil
}

// resolveAccountSegments resolves the shared segments once and each distinct
// destination override once. Identical overrides reuse the same slice; entries
// clone it before mutation.
func (h *CapabilityResolverHandler) resolveAccountSegments(
	ctx context.Context,
	workspaceID string,
	input *ResolveCapabilitiesInput,
	segments []capabilities.ResolveSegment,
	accounts []models.SocialAccount,
) (map[string][]capabilities.ResolveSegment, error) {
	byAccount := make(map[string][]capabilities.ResolveSegment, len(accounts))
	resolvedPayloads := make(map[string][]capabilities.ResolveSegment)
	for _, account := range accounts {
		overrides, exists := input.Body.AccountSegments[account.ID]
		if !exists {
			byAccount[account.ID] = segments
			continue
		}
		if len(overrides) == 0 {
			return nil, huma.Error400BadRequest("destination segments must not be empty")
		}
		payload, err := json.Marshal(overrides)
		if err != nil {
			return nil, huma.Error400BadRequest("destination segments are invalid")
		}
		key := string(payload)
		if resolved, ok := resolvedPayloads[key]; ok {
			byAccount[account.ID] = resolved
			continue
		}
		resolved, err := h.resolveSegments(ctx, workspaceID, overrides)
		if err != nil {
			return nil, err
		}
		resolvedPayloads[key] = resolved
		byAccount[account.ID] = resolved
	}
	return byAccount, nil
}

func (h *CapabilityResolverHandler) resolveAccountEntry(
	ctx context.Context,
	input *ResolveCapabilitiesInput,
	segments []capabilities.ResolveSegment,
	account models.SocialAccount,
	readiness *providerreadiness.Service,
) (ResolvedAccountCapability, error) {
	// Capability resolution rewrites segment media while projecting text cards.
	// Every destination needs its own slice; identical overrides share one.
	// projectTextCards owns the copy that keeps shared media safe.
	accountSegments := append([]capabilities.ResolveSegment(nil), segments...)
	accountSegments = segmentsWithDestinationFields(accountSegments, input.Body.Settings[account.ID])
	resolveInput := capabilities.ResolveInput{
		Intent:                 input.Body.Intent,
		CreationPreset:         input.Body.CreationPreset,
		RequestedOutputProfile: input.Body.RequestedOutputProfiles[account.ID],
		SourceURL:              input.Body.SourceURL,
		Segments:               accountSegments,
		Settings:               input.Body.Settings[account.ID],
	}
	resolved, connectorBacked, err := h.resolveAccountCapability(ctx, account, input.Body.Locale, input.Body.Region, resolveInput)
	if err != nil {
		return ResolvedAccountCapability{}, huma.Error502BadGateway("connector capability resolution failed")
	}
	satisfyCanonicalURLRequirement(&resolved, input.Body.SourceURL, accountSegments)
	immediate := h.publicationReadiness(ctx, readiness, account, resolved.Capability, providerreadiness.OperationPublishImmediate, input.Body.Settings[account.ID])
	scheduled := h.publicationReadiness(ctx, readiness, account, resolved.Capability, providerreadiness.OperationPublishScheduled, input.Body.Settings[account.ID])
	if connectorBacked {
		immediate = connectorPublicationDecision(resolved.Compatible)
		scheduled = connectorPublicationDecision(resolved.Compatible)
	}
	return ResolvedAccountCapability{
		AccountID:          account.ID,
		ImmediateReadiness: immediate,
		ScheduledReadiness: scheduled,
		ResolvedCapability: resolved,
	}, nil
}

func (h *CapabilityResolverHandler) resolveAccountCapability(
	ctx context.Context,
	account models.SocialAccount,
	locale, region string,
	input capabilities.ResolveInput,
) (capabilities.ResolvedCapability, bool, error) {
	resolved, connectorBacked, err := h.resolveConnectorCapability(ctx, account, input)
	if err != nil || connectorBacked {
		return resolved, connectorBacked, err
	}
	resolved = capabilities.Resolve(account.Platform, input)
	h.mergeAccountCapability(ctx, account, locale, region, input.Settings, input.Segments, &resolved)
	return resolved, false, nil
}

func (h *CapabilityResolverHandler) resolveConnectorCapability(
	ctx context.Context,
	account models.SocialAccount,
	input capabilities.ResolveInput,
) (capabilities.ResolvedCapability, bool, error) {
	if h.connectors == nil || h.store == nil {
		return capabilities.ResolvedCapability{}, false, nil
	}
	binding, err := h.store.BindingForAccount(ctx, account.WorkspaceID, account.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return capabilities.ResolvedCapability{}, false, nil
	}
	if err != nil {
		logConnectorCapabilityError("binding_lookup", account, err)
		return capabilities.ResolvedCapability{}, false, err
	}
	client, entry, err := h.connectors.ClientForWorkspace(binding.InstallationID, account.WorkspaceID)
	if err != nil {
		logConnectorCapabilityError("client_setup", account, err)
		return capabilities.ResolvedCapability{}, true, err
	}
	if entry.Manifest.CapabilityRevision != binding.CapabilityRevision {
		err := errors.New("connector capability revision changed")
		logConnectorCapabilityError("binding_revision", account, err)
		return capabilities.ResolvedCapability{}, true, err
	}
	resolved := capabilities.ResolveCatalog(account.Platform, entry.Capabilities(), input)
	if resolved.OutputProfile == "" {
		return resolved, true, nil
	}
	dynamic, err := client.ResolveCapabilities(ctx, connectors.CapabilityResolveRequest{
		ConnectionRef: binding.ConnectionRef, OutputProfile: resolved.OutputProfile,
		Intent: firstResolvedIntent(resolved), Settings: input.Settings,
	})
	if err != nil {
		logConnectorCapabilityError("remote_resolve", account, err)
		return capabilities.ResolvedCapability{}, true, err
	}
	if dynamic.CapabilityRevision != binding.CapabilityRevision {
		err := errors.New("connector returned a stale capability revision")
		logConnectorCapabilityError("remote_revision", account, err)
		return capabilities.ResolvedCapability{}, true, err
	}
	for key, value := range dynamic.Constraints {
		resolved.ActiveConstraints[key] = value
	}
	if !dynamic.Available {
		reason := strings.TrimSpace(dynamic.UnavailableReason)
		if reason == "" {
			reason = "This connector destination is not available with the current settings."
		}
		if len(reason) > 240 {
			reason = reason[:240]
		}
		resolved.Compatible = false
		resolved.Issues = append(resolved.Issues, capabilities.ValidationIssue{
			Severity: "error", Code: "connector_destination_unavailable",
			Message: reason, FallbackMessage: reason, Provider: account.Platform,
			Profile: resolved.Profile, OutputProfile: resolved.OutputProfile,
		})
	}
	return resolved, true, nil
}

func logConnectorCapabilityError(stage string, account models.SocialAccount, err error) {
	var remoteErr *connectors.HTTPError
	httpStatus := 0
	if errors.As(err, &remoteErr) {
		httpStatus = remoteErr.StatusCode
	}
	log.Printf(
		"connector capability resolution failed stage=%s account=%s provider=%s error_type=%T http_status=%d canceled=%t deadline=%t",
		stage, account.ID, account.Platform, err, httpStatus,
		errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded),
	)
}

func connectorPublicationDecision(compatible bool) providerreadiness.Decision {
	if !compatible {
		return providerreadiness.Decision{State: providerreadiness.EffectiveStateDegraded}
	}
	return providerreadiness.Decision{
		State: providerreadiness.EffectiveStateHealthy, Executable: true,
		Publishable: true, Advertisable: true,
	}
}

func (h *CapabilityResolverHandler) publicationReadiness(
	ctx context.Context,
	readiness *providerreadiness.Service,
	account models.SocialAccount,
	capability capabilities.Capability,
	operation providerreadiness.Operation,
	settings map[string]any,
) providerreadiness.Decision {
	if readiness == nil {
		return providerreadiness.Decision{State: providerreadiness.EffectiveStateDegraded}
	}
	// Publication jobs certify the catalog contract; account limits only change preview validation.
	if canonical, found := capabilities.FindOutput(account.Platform, capability.OutputProfile); found {
		capability = canonical
	} else if canonical, found := capabilities.Find(account.Platform, capability.Profile); found {
		capability = canonical
	}
	return readiness.DecideAccountPublication(
		ctx,
		account,
		capability,
		operation,
		providerreadiness.ExecutionIntentProduction,
		providerreadiness.PublicationPolicyMode(account, capability, settings),
	)
}

func segmentsWithDestinationFields(segments []capabilities.ResolveSegment, settings map[string]any) []capabilities.ResolveSegment {
	if len(segments) == 0 || len(settings) == 0 {
		return segments
	}
	title, _ := settings["title"].(string)
	description, _ := settings["description"].(string)
	if strings.TrimSpace(title) == "" && strings.TrimSpace(description) == "" {
		return segments
	}
	cloned := append([]capabilities.ResolveSegment(nil), segments...)
	if strings.TrimSpace(cloned[0].Title) == "" {
		cloned[0].Title = title
	}
	if strings.TrimSpace(description) != "" && strings.TrimSpace(cloned[0].Body) == "" {
		cloned[0].Body = description
	}
	return cloned
}

func (h *CapabilityResolverHandler) loadResolveAccounts(ctx context.Context, accountIDs []string) ([]models.SocialAccount, string, error) {
	ids := uniqueNonEmpty(accountIDs)
	if len(ids) == 0 {
		return nil, "", huma.Error400BadRequest("at least one account_id is required")
	}
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().
		Model(&accounts).
		Where("id IN (?)", bun.List(ids)).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, "", huma.Error500InternalServerError("failed to load connected accounts")
	}
	if len(accounts) != len(ids) {
		return nil, "", huma.Error404NotFound("one or more connected accounts were not found")
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	workspaceID := accounts[0].WorkspaceID
	for _, account := range accounts {
		if account.WorkspaceID != workspaceID {
			return nil, "", huma.Error400BadRequest("all accounts must belong to one workspace")
		}
		byID[account.ID] = account
	}
	ordered := make([]models.SocialAccount, 0, len(ids))
	for _, id := range ids {
		ordered = append(ordered, byID[id])
	}
	return ordered, workspaceID, nil
}

func (h *CapabilityResolverHandler) resolveSegments(
	ctx context.Context,
	workspaceID string,
	inputs []ResolveCapabilitySegmentInput,
) ([]capabilities.ResolveSegment, error) {
	if len(inputs) == 0 {
		inputs = []ResolveCapabilitySegmentInput{{ID: "segment-1"}}
	}
	mediaIDs := []string{}
	for _, segment := range inputs {
		for _, media := range segment.Media {
			mediaIDs = append(mediaIDs, media.MediaID)
		}
	}
	mediaByID := map[string]models.MediaAttachment{}
	ids := uniqueNonEmpty(mediaIDs)
	if len(ids) > 0 {
		var media []models.MediaAttachment
		if err := h.db.NewSelect().
			Model(&media).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(ids)).
			Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to load media for capability resolution")
		}
		if len(media) != len(ids) {
			return nil, huma.Error400BadRequest("one or more media attachments are invalid or outside this workspace")
		}
		for index := range media {
			if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, &media[index]); err != nil {
				return nil, huma.Error500InternalServerError("failed to refresh public media status")
			}
			item := media[index]
			mediaByID[item.ID] = item
		}
	}

	segments := make([]capabilities.ResolveSegment, 0, len(inputs))
	for index, input := range inputs {
		segment := capabilities.ResolveSegment{
			ID:          publicationFirstNonEmpty(input.ID, fmt.Sprintf("segment-%d", index+1)),
			Body:        input.Content,
			Title:       input.Title,
			Description: input.Description,
			Settings:    input.Settings,
			URL:         input.URL,
		}
		for _, mediaInput := range input.Media {
			media := mediaByID[mediaInput.MediaID]
			segment.Media = append(segment.Media, capabilities.MediaItem{
				ID:              media.ID,
				MimeType:        media.MimeType,
				Size:            media.Size,
				Width:           media.Width,
				Height:          media.Height,
				DurationMS:      media.DurationMS,
				FrameRate:       media.FrameRate,
				VideoCodec:      strings.ToLower(media.VideoCodec),
				AudioCodec:      strings.ToLower(media.AudioCodec),
				AudioChannels:   media.AudioChannels,
				AltText:         publicationFirstNonEmpty(mediaInput.AltText, media.AltText),
				AnalysisStatus:  media.AnalysisStatus,
				AnalysisError:   media.AnalysisError,
				PublicURLReady:  media.PublicURLReady,
				PublicURLStatus: media.PublicURLStatus,
				PublicURLError:  media.PublicURLError,
				URL:             "/media/" + media.ID,
			})
		}
		segments = append(segments, segment)
	}
	return segments, nil
}

//nolint:gocyclo
func (h *CapabilityResolverHandler) mergeAccountCapability(
	ctx context.Context,
	account models.SocialAccount,
	locale string,
	region string,
	settings map[string]any,
	segments []capabilities.ResolveSegment,
	resolved *capabilities.ResolvedCapability,
) {
	applyAccountDestinationSettings(account, settings, resolved)
	if account.Platform == capabilities.ProviderX {
		applyDynamicCapabilityConstraints(resolved, standardXPublishingCapabilities().Constraints, segments, settings)
	}
	adapter := h.adapterForResolveAccount(account)
	provider, ok := adapter.(platform.AccountCapabilityProvider)
	if !ok || h.tokenSource == nil {
		return
	}
	capabilityInput := platform.AccountCapabilityInput{
		Intent:        firstResolvedIntent(*resolved),
		OutputProfile: resolved.OutputProfile,
		MediaShape:    firstResolvedMediaShape(*resolved),
		Locale:        locale,
		RegionCode:    region,
		Settings:      settings,
	}
	keyScope := ""
	if keyer, narrow := adapter.(platform.AccountCapabilityKeyer); narrow {
		// The adapter owns which inputs can change its provider answer. Without
		// this, every destination setting edit re-fetches provider state.
		keyScope = keyer.AccountCapabilityKeyInput(capabilityInput)
	} else {
		keyScope = strings.Join([]string{
			resolved.OutputProfile,
			firstResolvedIntent(*resolved),
			firstResolvedMediaShape(*resolved),
			strings.ToLower(strings.TrimSpace(locale)),
			strings.ToUpper(strings.TrimSpace(region)),
			accountCapabilitySettingsKey(settings),
		}, "|")
	}
	cacheKey := strings.Join([]string{
		account.ID,
		accountCapabilityTenantKey(account),
		keyScope,
	}, "|")
	result, expiresAt, ok := h.cachedAccountCapability(cacheKey)
	if !ok {
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			h.addDynamicCapabilityFailure(resolved, settings, "Account authorization could not be refreshed.")
			return
		}
		result, err = provider.ResolveAccountPublishingCapabilities(ctx, accessToken, capabilityInput)
		if err != nil {
			h.addDynamicCapabilityFailure(resolved, settings, err.Error())
			return
		}
		if persistErr := persistAccountCapabilityState(ctx, h.db, account.ID, result); persistErr != nil {
			// Persisted state is not authoritative for this resolution. Keep the
			// verified answer, but tell the user that other surfaces may show
			// stale account limits until the next successful write.
			log.Printf("capability state persist failed account=%s: %v", account.ID, persistErr)
			resolved.Issues = append(resolved.Issues, capabilities.ValidationIssue{
				Severity:        "warning",
				Code:            "account_capability_cache_failed",
				Message:         "Account limits were verified but could not be cached.",
				Provider:        account.Platform,
				Field:           "capabilities",
				FallbackMessage: "Account limits were verified but could not be cached.",
			})
		}
		expiresAt = time.Now().UTC().Add(accountCapabilityTTL(account.Platform))
		h.storeAccountCapability(cacheKey, result, expiresAt)
	}
	resolved.ExpiresAt = expiresAt.Format(time.RFC3339)
	if result.Revision != "" {
		resolved.CapabilityRevision += "+" + result.Revision
	}
	if result.UnavailableReason != "" {
		resolved.UnavailableReason = result.UnavailableReason
		resolved.Compatible = false
	}
	resolved.DynamicOptions = map[string][]capabilities.Option{}
	resolved.CompleteOptionSources = result.CompleteOptionSources
	for source, options := range result.Options {
		for _, option := range options {
			resolved.DynamicOptions[source] = append(resolved.DynamicOptions[source], capabilities.Option{
				Value: option.Value,
				Label: option.Label,
			})
		}
	}
	for key, value := range result.Constraints {
		resolved.ActiveConstraints[key] = value
	}
	applyDynamicCapabilityConstraints(resolved, result.Constraints, segments, settings)
	for settingIndex := range resolved.Settings {
		setting := &resolved.Settings[settingIndex]
		if available, exists := result.AvailableFeatures[setting.Key]; exists {
			if available {
				setting.UnavailableReason = ""
			} else {
				setting.UnavailableReason = "This setting is not available for the connected account."
			}
		}
	}
	for groupIndex := range resolved.SettingGroups {
		for settingIndex := range resolved.SettingGroups[groupIndex].Settings {
			setting := &resolved.SettingGroups[groupIndex].Settings[settingIndex]
			if available, exists := result.AvailableFeatures[setting.Key]; exists {
				if available {
					setting.UnavailableReason = ""
				} else {
					setting.UnavailableReason = "This setting is not available for the connected account."
				}
			}
		}
	}
	for _, setting := range resolved.Settings {
		if !setting.Required || setting.OptionsSource == "" || !capabilitySettingDependenciesMet(setting, settings) {
			continue
		}
		if len(resolved.DynamicOptions[setting.OptionsSource]) == 0 {
			h.addDynamicCapabilityFailure(resolved, settings, setting.Label+" options are not available.")
			return
		}
	}
}

func satisfyCanonicalURLRequirement(
	resolved *capabilities.ResolvedCapability,
	sourceURL string,
	segments []capabilities.ResolveSegment,
) {
	if resolved == nil || resolved.ActiveConstraints["media_shape"] != capabilities.MediaShapeLink {
		return
	}
	hasURL := strings.TrimSpace(sourceURL) != ""
	for _, segment := range segments {
		hasURL = hasURL || strings.TrimSpace(segment.URL) != ""
	}
	if !hasURL {
		return
	}

	issues := resolved.Issues[:0]
	removed := false
	for _, issue := range resolved.Issues {
		if issue.Code == "setting_required" && (issue.Field == "url" || issue.Field == "link_url") {
			removed = true
			continue
		}
		issues = append(issues, issue)
	}
	if !removed {
		return
	}

	resolved.Issues = issues
	resolved.Compatible = strings.TrimSpace(resolved.UnavailableReason) == ""
	for _, issue := range issues {
		if issue.Severity == "error" {
			resolved.Compatible = false
			break
		}
	}
}

func applyDynamicCapabilityConstraints(resolved *capabilities.ResolvedCapability, constraints map[string]interface{}, segments []capabilities.ResolveSegment, settings map[string]any) {
	capabilities.ApplyAccountConstraints(resolved, capabilities.AccountConstraintInput{
		Segments: segments, Settings: settings, Constraints: constraints,
	})
	resolved.ActiveConstraints["text_limit"] = resolved.TextLimit
	resolved.ActiveConstraints["media"] = resolved.Media
	for index := range resolved.Settings {
		applyDynamicSettingConstraints(&resolved.Settings[index], constraints)
	}
	for groupIndex := range resolved.SettingGroups {
		for settingIndex := range resolved.SettingGroups[groupIndex].Settings {
			applyDynamicSettingConstraints(&resolved.SettingGroups[groupIndex].Settings[settingIndex], constraints)
		}
	}
}

func applyDynamicSettingConstraints(setting *capabilities.SettingDefinition, constraints map[string]interface{}) {
	switch setting.Key {
	case "poll_options":
		if value, ok := dynamicInt(constraints["poll_max_options"]); ok && value > 0 {
			setting.Constraints.MaxItems = value
		}
		if value, ok := dynamicInt(constraints["poll_option_max_length"]); ok && value > 0 {
			setting.Constraints.MaxLength = value
		}
	case "poll_expires_in_seconds":
		if value, ok := dynamicInt(constraints["poll_min_expiration_seconds"]); ok && value > 0 {
			minimum := float64(value)
			setting.Constraints.Minimum = &minimum
		}
		if value, ok := dynamicInt(constraints["poll_max_expiration_seconds"]); ok && value > 0 {
			maximum := float64(value)
			setting.Constraints.Maximum = &maximum
		}
	}
}

func dynamicInt(value interface{}) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

func dynamicInt64(value interface{}) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	default:
		return 0, false
	}
}

func (h *CapabilityResolverHandler) addDynamicCapabilityFailure(resolved *capabilities.ResolvedCapability, settings map[string]any, message string) {
	required := false
	for _, setting := range resolved.Settings {
		required = required || (setting.Required && setting.OptionsSource != "" && capabilitySettingDependenciesMet(setting, settings))
	}
	severity := "warning"
	code := "dynamic_options_unavailable"
	if required {
		severity = "error"
		code = "required_dynamic_options_unavailable"
		resolved.Compatible = false
	}
	resolved.Issues = append(resolved.Issues, capabilities.ValidationIssue{
		Severity:        severity,
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Provider:        resolved.Provider,
		Profile:         resolved.Profile,
		OutputProfile:   resolved.OutputProfile,
		Scope:           capabilities.SettingScopeDestination,
		Field:           "dynamic_options",
	})
}

func accountCapabilityTenantKey(account models.SocialAccount) string {
	// Credentials, instance identity, and the resolved adapter mode decide what
	// the provider will answer. CapabilityState is deliberately not hashed whole:
	// persisting it must not invalidate the entry that produced it.
	payload := strings.Join([]string{
		account.WorkspaceID,
		account.OAuthGrantID,
		account.GrantedScopes,
		account.InstanceURL,
		platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState),
	}, "\x00")
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}

func accountCapabilitySettingsKey(settings map[string]any) string {
	payload, err := json.Marshal(settings)
	if err != nil {
		return "invalid"
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

//nolint:gocyclo
func capabilitySettingDependenciesMet(setting capabilities.SettingDefinition, settings map[string]any) bool {
	for _, condition := range setting.Dependencies {
		value, exists := settings[condition.Key]
		present := exists && value != nil && strings.TrimSpace(fmt.Sprint(value)) != ""
		switch condition.Operator {
		case "present":
			if !present {
				return false
			}
		case "absent":
			if present {
				return false
			}
		case "equals":
			if !present || fmt.Sprint(value) != fmt.Sprint(condition.Value) {
				return false
			}
		case "not_equals":
			if present && fmt.Sprint(value) == fmt.Sprint(condition.Value) {
				return false
			}
		case "in":
			values := []string{}
			switch typed := condition.Value.(type) {
			case []string:
				values = typed
			case []any:
				for _, candidate := range typed {
					values = append(values, fmt.Sprint(candidate))
				}
			default:
				return false
			}
			found := false
			for _, candidate := range values {
				found = found || candidate == fmt.Sprint(value)
			}
			if !found {
				return false
			}
		}
	}
	return true
}

func (h *CapabilityResolverHandler) adapterForResolveAccount(account models.SocialAccount) platform.Adapter {
	key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
	h.providersMu.RLock()
	defer h.providersMu.RUnlock()
	return h.providers[key]
}

func (h *CapabilityResolverHandler) cachedAccountCapability(key string) (platform.AccountCapabilityResult, time.Time, bool) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	entry, ok := h.cache[key]
	if !ok || !entry.expiresAt.After(time.Now().UTC()) {
		delete(h.cache, key)
		return platform.AccountCapabilityResult{}, time.Time{}, false
	}
	return entry.result, entry.expiresAt, true
}

const accountCapabilityCacheLimit = 512

func (h *CapabilityResolverHandler) storeAccountCapability(key string, result platform.AccountCapabilityResult, expiresAt time.Time) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	if _, exists := h.cache[key]; !exists && len(h.cache) >= accountCapabilityCacheLimit {
		now := time.Now().UTC()
		for cachedKey, entry := range h.cache {
			if !entry.expiresAt.After(now) {
				delete(h.cache, cachedKey)
			}
		}
		// The key contains provider inputs, so distinct permutations would grow
		// the map without bound. Drop the oldest entries first.
		for len(h.cache) >= accountCapabilityCacheLimit {
			victim := ""
			var victimStoredAt time.Time
			for cachedKey, entry := range h.cache {
				if victim == "" || entry.storedAt.Before(victimStoredAt) {
					victim = cachedKey
					victimStoredAt = entry.storedAt
				}
			}
			if victim == "" {
				break
			}
			delete(h.cache, victim)
		}
	}
	h.cache[key] = accountCapabilityCacheEntry{result: result, expiresAt: expiresAt, storedAt: time.Now().UTC()}
}

func accountCapabilityTTL(provider string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case capabilities.ProviderTikTok:
		return 5 * time.Minute
	case capabilities.ProviderYouTube:
		return 15 * time.Minute
	case capabilities.ProviderMastodon:
		return time.Hour
	default:
		return 15 * time.Minute
	}
}

func firstResolvedIntent(resolved capabilities.ResolvedCapability) string {
	if len(resolved.Intents) == 0 {
		return ""
	}
	return resolved.Intents[0]
}

func firstResolvedMediaShape(resolved capabilities.ResolvedCapability) string {
	if shape, ok := resolved.ActiveConstraints["media_shape"].(string); ok {
		return shape
	}
	return ""
}
