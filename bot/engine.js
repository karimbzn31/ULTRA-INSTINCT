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
  let imagesToSend = []; // Images à envoyer sur Messenger
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
    const session = await getSession(clientId, platform, senderId);
    const history = await getHistory(clientId, platform, senderId);

    // 7. Ajouter le message à l'historique
    let userMessage = content;
    if (messageType === 'image') {
      userMessage = attachmentUrl
        ? `[Image envoyée: ${attachmentUrl}]`
        : '[Image envoyée]';
    } else if (messageType === 'audio') {
      userMessage = `[Message vocal: ${content || 'audio reçu'}]`;
    }

    await addToHistory(clientId, platform, senderId, 'user', userMessage);

    // 8. Traiter selon le type de message
    let reply;
    let mediaDescription = '';

    if (messageType === 'image') {
      // Image → Analyse avec Gemini
      console.log('[Bot] 🔍 Analyse image...');
      const geminiKey = client.gemini_api_key || process.env.GOOGLE_AI_API_KEY || '';
      const metaToken = client.meta_token || '';
      const imageAnalysis = await analyzeImage(attachmentUrl, geminiKey, metaToken);
      if (imageAnalysis) {
        mediaDescription = `\n[L'utilisateur a envoyé une image. Analyse de l'image : ${imageAnalysis}]`;
        console.log('[Bot] ✅ Image analysée par Gemini');
      } else {
        mediaDescription = "\n[L'utilisateur a envoyé une image mais je n'ai pas pu l'analyser. Demande-lui de décrire.]";
      }
      reply = await callLLM(history, systemPrompt + mediaDescription, apiKey, model, client.catalog);

    } else if (messageType === 'audio') {
      // Audio → Transcription Gemini puis DeepSeek
      console.log('[Bot] 🎤 Transcription audio...');
      const geminiKey = client.gemini_api_key || client.api_key || process.env.GOOGLE_AI_API_KEY || '';
      const transcription = await transcribeAudio(attachmentUrl, geminiKey);
      if (transcription) {
        mediaDescription = `\n[L'utilisateur a envoyé un message vocal. Transcription : "${transcription}"]`;
        console.log('[Bot] ✅ Audio transcrit par Gemini');
      } else {
        mediaDescription = "\n[L'utilisateur a envoyé un message vocal mais je n'ai pas pu le transcrire. Demande-lui d'écrire.]";
      }
      reply = await callLLM(history, systemPrompt + mediaDescription, apiKey, model, client.catalog);

    } else {
      // Texte → DeepSeek directement
      reply = await callLLM(history, systemPrompt, apiKey, model, client.catalog);
    }

    // 9. Ajouter la réponse à l'historique (TEXTE SEULEMENT)
    const replyText = reply?.text || reply || '';
    await addToHistory(clientId, platform, senderId, 'assistant', replyText);

    // 10. Sauvegarder la session
    saveSession(clientId, platform, senderId, session);

    // 11. Journaliser le message
    await logMessage(clientId, platform, senderId, 'user', userMessage);
    await logMessage(clientId, platform, senderId, 'assistant', replyText);

    // 12. Mettre à jour les stats
    await updateStats(clientId);

    // 13. ENVOI D'IMAGES : UNIQUEMENT si le client demande explicitement
    if (client.catalog && client.catalog.length > 0 && replyText) {
      const askedForPics = /image|photo|montre|voir|affiche|pic|img|montre-moi/i.test(content || '');

      if (askedForPics) {
        // Le client veut voir des produits → chercher lequel dans la réponse
        const replyLower = replyText.toLowerCase();
        let maxImages = 2; // Max 2 images par réponse

        for (const product of client.catalog) {
          if (maxImages <= 0) break;
          if (!product.colors || product.colors.length === 0) continue;

          const pName = product.name.toLowerCase();
          const words = pName.split(/\s+/).filter(w => w.length > 2);
          const found = words.some(w => replyLower.includes(w)) || replyLower.includes(pName);

          if (found) {
            for (const color of product.colors) {
              if (maxImages <= 0) break;
              const img = typeof color === 'string' ? '' : (color.image || '');
              if (img && !imagesToSend.includes(img)) {
                imagesToSend.push(img);
                maxImages--;
              }
            }
          }
        }

        // Si aucun produit spécifique trouvé, envoyer 1 seule image du 1er produit
        if (imagesToSend.length === 0 && client.catalog[0]?.colors) {
          const firstImg = typeof client.catalog[0].colors[0] === 'string'
            ? '' : (client.catalog[0].colors[0]?.image || '');
          if (firstImg) imagesToSend.push(firstImg);
        }
      }
    }

    return { text: replyText, images: imagesToSend };
  } catch (err) {
    console.error(`[Bot] Erreur pour client ${clientId}:`, err.message);
    return { text: "Désolée, une erreur technique est survenue. Réessaie plus tard. 😊", images: [] };
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
    parts.push('Sois professionnel(le) et efficace.');
    parts.push('🌍 Langues : français, arabe, darija.');
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

    parts.push('\n🚫 RÈGLE ABSOLUE : Tu ne vends QUE les produits listés ci-dessus. Si un client demande un produit qui n\'est pas dans la liste, dis-lui que tu ne l\'as pas. N\'invente RIEN.');
    parts.push('\n🖼️ Tu peux envoyer les photos des produits si le client le demande.');
  }

  // 3. Comportement
  parts.push('\n---\n🎯 RÈGLES DE CONVERSATION :');
  parts.push('REGLE 1 - Premier message seulement : "Bonjour [prénom] ! Moi c\'est [ton prénom], commercial(e) chez [nom de la boutique]. Comment puis-je t\'aider ?"');
  parts.push('REGLES 2 - Après le premier message : Ne te présente PLUS. Réponds directement et simplement.');
  parts.push('Sois poli(e) mais pas trop longue. Va droit au but.');
  parts.push('Si le client DEMANDE à voir un produit, cite le NOM EXACT du produit dans ta réponse (ex: "Chemise Premium") pour que je puisse lui montrer la photo.');
  parts.push('Exemple réponse normale : "Oui, la Chemise Premium est à 4500 DZD en blanc et noir."');

  return parts.join('\n');
}

