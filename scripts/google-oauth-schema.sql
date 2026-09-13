CREATE TABLE IF NOT EXISTS mydesk_google_oauth_attempts (
  state_hash text PRIMARY KEY,
  owner_id text NOT NULL,
  verifier_cipher text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mydesk_google_oauth_attempts_expires_idx ON mydesk_google_oauth_attempts(expires_at);
CREATE INDEX IF NOT EXISTS mydesk_google_oauth_attempts_owner_idx ON mydesk_google_oauth_attempts(owner_id);

CREATE TABLE IF NOT EXISTS mydesk_google_connections (
  owner_id text PRIMARY KEY,
  credentials_cipher text NOT NULL,
  google_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
