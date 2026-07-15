// ============================================================
// ⚡ ULTRA INSTINCT — Worker file d'attente
// ============================================================
// Traite UN message de la queue : appelle le bot LLM puis
// envoie la réponse (texte + images) sur Messenger.
// ============================================================

import { generateReply } from '../bot/engine.js';
import { claimNext, markDone, markFailed, release } from './index.js';
import { getClient } from '../lib/supabase.js';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v22.0'}`;
import axios from 'axios';

// ─── Traiter le prochain message en attente ─────────────────
// Retourne true si un message a été traité, false si queue vide
export async function processNext() {
  // 1. Claim atomique
  const item = await claimNext();
  if (!item) return false;

  try {
    // 2. Récupérer le client pour avoir son token
    const client = await getClient(item.client_id);
    if (!client || !client.active || !client.meta_token) {
      console.log(`[Worker] ⚠️ Client ${item.client_id} inactif ou token manquant`);
      await markFailed(item.id, 'Client inactif ou token manquant');
      return true;
    }

    // 3. Appeler le bot (LLM + génération réponse)
    console.log(`[Worker] 🤖 Génération réponse pour ${item.sender_id}...`);
    const result = await generateReply(
      item.client_id,
      item.platform,
      item.sender_id,
      item.message_type,
      item.content,
      item.attachment_url
    );

    // 4. Envoyer la réponse texte
    if (result && result.text) {
      // Envoyer le "typing..." avant la réponse
      await typingOn(client.meta_token, item.sender_id);
      await sleep(400);

      await sendMessage(client.meta_token, item.sender_id, result.text);
      console.log(`[Worker] ✅ Texte envoyé à ${item.sender_id}`);

      // 5. Envoyer les images une par une
      if (result.images && result.images.length > 0) {
        for (const imgUrl of result.images) {
          await sleep(300);
          await sendImageMessage(client.meta_token, item.sender_id, imgUrl);
        }
        console.log(`[Worker] 🖼️ ${result.images.length} image(s) envoyée(s)`);
      }
    }

    // 6. Marquer comme traité
    await markDone(item.id);
    return true;

  } catch (err) {
    console.error(`[Worker] ❌ Erreur traitement ${item.id}:`, err.message);

    // Si tentative < MAX → relâcher pour retenter
    if (item.attempts < 3) {
      await release(item.id);
    } else {
      await markFailed(item.id, err.message);
    }
    return true;
  }
}

// ─── Envoyer message texte sur Messenger ───────────────────
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
  } catch (err) {
    console.error(`[Worker] ❌ Échec envoi texte:`, err.response?.data?.error?.message || err.message);
  }
}

// ─── Envoyer image sur Messenger ──────────────────────────
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
  } catch (err) {
    console.error(`[Worker] ❌ Échec envoi image:`, err.response?.data?.error?.message || err.message);
  }
}

// ─── Typing indicator ─────────────────────────────────────
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
