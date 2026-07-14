-- ============================================================
-- ⚡ MIGRATION : Ajout des nouveaux champs (table clients)
-- ============================================================
-- À EXÉCUTER DANS L'ÉDITEUR SUPABASE
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS bot_capabilities TEXT DEFAULT 'text';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_token TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_verify_token TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_page_id TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pricing JSONB DEFAULT '{"price":0,"delivery_free":false,"delivery_fee":0,"currency":"DZD","conditions":""}';

CREATE INDEX IF NOT EXISTS idx_clients_meta_page ON clients(meta_page_id);

-- ⚡ CLOSER: Google Sheets (15/07/2026)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_sheet_id TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_sheet_service_key TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_images TEXT DEFAULT 'on_request';
