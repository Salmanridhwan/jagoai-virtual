-- Keep the existing identity for every other provider and legacy Instagram
-- app, while allowing a separate Instagram Login application alongside it.
DROP INDEX IF EXISTS provider_apps_provider_instance_idx;
CREATE UNIQUE INDEX provider_apps_provider_instance_idx
    ON provider_apps (provider, instance_url,
        (CASE WHEN provider = 'instagram' AND connection_mode = 'instagram_login'
            THEN 'instagram_login' ELSE '' END));
