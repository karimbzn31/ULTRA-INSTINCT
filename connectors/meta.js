// ============================================================
// ⚡ ULTRA INSTINCT — Connecteur Meta (Messenger + Instagram)
// ============================================================
// ⚡ VERSION V2 — File d'attente !
// Le webhook répond en <50ms (insert queue) puis le worker
// s'occupe du traitement LLM + envoi en arrière-plan.
// Terminé les timeouts Vercel !
// ============================================================

import { supabase } from '../lib/supabase.js';
import { enqueue } from '../queue/index.js';
import axios from 'axios';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v22.0'}`;

// ─── 1. VÉRIFICATION DU WEBHOOK (GET) ──────────────────
export async function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe') {
    console.log(`[Meta] ✅ Webhook vérifié (token: ${token})`);
    return res.status(200).send(challenge);
  }
  res.status(403).send('Verification failed');
}

// ─── 2. RÉCEPTION DES MESSAGES (POST) — ⚡ ULTRARAPIDE ──
export async function handleIncoming(req, res) {
  try {
    const body = req.body;
    if (body.object !== 'page') {
      return res.status(200).send('EVENT_RECEIVED');
    }

    let hasWork = false;

    for (const entry of body.entry || []) {
      const pageId = entry.id;
      const events = entry.messaging || [];

      for (const event of events) {
        const queued = await queueEvent(pageId, event);
        if (queued) hasWork = true;
      }
    }

    // ✅ Lancer le worker en ARRIÈRE-PLAN avant de répondre
    if (hasWork) {
      fireWorker();
    }

    // ✅ Répondre IMMÉDIATEMENT
    res.status(200).send('EVENT_RECEIVED');

  } catch (err) {
    console.error('[Meta] Erreur webhook:', err.message);
    // Même en erreur, Meta attend un 200
    if (!res.headersSent) res.status(200).send('EVENT_RECEIVED');
  }
}

// ─── 3. ENFILER UN ÉVÉNEMENT DANS LA QUEUE (ultra rapide) ──
async function queueEvent(pageId, event) {
  const senderId = event.sender?.id;
  if (!senderId) return false;
  if (event.message?.is_echo) return false;
  if (!event.message && !event.postback) return false;

  // Chercher le client associé à cette Page Facebook
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, meta_token')
    .eq('meta_page_id', pageId)
    .eq('active', true)
    .maybeSingle();

  if (!client) {
    console.log(`[Meta] ⚠️ Aucun client actif pour page ${pageId}`);
    return false;
  }

  // Extraire le message
  let type = 'text', content = '', attachmentUrl = null;

  if (event.postback) {
    content = event.postback.payload || event.postback.title || 'Commande';
  } else if (event.message?.text) {
    content = event.message.text;
  } else if (event.message?.attachments) {
    const a = event.message.attachments[0];
    if (a.type === 'image') { type = 'image'; content = '[Image]'; attachmentUrl = a.payload?.url; }
    else if (a.type === 'audio') { type = 'audio'; content = '[Audio]'; attachmentUrl = a.payload?.url; }
    else { content = `[${a.type}]`; }
  } else { return false; }

  // Envoyer "vu" immédiat (fast, pas de LLM ici)
  await markSeen(client.meta_token, senderId);

  // Enfiler le message dans la queue
  await enqueue(client.id, 'messenger', senderId, type, content, attachmentUrl);
  console.log(`[Meta] 📥 "${client.name}" enfilé pour ${senderId}`);

  return true;
}

// ─── 4. DÉCLENCHER LE WORKER (fire-and-forget) ──────────────
// Lance /api/process-queue dans une nouvelle fonction Vercel
// sans l'attendre. Si ça rate, le prochain message relancera.
function fireWorker() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.log('[Meta] ⚠️ BASE_URL non défini, worker non déclenché');
    return;
  }

  // Fire-and-forget : on ne bloque pas le webhook
  fetch(`${baseUrl}/api/process-queue`, {
    method: 'POST',
    signal: AbortSignal.timeout(9000),
  }).then(async res => {
    const body = await res.text();
    console.log(`[Meta] 🏁 Worker répondu: ${body}`);
  }).catch(err => {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.log('[Meta] ⏱️ Worker timeout (normal pour une tâche longue)');
    } else {
      console.warn('[Meta] ⚠️ Échec trigger worker:', err.message);
    }
  });
}

// ─── 4. MARQUER COMME "VU" (mark_seen) ─────────────────────
async function markSeen(token, recipient) {
  if (!token || !recipient) return;
  try {
    await axios.post(`${GRAPH_BASE}/me/messages`, {
      recipient: { id: recipient },
      sender_action: 'mark_seen',
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 5000,
    });
  } catch {}
}

export { markSeen };
