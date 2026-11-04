// Package inboxchanges owns the durable, Workspace-scoped inbox change journal.
package inboxchanges

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
)

const RetainedChanges int64 = 10000

var ErrInvalidCursor = errors.New("invalid inbox cursor")

type Change struct {
	Revision       int64  `json:"revision"`
	Kind           string `json:"kind" enum:"conversation,message,engagement"`
	ConversationID string `json:"conversation_id,omitempty"`
	MessageID      string `json:"message_id,omitempty"`
	EngagementID   string `json:"engagement_id,omitempty"`
	Deleted        bool   `json:"deleted,omitempty"`
}
type Page struct {
	Cursor  string   `json:"cursor"`
	Reset   bool     `json:"reset"`
	Changes []Change `json:"changes"`
}
type cursor struct {
	Workspace string `json:"w"`
	Revision  int64  `json:"r"`
}

// Append must run in the same transaction as the visible state change. Updating
// the head serializes writers until commit, including PostgreSQL writers. A
// sequence or timestamp alone would let a reader skip a late-committing change.
func Append(ctx context.Context, tx bun.IDB, workspaceID string, changes ...Change) error {
	if len(changes) == 0 {
		return nil
	}
	if _, err := tx.NewRaw(`INSERT INTO inbox_heads (workspace_id, revision) VALUES (?, 0) ON CONFLICT (workspace_id) DO NOTHING`, workspaceID).Exec(ctx); err != nil {
		return err
	}
	var revision int64
	if err := tx.NewRaw(`UPDATE inbox_heads SET revision = revision + ? WHERE workspace_id = ? RETURNING revision`, len(changes), workspaceID).Scan(ctx, &revision); err != nil {
		return err
	}
	first := revision - int64(len(changes)) + 1
	for i, c := range changes {
		if c.Kind != "conversation" && c.Kind != "message" && c.Kind != "engagement" {
			return fmt.Errorf("invalid inbox change kind")
		}
		if _, err := tx.NewRaw(`INSERT INTO inbox_changes (workspace_id,revision,kind,conversation_id,message_id,engagement_id,deleted) VALUES (?,?,?,?,?,?,?)`, workspaceID, first+int64(i), c.Kind, c.ConversationID, c.MessageID, c.EngagementID, c.Deleted).Exec(ctx); err != nil {
			return err
		}
	}
	_, err := tx.NewRaw(`DELETE FROM inbox_changes WHERE workspace_id = ? AND revision <= ?`, workspaceID, revision-RetainedChanges).Exec(ctx)
	return err
}

func encode(workspaceID string, revision int64) string {
	data, _ := json.Marshal(cursor{workspaceID, revision})
	return base64.RawURLEncoding.EncodeToString(data)
}

// Read uses only committed rows. Its caller must authorize every response,
// including after a long wait. An empty or expired cursor requests a fresh view.
func Read(ctx context.Context, db bun.IDB, workspaceID, token string) (Page, error) {
	page := Page{Changes: []Change{}}
	var head int64
	err := db.NewRaw(`SELECT revision FROM inbox_heads WHERE workspace_id = ?`, workspaceID).Scan(ctx, &head)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return page, err
	}
	page.Cursor = encode(workspaceID, head)
	if token == "" {
		page.Reset = true
		return page, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(token)
	var after cursor
	if err != nil || json.Unmarshal(data, &after) != nil || after.Workspace != workspaceID || after.Revision < 0 || after.Revision > head {
		return page, ErrInvalidCursor
	}
	if after.Revision < head-RetainedChanges {
		page.Reset = true
		return page, nil
	}
	if after.Revision == head {
		return page, nil
	}
	// Do not read beyond the captured committed head. Concurrent commits appear
	// on the next read and cannot move this response's cursor past unseen rows.
	err = db.NewRaw(`SELECT revision,kind,conversation_id,message_id,engagement_id,deleted FROM inbox_changes WHERE workspace_id = ? AND revision > ? AND revision <= ? ORDER BY revision LIMIT 200`, workspaceID, after.Revision, head).Scan(ctx, &page.Changes)
	if err != nil {
		return page, err
	}
	if len(page.Changes) > 0 {
		page.Cursor = encode(workspaceID, page.Changes[len(page.Changes)-1].Revision)
	} else {
		page.Reset = true
	}
	return page, nil
}

// Wait bounds one foreground request and releases its database connection
// between reads. Authorization is deliberately supplied by the owning service.
func Wait(ctx context.Context, db bun.IDB, workspaceID, token string, duration time.Duration, authorize func(context.Context) error) (Page, error) {
	if duration < 0 {
		duration = 0
	}
	if duration > 25*time.Second {
		duration = 25 * time.Second
	}
	deadline := time.NewTimer(duration)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := authorize(ctx); err != nil {
			return Page{}, err
		}
		page, err := Read(ctx, db, workspaceID, token)
		if err != nil {
			return Page{}, err
		}
		if page.Reset || len(page.Changes) > 0 || duration == 0 {
			return page, authorize(ctx)
		}
		select {
		case <-ctx.Done():
			return Page{}, ctx.Err()
		case <-deadline.C:
			return page, authorize(ctx)
		case <-ticker.C:
		}
	}
}
