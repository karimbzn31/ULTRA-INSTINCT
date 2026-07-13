// ============================================================
// ⚡ ULTRA INSTINCT — Connecteur Meta (Messenger + Instagram)
// ============================================================
// Reçoit les webhooks de Meta, identifie le client concerné
// par sa Page ID, et appelle le Bot Engine avec sa config.
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

  console.log(`[Meta] Vérification webhook: mode=${mode}, token=${token}`);

  // 1. Vérifier le token global du serveur (si défini dans les vars d'env)
  if (mode === 'subscribe' && process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Meta] ✅ Webhook vérifié (token global)');
    return res.status(200).send(challenge);
  }

  // 2. Vérifier si c'est le token d'un client dans Supabase
  if (mode === 'subscribe' && token) {
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, name, meta_verify_token')
        .eq('meta_verify_token', token)
        .eq('active', true)
        .maybeSingle();

      if (data) {
        console.log(`[Meta] ✅ Webhook vérifié pour client: ${data.name}`);
        return res.status(200).send(challenge);
      }
    } catch (err) {
      console.warn('[Meta] Erreur vérification Supabase:', err.message);
    }
  }

  // 3. Fallback : si aucun token global n'est défini ET aucun client avec ce token,
  //    on accepte quand même (mode setup/découverte)
  if (mode === 'subscribe' && !process.env.META_VERIFY_TOKEN) {
    console.log(`[Meta] ✅ Webhook vérifié (mode setup - aucun token configuré, token accepté: "${token}")`);
    return res.status(200).send(challenge);
  }

  // 3. Si on arrive ici, c'est que le token ne correspond à rien
  console.warn(`[Meta] ❌ Échec vérification - token "${token}" inconnu`);
  return res.status(403).send('Verification failed');
}

// ─── 2. RÉCEPTION DES MESSAGES (POST) ──────────────────
export async function handleIncoming(req, res) {
  const body = req.body;

  try {
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        const pageId = entry.id;
        for (const event of entry.messaging || []) {
          await processMessengerEvent(pageId, event);
        }
      }
    } else if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            await processInstagramEvent(change.value, entry.id);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Meta] Erreur traitement:', err.message);
  }

  // Meta exige une réponse 200
  // On répond APRÈS le traitement pour que Vercel ne tue pas la fonction
  res.status(200).send('EVENT_RECEIVED');
}
          processInstagramEvent(change.value, entry.id).catch(err => {
            console.error('[Meta] Erreur Instagram:', err.message);
          });
        }
      }
    }
  }
}

// ─── 3. TRAITEMENT D'UN MESSAGE MESSENGER ──────────────
async function processMessengerEvent(pageId, event) {
  const senderId = event.sender?.id;
  if (!senderId) return;

  // Ignorer les messages écho (messages envoyés PAR la page elle-même)
  if (event.message?.is_echo) return;

  // Ignorer les messages non-textuels (typing, read receipts, etc.)
  if (!event.message && !event.postback) return;

  // Trouver le client associé à cette Page ID
  const client = await findClientByPage(pageId);
  if (!client) {
    console.log(`[Meta] Aucun client trouvé pour page ${pageId}`);
    return;
  }

  console.log(`[Meta] Message de ${senderId} pour client "${client.name}"`);

  let messageType = 'text';
  let content = '';
  let attachmentUrl = null;

  // Postback (bouton cliqué)
  if (event.postback) {
    content = event.postback.payload || event.postback.title || 'Commande';
  }
  // Message texte
  else if (event.message?.text) {
    content = event.message.text;
  }
  // Message avec pièce jointe
  else if (event.message?.attachments) {
    const attach = event.message.attachments[0];
    if (attach.type === 'image') {
      messageType = 'image';
      attachmentUrl = attach.payload?.url;
      content = '[Image]';
    } else if (attach.type === 'audio') {
      messageType = 'audio';
      attachmentUrl = attach.payload?.url;
      content = '[Audio]';
    } else {
      content = `[${attach.type}]`;
    }
  } else {
    return; // Ignorer
  }

  // ⚡ Générer la réponse avec la config DU CLIENT
  const reply = await generateReply(client.id, 'messenger', senderId, messageType, content, attachmentUrl);

  // Envoyer la réponse via l'API Meta
  if (reply) {
    await sendMessage(client.meta_token, senderId, reply);
  }
}

// ─── 4. TRAITEMENT INSTAGRAM ────────────────────────────
async function processInstagramEvent(value, pageId) {
  const senderId = value?.sender?.id;
  if (!senderId) return;

  const client = await findClientByPage(pageId);
  if (!client) return;

  const text = value?.message?.text || '';
  console.log(`[Meta] Instagram de ${senderId} pour "${client.name}": "${text.substring(0, 50)}"`);

  const reply = await generateReply(client.id, 'instagram', senderId, 'text', text, null);

  if (reply) {
    await sendMessage(client.meta_token, senderId, reply);
  }
}

// ─── 5. TROUVER LE CLIENT PAR PAGE ID ──────────────────
async function findClientByPage(pageId) {
  // Chercher d'abord par meta_page_id exact
  const { data: exact } = await supabase
    .from('clients')
    .select('*')
    .eq('meta_page_id', pageId)
    .eq('active', true)
    .maybeSingle();

  if (exact) return exact;

  // Fallback : chercher dans les plateformes activées
  // (au cas où le page_id n'est pas renseigné)
  return null;
}

// ─── 6. ENVOYER UN MESSAGE VIA META ─────────────────────
export async function sendMessage(pageToken, recipientId, text) {
  if (!pageToken || !recipientId || !text) return;

  try {
    await axios.post(
      `${GRAPH_BASE}/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: text.substring(0, 2000) },
        messaging_type: 'RESPONSE',
      },
      {
        headers: {
          'Authorization': `Bearer ${pageToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    console.log(`[Meta] ✅ Message envoyé à ${recipientId}`);
  } catch (err) {
    const errorData = err.response?.data?.error || err.message;
    console.error(`[Meta] ❌ Échec envoi à ${recipientId}:`, JSON.stringify(errorData));
  }
}
