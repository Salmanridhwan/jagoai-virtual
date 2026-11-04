package accountfeatures

import (
	"context"
	"strings"

	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

// EntitlementPlanPolicy backs plan_restricted decisions with the real entitlement source.
// It maps each optional feature to a synthetic limit key that is unlimited by default,
// so self-hosted and current paid plans remain allowed while a future plan snapshot
// that defines the limit can still trigger plan_restricted without code changes.
type EntitlementPlanPolicy struct {
	Entitlements entitlements.Service
	DB           bun.IDB
}

func (p *EntitlementPlanPolicy) Allowed(ctx context.Context, workspaceID, feature string) (bool, string) {
	if p == nil || p.Entitlements == nil {
		return true, ""
	}
	workspaceID = strings.TrimSpace(workspaceID)
	feature = strings.TrimSpace(feature)
	var key entitlements.LimitKey
	switch feature {
	case FeatureMessaging:
		key = entitlements.LimitFeatureMessaging
	case FeatureEngagement:
		key = entitlements.LimitFeatureEngagement
	case FeatureAnalytics:
		key = entitlements.LimitFeatureAnalytics
	case FeatureGrow:
		key = entitlements.LimitFeatureGrow
	default:
		return false, "unknown feature"
	}
	request := entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       key,
		Current:     0,
		Amount:      1,
	}
	var decision entitlements.Decision
	var err error
	if p.DB != nil {
		decision, err = entitlements.CheckWithDB(ctx, p.Entitlements, p.DB, request)
	} else {
		decision, err = p.Entitlements.Check(ctx, request)
	}
	if err != nil {
		return false, err.Error()
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return false, decision.Reason
		}
		return false, "plan requires upgrade"
	}
	return true, ""
}

func (p *EntitlementPlanPolicy) WithDB(db bun.IDB) PlanPolicy {
	return &EntitlementPlanPolicy{Entitlements: p.Entitlements, DB: db}
}