// ─── Appel LLM (DeepSeek via OpenCode Zen) ────────────────
async function callLLM(history, systemPrompt, apiKey, model, catalog) {
  if (!apiKey) {
    return "Le service n'est pas configuré. Contacte l'administrateur.";
  }

  try {
    const messages = [{ role: 'system', content: systemPrompt }];

    // Ajouter les messages d'historique
    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // ⚠️ Ajouter le catalogue comme message système dédié
    if (catalog && catalog.length > 0) {
      const productList = catalog.map(p =>
        `- ${p.name} | ${p.price} ${p.currency||'DZD'}${p.description ? ' : '+p.description : ''}${p.colors ? ' | Couleurs: '+p.colors.map(c=>typeof c==='string'?c:c.name).join(', ') : ''}${p.sizes ? ' | Tailles: '+p.sizes.join(', ') : ''}`
      ).join('\n');

      messages.push({
        role: 'system',
        content: '⚠️ INSTRUCTION ABSOLUE : Voici les SEULS produits disponibles à la vente. Ne mentionne JAMAIS un produit qui ne figure pas dans cette liste :\n\n' + productList + '\n\n🚫 RÈGLE : Ne cite que ces produits. N\'invente rien.'
      });
      console.log('[Bot] ✅ Catalogue injecté');
    }

    const response = await axios.post(
      `${OPENCODE_BASE}/chat/completions`,
      {
        model,
        messages,
        temperature: 0.3, // Basse température = moins d'invention, plus de rigueur
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
