package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/uptrace/bun"
)

type Limiter struct {
	db          *bun.DB
	mu          sync.Mutex
	buckets     map[string]*bucket
	lastCleanup time.Time
}

type bucket struct {
	windowStart time.Time
	window      time.Duration
	count       int
	lastSeen    time.Time
}

const (
	cleanupInterval = time.Minute
	cleanupTimeout  = 10 * time.Minute
)

func New() *Limiter {
	return &Limiter{
		buckets:     make(map[string]*bucket),
		lastCleanup: time.Now().UTC(),
	}
}

// NewShared uses an atomic database counter across all web replicas. Keys are
// hashed so credentials, email addresses and IPs are not stored in this table.
func NewShared(db *bun.DB) *Limiter { l := New(); l.db = db; return l }

func (l *Limiter) allowShared(key string, limit int, window time.Duration) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	now := time.Now().UTC()
	digest := sha256.Sum256([]byte(key))
	hashed := hex.EncodeToString(digest[:])
	result, err := l.db.NewRaw(`INSERT INTO auth_rate_limits (key_hash, expires_at, attempts) VALUES (?, ?, 1)
 ON CONFLICT (key_hash) DO UPDATE SET
 attempts = CASE WHEN auth_rate_limits.expires_at <= ? THEN 1 ELSE auth_rate_limits.attempts + 1 END,
 expires_at = CASE WHEN auth_rate_limits.expires_at <= ? THEN excluded.expires_at ELSE auth_rate_limits.expires_at END
 WHERE auth_rate_limits.expires_at <= ? OR auth_rate_limits.attempts < ?`, hashed, now.Add(window).UnixMilli(), now.UnixMilli(), now.UnixMilli(), now.UnixMilli(), limit).Exec(ctx)
	if err != nil {
		return false
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return false
	}
	l.mu.Lock()
	cleanup := now.Sub(l.lastCleanup) >= cleanupInterval
	if cleanup {
		l.lastCleanup = now
	}
	l.mu.Unlock()
	if cleanup {
		_, _ = l.db.NewRaw("DELETE FROM auth_rate_limits WHERE expires_at < ?", now.Add(-cleanupTimeout).UnixMilli()).Exec(ctx)
	}
	return true
}

func (l *Limiter) Allow(key string, limit int, window time.Duration) bool {
	now := time.Now().UTC()
	if key == "" || limit <= 0 || window <= 0 {
		return false
	}

	if l.db != nil {
		return l.allowShared(key, limit, window)
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.lastCleanup) >= cleanupInterval {
		l.cleanup(now)
		l.lastCleanup = now
	}

	current, ok := l.buckets[key]
	if !ok || now.Sub(current.windowStart) >= window {
		l.buckets[key] = &bucket{
			windowStart: now,
			window:      window,
			count:       1,
			lastSeen:    now,
		}
		return true
	}

	if current.count >= limit {
		return false
	}

	current.count++
	current.lastSeen = now
	return true
}

func (l *Limiter) cleanup(now time.Time) {
	for key, b := range l.buckets {
		if now.Sub(b.windowStart) >= b.window && now.Sub(b.lastSeen) > cleanupTimeout {
			delete(l.buckets, key)
		}
	}
}
