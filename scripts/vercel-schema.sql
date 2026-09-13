CREATE TABLE IF NOT EXISTS mydesk_documents (
  owner_id text PRIMARY KEY,
  data jsonb NOT NULL,
  google_cipher text,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
