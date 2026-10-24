-- Explicitly provisioned local preview identities; never used by hosted Supabase Auth.
-- No account, password or hash is seeded by this migration.
CREATE TABLE app.local_staff_credentials (
  staff_id uuid PRIMARY KEY REFERENCES app.staff_profiles(id),
  email text NOT NULL UNIQUE CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),
  password_salt text NOT NULL CHECK(password_salt ~ '^[a-f0-9]{64}$'),
  password_hash text NOT NULL CHECK(password_hash ~ '^[a-f0-9]{128}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.local_staff_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.local_staff_credentials FROM PUBLIC,anon,authenticated;
GRANT SELECT ON app.local_staff_credentials TO tourism_app;
CREATE POLICY runtime_read ON app.local_staff_credentials FOR SELECT TO tourism_app USING (true);
