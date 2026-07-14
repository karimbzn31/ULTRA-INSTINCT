// ============================================================
// ⚡ ULTRA INSTINCT — Connecteur Meta (Messenger + Instagram)
// ============================================================
// Vercel-safe : on await tout avant de répondre 200 à Meta.
// Si DeepSeek dépasse 8s, on répond quand même (timeout safe).
// ============================================================

import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { generateReply } from '../bot/engine.js';

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

// ─── 2. RÉCEPTION DES MESSAGES (POST) ──────────────────
export async function handleIncoming(req, res) {
  try {
    const body = req.body;
    if (body.object !== 'page') {
      return res.status(200).send('EVENT_RECEIVED');
    }

    for (const entry of body.entry || []) {
      const pageId = entry.id;
      const events = entry.messaging || [];

      for (const event of events) {
        try {
          await processEvent(pageId, event);
        } catch (e) {
          console.error('[Meta] Erreur event:', e.message);
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[Meta] Erreur webhook:', err.message);
    res.status(200).send('EVENT_RECEIVED');
  }
}

// ─── 3. TRAITER UN ÉVÉNEMENT ───────────────────────────
async function processEvent(pageId, event) {
  const senderId = event.sender?.id;
  if (!senderId) return;
  if (event.message?.is_echo) return;
  if (!event.message && !event.postback) return;

  // Chercher le client
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('meta_page_id', pageId)
    .eq('active', true)
    .maybeSingle();

  if (!client) {
    console.log(`[Meta] ⚠️ Aucun client actif pour page ${pageId}`);
    return;
  }

  console.log(`[Meta] ➡️ "${client.name}" (${senderId})`);

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
  } else { return; }

  // Envoyer un accusé de réception immédiat "vu"
  await markSeen(client.meta_token, senderId);

  // Appeler le bot
  const result = await generateReply(client.id, 'messenger', senderId, type, content, attachmentUrl);

  if (result && result.text) {
    // Envoyer "typing" avant la réponse
    await typingOn(client.meta_token, senderId);
    await sleep(500);

    // Envoyer le texte
    await sendMessage(client.meta_token, senderId, result.text);

    // Envoyer les images une par une
    if (result.images && result.images.length > 0) {
      for (const imgUrl of result.images) {
        await sleep(300);
        await sendImageMessage(client.meta_token, senderId, imgUrl);
      }
    }
  }
}

// ─── 4. ENVOYER UN MESSAGE ─────────────────────────────
async function sendMessage(token, recipient, text) {
  if (!token || !recipient || !text) return;

  try {
    await axios.post(`${GRAPH_BASE}/me/messages`, {
      recipient: { id: recipient },
      message: { text: text.substring(0, 2000) },
      messaging_type: 'RESPONSE',
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log(`[Meta] ✅ Réponse envoyée`);
  } catch (err) {
    const fbErr = err.response?.data?.error;
    console.error(`[Meta] ❌ Envoi échoué:`, JSON.stringify(fbErr || err.message));
  }
}

// ─── 5. TYPING + SEEN (optionnel) ──────────────────────
async function markSeen(token, recipient) {
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

async function typingOn(token, recipient) {
  try {
    await axios.post(`${GRAPH_BASE}/me/messages`, {
      recipient: { id: recipient },
      sender_action: 'typing_on',
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 5000,
    });
  } catch {}
}

async function sendImageMessage(token, recipient, imageUrl) {
  if (!token || !recipient || !imageUrl) return;
  try {
    await axios.post(`${GRAPH_BASE}/me/messages`, {
      recipient: { id: recipient },
      message: {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true }
        }
      },
      messaging_type: 'RESPONSE',
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log(`[Meta] 🖼️ Image envoyée à ${recipient}`);
  } catch (err) {
    console.error(`[Meta] ❌ Échec envoi image:`, err.response?.data?.error?.message || err.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
