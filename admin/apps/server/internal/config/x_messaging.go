package config

// XMessagingConfig is deliberately separate from X's OAuth1 publishing keys.
// A nonzero existing publishing budget never enables paid inbox subscriptions.
type XMessagingConfig struct {
	ClientID                       string
	ClientSecret                   string
	RedirectURI                    string
	WebhookID                      string
	MonthlyBudgetMicrousd          int64
	ProviderSpendingLimitConfirmed bool
}

func LoadXMessaging() XMessagingConfig {
	return XMessagingConfig{
		ClientID:                       getEnvDefault("OPENPOST_X_MESSAGING_CLIENT_ID", ""),
		ClientSecret:                   getEnvDefault("OPENPOST_X_MESSAGING_CLIENT_SECRET", ""),
		RedirectURI:                    getEnvDefault("OPENPOST_X_MESSAGING_REDIRECT_URI", ""),
		WebhookID:                      getEnvDefault("OPENPOST_X_MESSAGING_WEBHOOK_ID", ""),
		MonthlyBudgetMicrousd:          getEnvInt64("OPENPOST_X_MESSAGING_MONTHLY_BUDGET_MICROUSD", 0),
		ProviderSpendingLimitConfirmed: getEnvBoolWithAliases(false, "OPENPOST_X_MESSAGING_PROVIDER_SPENDING_LIMIT_CONFIRMED"),
	}
}
