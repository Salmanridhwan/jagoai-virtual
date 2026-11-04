package main

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/uptrace/bun"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/queue"
	"github.com/openpost/backend/internal/services/providerinbox"
)

type inboxWorkers []*queue.BackgroundWorker

func (w inboxWorkers) Quiesce() {
	for _, worker := range w {
		worker.Quiesce()
	}
}
func (w inboxWorkers) Wait(ctx context.Context) error {
	for _, worker := range w {
		if err := worker.Wait(ctx); err != nil {
			return err
		}
	}
	return nil
}

// Callback IDs are stable public app identities, including provider/login mode.
// They are never bearer credentials. Keep Instagram and Page callback routes
// distinct even when they share the same Facebook application client ID.
// Handlers capture the startup configuration. Restart after changing a Meta
// app, client secret or webhook verification token, including DB admin edits.
func registerMetaInbox(e *echo.Echo, ingress *providerinbox.Service, apps []platform.AppConfig) {
	handlers := make(map[string]http.Handler)
	for _, app := range apps {
		app = platform.NormalizeAppConfig(app)
		if app.Provider != "facebook" && app.Provider != "instagram" {
			continue
		}
		if app.ClientID == "" || app.ClientSecret == "" || app.WebhookSecret == "" {
			continue
		}
		id := platform.AppConfigMergeKey(app) + ":" + app.ClientID
		handlers[id] = ingress.MetaHandler(providerinbox.MetaApp{ID: id, ClientID: app.ClientID, Platform: app.Provider, ConnectionMode: app.ConnectionMode, AppSecret: app.ClientSecret, VerifyToken: app.WebhookSecret})
	}
	handle := func(c echo.Context) error {
		handler, ok := handlers[c.Param("appID")]
		if !ok {
			return echo.ErrNotFound
		}
		handler.ServeHTTP(c.Response(), c.Request())
		return nil
	}
	// Colons belong to the opaque app ID, never to Echo's route syntax.
	e.Match([]string{http.MethodGet, http.MethodPost}, "/api/v1/provider-inbox/meta/:appID", handle)
}

func runInboxMaintenance(ctx context.Context, db *bun.DB, ingress *providerinbox.Service, schedule func(context.Context) error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastPrune := time.Time{}
	lastMaintenance := time.Time{}
	for {
		var pending bool
		err := db.NewRaw(`SELECT EXISTS(SELECT 1 FROM provider_inbox_receipts WHERE processed_at IS NULL AND next_attempt_at<=?) OR EXISTS(SELECT 1 FROM x_messaging_receipts WHERE processed=?)`, time.Now().UnixMilli(), false).Scan(ctx, &pending)
		if err != nil && ctx.Err() == nil {
			log.Printf("inspect provider inbox work: %v", err)
		}
		if pending || time.Since(lastMaintenance) >= time.Minute {
			if err := schedule(ctx); err != nil && ctx.Err() == nil {
				log.Printf("schedule durable inbox receipt drain: %v", err)
			} else {
				lastMaintenance = time.Now()
			}
		}
		if time.Since(lastPrune) >= 24*time.Hour {
			if err := ingress.Prune(ctx); err != nil {
				log.Printf("prune acknowledged inbox receipts: %v", err)
			} else {
				lastPrune = time.Now()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type inboxProcess struct {
	workers inboxWorkers
	cancel  context.CancelFunc
	done    chan struct{}
}

func startInboxProcess(ctx context.Context, workers inboxWorkers, functions ...func(context.Context)) *inboxProcess {
	child, cancel := context.WithCancel(ctx)
	p := &inboxProcess{workers: workers, cancel: cancel, done: make(chan struct{})}
	var group sync.WaitGroup
	for _, run := range functions {
		group.Add(1)
		go func() { defer group.Done(); run(child) }()
	}
	go func() { group.Wait(); close(p.done) }()
	return p
}
func (p *inboxProcess) Quiesce() { p.cancel(); p.workers.Quiesce() }
func (p *inboxProcess) Wait(ctx context.Context) error {
	if err := p.workers.Wait(ctx); err != nil {
		return err
	}
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
