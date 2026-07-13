-- ============================================================
-- ⚡ ULTRA INSTINCT — Schéma Supabase (complet)
-- ============================================================
-- Copie-colle CE SCRIPT dans Supabase SQL Editor
-- Va sur : https://supabase.com/dashboard/project/wpyfbqqatctcyuplhnec/sql/new
-- ============================================================

-- ─── Table : clients ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  company TEXT DEFAULT '',
  business_type TEXT DEFAULT 'boutique',
  active BOOLEAN DEFAULT true,
  platforms JSONB DEFAULT '{"messenger":false,"instagram":false,"whatsapp":false,"telegram":false}',
  bot_capabilities TEXT DEFAULT 'text',     -- 'text' | 'text_image' | 'text_image_audio'
  prompt TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  api_model TEXT DEFAULT 'deepseek-v4-flash-free',
  gemini_api_key TEXT DEFAULT '',
  whisper_api_key TEXT DEFAULT '',
  meta_token TEXT DEFAULT '',               -- Page Access Token Facebook
  meta_verify_token TEXT DEFAULT '',         -- Verify Token pour le webhook
  meta_page_id TEXT DEFAULT '',              -- Facebook Page ID
  pricing JSONB DEFAULT '{"price":0,"delivery_free":false,"delivery_fee":0,"currency":"DZD","conditions":""}',
  logo TEXT DEFAULT '',
  catalog JSONB DEFAULT '[]',
  catalog_filename TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  stats JSONB DEFAULT '{"messages_processed":0,"orders_completed":0,"last_activity":null}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Table : sessions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'messenger',
  state TEXT DEFAULT 'DISCOVERY',
  order_data JSONB DEFAULT '{}',
  history JSONB DEFAULT '[]',
  last_interaction TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Table : messages ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  platform TEXT NOT NULL DEFAULT 'messenger',
  sender TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL DEFAULT '',
  message_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(active);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_meta_page ON clients(meta_page_id);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ─── Table : admin_settings ───────────────────────────────
CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  email TEXT NOT NULL DEFAULT 'admin@ultra-instinct.ai',
  password TEXT NOT NULL DEFAULT '',
  name TEXT DEFAULT 'Admin',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO admin_settings (id, email, password, name)
VALUES (1, 'admin@ultra-instinct.ai', '', 'Admin')
ON CONFLICT (id) DO NOTHING;

-- ─── Row Level Security ───────────────────────────────────
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service_role" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service_role" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service_role" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service_role" ON admin_settings FOR ALL USING (true) WITH CHECK (true);
