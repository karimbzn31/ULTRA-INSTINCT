-- ============================================================
-- ⚡ MIGRATION V2 : Message Queue + File d'attente
-- ============================================================
-- À EXÉCUTER DANS L'ÉDITEUR SUPABASE
-- ============================================================

-- ─── Table : message_queue ─────────────────────────────────
CREATE TABLE IF NOT EXISTS message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'messenger',
  sender_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT DEFAULT '',
  attachment_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
    -- pending → processing → done | failed
  attempts INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Index pour récupérer rapidement les messages en attente
CREATE INDEX IF NOT EXISTS idx_queue_status_created
  ON message_queue(status, created_at)
  WHERE status = 'pending';

-- Index pour cleanup
CREATE INDEX IF NOT EXISTS idx_queue_created
  ON message_queue(created_at);

-- ─── Colonne locked_at (évite les doublons entre workers) ──
ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_queue_pending
  ON message_queue(status, locked_at)
  WHERE status = 'processing';

-- ─── Fonction atomique : claim un message à traiter ────────
-- Utilise FOR UPDATE SKIP LOCKED pour éviter les doublons
-- entre workers parallèles
-- Rattrape aussi les messages en 'processing' qui ont timeout
-- (si Vercel tue la fonction, le message est récupéré après 30s)
CREATE OR REPLACE FUNCTION claim_queue_item()
RETURNS SETOF message_queue
LANGUAGE plpgsql
AS $$
DECLARE
  item_id UUID;
BEGIN
  SELECT id INTO item_id
  FROM message_queue
  WHERE (status = 'pending'
    OR (status = 'processing' AND locked_at < NOW() - INTERVAL '30 seconds'))
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF item_id IS NOT NULL THEN
    UPDATE message_queue
    SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
    WHERE id = item_id;

    RETURN QUERY SELECT * FROM message_queue WHERE id = item_id;
  END IF;

  RETURN;
END;
$$;
