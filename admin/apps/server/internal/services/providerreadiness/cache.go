package providerreadiness

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/models"
)

// readCache memoizes readiness ledger facts for one request. Facts that do not
// depend on the account (approval reviews, local certification, runtime
// controls for one subject) are read once even when several destinations and
// both operations are evaluated.
type readCache struct {
	now time.Time

	mu             sync.Mutex
	approvals      map[string]*approvalCacheEntry
	controls       map[string]*controlCacheEntry
	certifications map[string]*certificationCacheEntry
	authorizations map[string]*authorizationCacheEntry
}

type approvalCacheEntry struct {
	once  sync.Once
	value *ApprovalReview
	err   error
}

type controlCacheEntry struct {
	once  sync.Once
	value RuntimeControl
	err   error
}

type certificationCacheEntry struct {
	once  sync.Once
	value *CertificationEvidence
	err   error
}

type authorizationCacheEntry struct {
	once  sync.Once
	value AuthorizationEvidence
	err   error
}

func newReadCache(now time.Time) *readCache {
	return &readCache{
		now:            now,
		approvals:      map[string]*approvalCacheEntry{},
		controls:       map[string]*controlCacheEntry{},
		certifications: map[string]*certificationCacheEntry{},
		authorizations: map[string]*authorizationCacheEntry{},
	}
}

func (c *readCache) approvalEntry(key string) *approvalCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.approvals[key]; ok {
		return entry
	}
	entry := &approvalCacheEntry{}
	c.approvals[key] = entry
	return entry
}

func (c *readCache) controlEntry(key string) *controlCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.controls[key]; ok {
		return entry
	}
	entry := &controlCacheEntry{}
	c.controls[key] = entry
	return entry
}

func (c *readCache) certificationEntry(key string) *certificationCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.certifications[key]; ok {
		return entry
	}
	entry := &certificationCacheEntry{}
	c.certifications[key] = entry
	return entry
}

func (c *readCache) authorizationEntry(key string) *authorizationCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.authorizations[key]; ok {
		return entry
	}
	entry := &authorizationCacheEntry{}
	c.authorizations[key] = entry
	return entry
}

// RequestScoped returns a copy that memoizes readiness facts until the caller
// discards it. Use it for one read-only request; never for scheduling or
// publishing, which must observe ledger changes made before their transaction.
func (s *Service) RequestScoped() *Service {
	if s == nil {
		return nil
	}
	clone := *s
	clone.cache = newReadCache(s.currentTime())
	return &clone
}

func (s *Service) decisionTime() time.Time {
	if s == nil {
		return time.Now()
	}
	if s.cache != nil {
		return s.cache.now
	}
	return s.currentTime()
}

func (s *Service) approvalFor(ctx context.Context, subject Subject) (*ApprovalReview, error) {
	if s.cache == nil {
		return s.ledger.LatestApprovalReview(ctx, subject)
	}
	entry := s.cache.approvalEntry(approvalCacheKey(subject))
	entry.once.Do(func() {
		entry.value, entry.err = s.ledger.LatestApprovalReview(ctx, subject)
	})
	return entry.value, entry.err
}

func (s *Service) controlFor(ctx context.Context, subject Subject, now time.Time) (RuntimeControl, error) {
	if s.cache == nil {
		return s.ledger.EffectiveRuntimeControl(ctx, subject, now)
	}
	entry := s.cache.controlEntry(subjectCacheKey("control", subject))
	entry.once.Do(func() {
		entry.value, entry.err = s.ledger.EffectiveRuntimeControl(ctx, subject, now)
	})
	return entry.value, entry.err
}

func (s *Service) certificationFor(
	ctx context.Context,
	subject Subject,
	kind EvidenceKind,
	accountReferenceHash string,
) (*CertificationEvidence, error) {
	if s.cache == nil {
		return s.ledger.LatestCertification(ctx, subject, kind, accountReferenceHash)
	}
	key := subjectCacheKey(string(kind), subject) + "\x1f" + accountReferenceHash
	entry := s.cache.certificationEntry(key)
	entry.once.Do(func() {
		entry.value, entry.err = s.ledger.LatestCertification(ctx, subject, kind, accountReferenceHash)
	})
	return entry.value, entry.err
}

func (s *Service) authorizationForAccount(
	ctx context.Context,
	account models.SocialAccount,
	now time.Time,
) (AuthorizationEvidence, error) {
	if s.cache == nil {
		return s.authorizations.AuthorizationForAccount(ctx, account, now)
	}
	entry := s.cache.authorizationEntry(account.ID)
	entry.once.Do(func() {
		entry.value, entry.err = s.authorizations.AuthorizationForAccount(ctx, account, now)
	})
	return entry.value, entry.err
}

func approvalCacheKey(subject Subject) string {
	parts := []string{
		"approval",
		subject.Provider,
		subject.AppFingerprint,
		string(subject.ProviderEnvironment),
		subject.InstanceFingerprint,
	}
	return strings.Join(parts, "\x1f")
}

func subjectCacheKey(kind string, subject Subject) string {
	parts := []string{
		kind,
		subject.Provider,
		subject.AppFingerprint,
		string(subject.DeploymentEnvironment),
		string(subject.ProviderEnvironment),
		subject.InstanceFingerprint,
		subject.AccountKind,
		subject.OutputProfile,
		string(subject.Operation),
		subject.PolicyMode,
	}
	return strings.Join(parts, "\x1f")
}
