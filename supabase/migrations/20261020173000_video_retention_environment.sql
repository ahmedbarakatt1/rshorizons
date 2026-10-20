ALTER TABLE app.video_ingestions ADD COLUMN provider_environment text;
-- Existing unknown provider rows deliberately retain NULL and require reconciliation.
-- A token rotation does not change the designated Mux environment identity.
