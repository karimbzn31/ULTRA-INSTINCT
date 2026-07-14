// ============================================================
// ⚡ ULTRA INSTINCT — Bot Engine
// ============================================================
// Reçoit un message d'un client, utilise SA config (clé API,
// prompt, modèle, capacités) pour générer une réponse via LLM.
// ============================================================

import axios from 'axios';
import { supabase, getClient } from '../lib/supabase.js';
import { getSession, saveSession, addToHistory, getHistory } from './session.js';
import { analyzeImage, transcribeAudio } from './media.js';

// ─── Configuration par défaut ─────────────────────────────
const OPENCODE_BASE = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
const GLOBAL_API_KEY = process.env.OPENCODE_API_KEY || '';
const GLOBAL_MODEL = process.env.OPENCODE_MODEL || 'deepseek-v4-flash-free';

// ─── Générer la réponse selon la config du client ─────────
export async function generateReply(clientId, platform, senderId, messageType, content, attachmentUrl) {
  try {
    // 1. Récupérer le client avec sa config
    const client = await getClient(clientId);
    if (!client || !client.active) {
      console.log(`[Bot] Client ${clientId} inactif ou introuvable`);
      return null;
    }

    // 2. Utiliser SA clé API ou la clé globale
    const apiKey = client.api_key || GLOBAL_API_KEY;
    const model = client.api_model || GLOBAL_MODEL;

    // 3. Vérifier les capacités du bot
    const capabilities = client.bot_capabilities || 'text';

    // 4. Gérer selon le type de message
    if (messageType === 'image' && capabilities !== 'text_image_audio' && capabilities !== 'text_image') {
      return "Désolée, je ne peux pas analyser les images pour le moment. Peux-tu me décrire ce dont tu as besoin ?";
    }

    if (messageType === 'audio' && capabilities !== 'text_image_audio') {
      return "Désolée, je ne peux pas traiter les messages vocaux pour le moment. Peux-tu m'écrire ?";
    }

    // 5. Construire le prompt système
    const systemPrompt = buildSystemPrompt(client);

    // 6. Récupérer l'historique de session
    const session = getSession(clientId, platform, senderId);
    const history = getHistory(clientId, platform, senderId);

    // 7. Ajouter le message à l'historique
    let userMessage = content;
    if (messageType === 'image') {
      userMessage = attachmentUrl
        ? `[Image envoyée: ${attachmentUrl}]`
        : '[Image envoyée]';
    } else if (messageType === 'audio') {
      userMessage = `[Message vocal: ${content || 'audio reçu'}]`;
    }

    addToHistory(clientId, platform, senderId, 'user', userMessage);

    // 8. Traiter selon le type de message
    let reply;
    let mediaDescription = '';

    if (messageType === 'image') {
      // Image → Analyse avec Gemini
      console.log('[Bot] 🔍 Analyse image...');
      const geminiKey = client.gemini_api_key || process.env.GOOGLE_AI_API_KEY || '';
      const imageAnalysis = await analyzeImage(attachmentUrl, geminiKey);
      if (imageAnalysis) {
        mediaDescription = `\n[L'utilisateur a envoyé une image. Analyse de l'image : ${imageAnalysis}]`;
        console.log('[Bot] ✅ Image analysée par Gemini');
      } else {
        mediaDescription = "\n[L'utilisateur a envoyé une image mais je n'ai pas pu l'analyser. Demande-lui de décrire.]";
      }
      reply = await callLLM(history, systemPrompt + mediaDescription, apiKey, model);

    } else if (messageType === 'audio') {
      // Audio → Transcription Whisper puis DeepSeek
      console.log('[Bot] 🎤 Transcription audio...');
      const geminiKey = client.gemini_api_key || client.api_key || process.env.GOOGLE_AI_API_KEY || '';
      const transcription = await transcribeAudio(attachmentUrl, geminiKey);
      if (transcription) {
        mediaDescription = `\n[L'utilisateur a envoyé un message vocal. Transcription : "${transcription}"]`;
        console.log('[Bot] ✅ Audio transcrit par Whisper');
      } else {
        mediaDescription = "\n[L'utilisateur a envoyé un message vocal mais je n'ai pas pu le transcrire. Demande-lui d'écrire.]";
      }
      reply = await callLLM(history, systemPrompt + mediaDescription, apiKey, model);

    } else {
      // Texte → DeepSeek directement
      reply = await callLLM(history, systemPrompt, apiKey, model);
    }

    // 9. Ajouter la réponse à l'historique
    addToHistory(clientId, platform, senderId, 'assistant', reply);

    // 10. Sauvegarder la session
    saveSession(clientId, platform, senderId, session);

    // 11. Journaliser le message
    await logMessage(clientId, platform, senderId, 'user', userMessage);
    await logMessage(clientId, platform, senderId, 'assistant', reply);

    // 12. Mettre à jour les stats
    await updateStats(clientId);

    return reply;
  } catch (err) {
    console.error(`[Bot] Erreur pour client ${clientId}:`, err.message);
    return "Désolée, une erreur technique est survenue. Réessaie plus tard. 😊";
  }
}

