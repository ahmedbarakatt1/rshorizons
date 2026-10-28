-- The owner selected password-only staff access for the current operation.
-- Account activation, revocation, roles, scopes, session expiry and rate limits remain enforced.
ALTER TABLE app.staff_profiles
  ALTER COLUMN mfa_required SET DEFAULT false;

UPDATE app.staff_profiles
SET mfa_required = false,
    updated_at = now()
WHERE mfa_required;
