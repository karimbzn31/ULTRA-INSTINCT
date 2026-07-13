// ============================================================
// ⚡ ULTRA INSTINCT — Connecteur Meta (Messenger + Instagram)
// ============================================================

import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { generateReply } from '../bot/engine.js';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v22.0'}`;

// ─── 1. VÉRIFICATION DU WEBHOOK (GET) ──────────────────
export async function verifyWebhook(req, res) {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Token global ou n'importe lequel en mode setup
    if (mode === 'subscribe') {
      if (token === process.env.META_VERIFY_TOKEN || !process.env.META_VERIFY_TOKEN) {
        console.log(`[Meta] ✅ Webhook vérifié avec token: ${token}`);
        return res.status(200).send(challenge);
      }
    }

    return res.status(403).send('Verification failed');
  } catch (err) {
    console.error('[Meta] Erreur vérification:', err.message);
    return res.status(500).send('Server error');
  }
}

// ─── 2. RÉCEPTION DES MESSAGES (POST) ──────────────────
export function handleIncoming(req, res) {
  // ⚠️ IMPORTANT : répondre 200 à Meta IMMÉDIATEMENT
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  try {
    if (body.object !== 'page') return;

    for (const entry of body.entry || []) {
      const pageId = entry.id;
      const events = entry.messaging || [];

      for (const event of events) {
        // Lancer le traitement en arrière-plan (Vercel attend les microtasks)
        processMessengerEvent(pageId, event).catch(err => {
          console.error('[Meta] Erreur traitement:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[Meta] Erreur parse webhook:', err.message);
  }
}

// ─── 3. TRAITEMENT D'UN MESSAGE ────────────────────────
async function processMessengerEvent(pageId, event) {
  try {
    const senderId = event.sender?.id;
    if (!senderId) return;

    // Ignorer les échos et messages non-textuels
    if (event.message?.is_echo || (!event.message && !event.postback)) return;

    // Trouver le client
    const client = await findClientByPage(pageId);
    if (!client) {
      console.log(`[Meta] Aucun client trouvé pour page ${pageId}`);
      return;
    }

    console.log(`[Meta] 📩 Message de ${senderId} pour "${client.name}"`);

    // Extraire le contenu
    let messageType = 'text';
    let content = '';
    let attachmentUrl = null;

    if (event.postback) {
      content = event.postback.payload || event.postback.title || 'Commande';
    } else if (event.message?.text) {
      content = event.message.text;
    } else if (event.message?.attachments) {
      const attach = event.message.attachments[0];
      if (attach.type === 'image') { messageType = 'image'; content = '[Image]'; attachmentUrl = attach.payload?.url; }
      else if (attach.type === 'audio') { messageType = 'audio'; content = '[Audio]'; attachmentUrl = attach.payload?.url; }
      else { content = `[${attach.type}]`; }
    } else {
      return;
    }

    // Générer la réponse via le bot engine
    const reply = await generateReply(client.id, 'messenger', senderId, messageType, content, attachmentUrl);

    // Envoyer la réponse
    if (reply) {
      await sendMessage(client.meta_token, senderId, reply);
    }
  } catch (err) {
    console.error('[Meta] Erreur processus:', err.message);
  }
}

// ─── 4. TROUVER LE CLIENT PAR PAGE ID ─────────────────
async function findClientByPage(pageId) {
  const { data } = await supabase
    .from('clients')
    .select('*')
    .eq('meta_page_id', pageId)
    .eq('active', true)
    .maybeSingle();

  return data || null;
}

// ─── 5. ENVOYER UN MESSAGE VIA META ────────────────────
export async function sendMessage(pageToken, recipientId, text) {
  if (!pageToken || !recipientId || !text) return;

  try {
    await axios.post(`${GRAPH_BASE}/me/messages`, {
      recipient: { id: recipientId },
      message: { text: text.substring(0, 2000) },
      messaging_type: 'RESPONSE',
    }, {
      headers: { 'Authorization': `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log(`[Meta] ✅ Réponse envoyée à ${recipientId}`);
  } catch (err) {
    const errorData = err.response?.data?.error || err.message;
    console.error(`[Meta] ❌ Échec envoi:`, JSON.stringify(errorData));
  }
}
