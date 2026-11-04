package oauth2messaging

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

// QuotaError is safe to display and allows durable jobs to defer instead of
// multiplying upstream calls. Counts include ambiguous requests.
type QuotaError struct{ RetryAfter time.Duration }

func (e *QuotaError) Error() string { return "X messaging request quota is exhausted" }

// Unwrap lets existing provider failure classifiers retain the retry delay.
func (e *QuotaError) Unwrap() error {
	return &platform.HTTPError{StatusCode: http.StatusTooManyRequests, Code: "x:messaging_quota", RetryAfter: e.RetryAfter}
}

func (s *Service) ReserveXMessagingRequest(ctx context.Context, remoteUserID, operation string) error {
	if remoteUserID == "" {
		return errors.New("x messaging requires an account identity")
	}
	limit := 15
	if operation == platform.XMessagingUsers {
		limit = 1
	} else if operation != platform.XMessagingRead && operation != platform.XMessagingSend {
		return errors.New("unsupported X messaging quota operation")
	}
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := reserveWindow(ctx, tx, remoteUserID, operation, now, 15*time.Minute, limit); err != nil {
			return err
		}
		if operation == platform.XMessagingSend {
			if err := reserveWindow(ctx, tx, remoteUserID, operation+"_daily", now, 24*time.Hour, 1440); err != nil {
				return err
			}
			return reserveWindow(ctx, tx, "__application__", operation+"_daily", now, 24*time.Hour, 1440)
		}
		return nil
	})
}
func reserveWindow(ctx context.Context, tx bun.Tx, user, operation string, now time.Time, window time.Duration, limit int) error {
	// Upsert takes the row's write lock before reading the log, including on
	// PostgreSQL. Both daily and short-window reservations share this transaction.
	_, err := tx.NewRaw(`INSERT INTO x_messaging_quota_windows(remote_user_id,operation) VALUES(?,?)
 ON CONFLICT(remote_user_id,operation) DO UPDATE SET requests_json = x_messaging_quota_windows.requests_json`, user, operation).Exec(ctx)
	if err != nil {
		return err
	}
	var row struct {
		RequestsJSON string
		BlockedUntil time.Time `bun:",nullzero"`
	}
	if err = tx.NewRaw("SELECT requests_json, blocked_until FROM x_messaging_quota_windows WHERE remote_user_id = ? AND operation = ?", user, operation).Scan(ctx, &row); err != nil {
		return err
	}
	if row.BlockedUntil.After(now) {
		return &QuotaError{RetryAfter: row.BlockedUntil.Sub(now)}
	}
	var requests []time.Time
	if err = json.Unmarshal([]byte(row.RequestsJSON), &requests); err != nil {
		return err
	}
	retained := requests[:0]
	for _, requested := range requests {
		if requested.After(now.Add(-window)) {
			retained = append(retained, requested)
		}
	}
	if len(retained) >= limit {
		return &QuotaError{RetryAfter: retained[0].Add(window).Sub(now)}
	}
	raw, err := json.Marshal(append(retained, now))
	if err != nil {
		return err
	}
	_, err = tx.NewRaw("UPDATE x_messaging_quota_windows SET requests_json = ? WHERE remote_user_id = ? AND operation = ?", string(raw), user, operation).Exec(ctx)
	return err
}

func (s *Service) ObserveXMessagingResponse(ctx context.Context, remoteUserID, operation string, status int, headers http.Header) error {
	now := s.now()
	var blocked time.Time
	reset, _ := strconv.ParseInt(headers.Get("x-rate-limit-reset"), 10, 64)
	remaining, remainingErr := strconv.Atoi(headers.Get("x-rate-limit-remaining"))
	if status == http.StatusTooManyRequests || (remainingErr == nil && remaining == 0) {
		blocked = time.Unix(reset, 0).UTC()
		if !blocked.After(now) {
			blocked = now.Add(15 * time.Minute)
		}
		if seconds, err := strconv.Atoi(headers.Get("Retry-After")); err == nil && seconds > 0 && now.Add(time.Duration(seconds)*time.Second).After(blocked) {
			blocked = now.Add(time.Duration(seconds) * time.Second)
		}
	}
	if blocked.IsZero() {
		return nil
	}

	_, err := s.db.NewRaw(`INSERT INTO x_messaging_quota_windows(remote_user_id,operation,blocked_until) VALUES(?,?,?)
 ON CONFLICT(remote_user_id,operation) DO UPDATE SET blocked_until = CASE WHEN x_messaging_quota_windows.blocked_until > EXCLUDED.blocked_until THEN x_messaging_quota_windows.blocked_until ELSE EXCLUDED.blocked_until END`, remoteUserID, operation, blocked).Exec(ctx)
	return err
}