// ─── Construction du prompt système ───────────────────────
function buildSystemPrompt(client) {
  const pricing = client.pricing || {};
  const catalogList = client.catalog || [];

  const parts = [];

  // 1. Prompt personnalisé du client
  if (client.prompt) {
    parts.push(client.prompt);
  } else {
    parts.push(`Tu es un assistant commercial pour ${client.company || client.name}.`);
    parts.push('Sois chaleureux(se), professionnel(le) et efficace.');
    parts.push('🌍 Langues : français, arabe, darija — réponds dans la langue du client.');
  }

  // 2. Catalogue formaté lisiblement (SANS JSON brut)
  if (catalogList.length > 0) {
    parts.push('\n---\n📦 CATALOGUE OFFICIEL (produits disponibles) :');
    parts.push('Voici la liste EXACTE des produits à vendre. Tu ne dois JAMAIS inventer de produits.');

    catalogList.forEach((p, i) => {
      const colors = (p.colors || []).map(c => typeof c === 'string' ? c : c.name).join(', ');
      const sizes = (p.sizes || []).join(', ');
      const delivery = p.delivery_fee > 0 ? `Livraison: ${p.delivery_fee} DZD` : 'Livraison OFFERTE';

      parts.push(`\n--- Produit ${i + 1} : ${p.name} ---`);
      parts.push(`Prix: ${p.price} ${p.currency || 'DZD'} | ${delivery}${p.stock ? ` | Stock: ${p.stock} unités` : ''}`);
      if (p.description) parts.push(`Description: ${p.description}`);
      if (colors) parts.push(`Couleurs disponibles: ${colors}`);
      if (sizes) parts.push(`Tailles disponibles: ${sizes}`);
    });

    parts.push('\nRÈGLE STRICTE : Ne propose QUE les produits listés ci-dessus. Ne cite JAMAIS un produit qui n\'est pas dans cette liste.');
  }

  // 3. Règles de collecte
  parts.push('\n---\n📋 COLLECTE D\'INFOS :');
  parts.push('Demande les informations UNE PAR UNE, naturellement.');
  parts.push('Ne demande JAMAIS tout d\'un coup. Sois patient et chaleureux.');

  return parts.join('\n');
}

// ─── Appel LLM (DeepSeek via OpenCode Zen) ────────────────
async function callLLM(history, systemPrompt, apiKey, model) {
  if (!apiKey) {
    return "Le service n'est pas configuré. Contacte l'administrateur.";
  }

  try {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const response = await axios.post(
      `${OPENCODE_BASE}/chat/completions`,
      {
        model,
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = response?.data?.choices?.[0]?.message?.content
      || response?.data?.choices?.[0]?.message?.reasoning
      || response?.data?.choices?.[0]?.message?.reasoning_content
      || '';

    if (!text) {
      console.warn('[Bot] Réponse vide du LLM');
      return "Je n'ai pas pu générer de réponse. Peux-tu reformuler ?";
    }

    return text;
  } catch (error) {
    const errDetail = error.response?.data || error.message;
    console.error('[Bot] Erreur API LLM:', JSON.stringify(errDetail));
    return "Je rencontre un problème technique. Réessaie dans un instant. 😊";
  }
}

// ─── Enregistrer un message ──────────────────────────────
async function logMessage(clientId, platform, userId, sender, content) {
  try {
    await supabase.from('messages').insert([{
      client_id: clientId,
      platform,
      sender,
      content: typeof content === 'string' ? content.substring(0, 500) : '',
      message_type: 'text',
    }]);
  } catch (e) { console.warn('[Bot] Log error:', e.message); }
}

// ─── Mettre à jour les stats du client ───────────────────
async function updateStats(clientId) {
  try {
    const { data: client } = await supabase.from('clients').select('stats').eq('id', clientId).single();
    if (client) {
      const stats = client.stats || {};
      stats.messages_processed = (stats.messages_processed || 0) + 1;
      stats.last_activity = new Date().toISOString();
      await supabase.from('clients').update({ stats }).eq('id', clientId);
    }
  } catch (e) { console.warn('[Bot] Stats error:', e.message); }
}
