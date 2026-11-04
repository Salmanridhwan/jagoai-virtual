package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestXMessagingBudgetDoesNotInheritPublishingBudget(t *testing.T) {
	t.Setenv("OPENPOST_X_MONTHLY_BUDGET_MICROUSD", "5000000")
	t.Setenv("OPENPOST_X_MESSAGING_MONTHLY_BUDGET_MICROUSD", "")
	t.Setenv("OPENPOST_X_MESSAGING_PROVIDER_SPENDING_LIMIT_CONFIRMED", "")
	t.Setenv("OPENPOST_X_MESSAGING_MONTHLY_BUDGET_MICROUSD_FILE", "")
	t.Setenv("OPENPOST_X_MESSAGING_PROVIDER_SPENDING_LIMIT_CONFIRMED_FILE", "")
	cfg := LoadXMessaging()
	require.Zero(t, cfg.MonthlyBudgetMicrousd)
	require.False(t, cfg.ProviderSpendingLimitConfirmed)
}
