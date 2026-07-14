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

    // 13. ENVOI D'IMAGES : selon le réglage du client
    const autoSetting = client.auto_images || 'on_request';

    if (client.catalog && client.catalog.length > 0 && replyText && autoSetting !== 'never') {
      const replyLower = replyText.toLowerCase();
      const askedForPics = /image|photo|montre|voir|affiche|pic|img|montre-moi/i.test(content || '');
      let shouldSend = false;

      if (autoSetting === 'always') {
        shouldSend = true; // Envoyer à chaque fois
      } else if (autoSetting === 'first_only') {
        // Envoyer seulement si c'est le premier message de l'utilisateur
        const histLen = history?.filter(m => m.role === 'user').length || 0;
        shouldSend = histLen <= 1;
      } else if (askedForPics) {
        shouldSend = true; // Sur demande seulement
      }

      if (shouldSend) {
        let maxImages = autoSetting === 'always' ? 1 : 2; // Always = 1 max / demande = 2 max
        let productFound = false;

        for (const product of client.catalog) {
          if (maxImages <= 0) break;
          if (!product.colors || product.colors.length === 0) continue;

          const pName = product.name.toLowerCase();
          const words = pName.split(/\s+/).filter(w => w.length > 2);
          const found = words.some(w => replyLower.includes(w)) || replyLower.includes(pName);
          if (found) productFound = true;

          if (found || autoSetting === 'always' || autoSetting === 'first_only') {
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

        // Fallback : 1 image du 1er produit
        if (!productFound && client.catalog[0]?.colors) {
          const firstImg = typeof client.catalog[0].colors[0] === 'string'
            ? '' : (client.catalog[0].colors[0]?.image || '');
          if (firstImg && imagesToSend.length === 0) imagesToSend.push(firstImg);
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

  // ========== PRÉAMBULE ABSOLU ==========
  parts.push('═══════════════════════════════════════════════════');
  parts.push('⚠️  INSTRUCTION ABSOLUE — À RESPECTER À LA LETTRE');
  parts.push('═══════════════════════════════════════════════════');
  parts.push('');
  parts.push('Le message ci-dessous a été écrit par le responsable de cette boutique.');
  parts.push('Tu DOIS l\'appliquer EXACTEMENT comme il est écrit, sans le modifier,');
  parts.push('sans l\'ignorer et sans y ajouter ton interprétation.');
  parts.push('Ce prompt est la LOI. Il prime sur tout autre instruction.');
  parts.push('');

  // ========== 1. PROMPT PERSONNALISÉ DU CLIENT ==========
  if (client.prompt) {
    parts.push('─── INSTRUCTION DU RESPONSABLE ───');
    parts.push(client.prompt);
    parts.push('─── FIN DE L\'INSTRUCTION ───');
    parts.push('');
  } else {
    parts.push(`Tu es un assistant commercial chaleureux pour ${client.company || client.name}.`);
    parts.push('');
  }

  // ========== 2. CATALOGUE — LA SEULE VÉRITÉ ==========
  if (catalogList.length > 0) {
    parts.push('═══════════════════════════════════════════════════');
    parts.push('📦  CATALOGUE OFFICIEL — PRODUITS RÉELLEMENT DISPONIBLES');
    parts.push('═══════════════════════════════════════════════════');
    parts.push('');
    parts.push('⚠️  RÈGLE ABSOLUE : Tu ne parles QUE des produits listés ci-dessous.');
    parts.push('Tu ne dois JAMAIS inventer un produit, un prix, une couleur, une taille,');
    parts.push('une promotion ou une option de livraison qui ne figure PAS EXACTEMENT');
    parts.push('dans cette liste. Si tu n\'es pas sûr(e), dis que tu vas vérifier.');
    parts.push('');

    const currency = pricing.currency || 'DZD';
    const hasFreeDelivery = pricing.delivery_free === true;
    const globalDeliveryFee = pricing.delivery_fee || 0;
    const deliveryConditions = pricing.conditions || '';

    catalogList.forEach((p, i) => {
      const colors = (p.colors || []).map(c => typeof c === 'string' ? c : c.name).join(', ');
      const sizes = (p.sizes || []).join(', ');
      const prodDeliveryFee = p.delivery_fee !== undefined ? p.delivery_fee : globalDeliveryFee;
      const free = hasFreeDelivery || p.delivery_free === true;
      const deliveryText = free
        ? 'OFFERTE'
        : (prodDeliveryFee > 0 ? `${prodDeliveryFee} ${currency}` : (deliveryConditions || `${p.price * 0.1} ${currency}`));
      const stockText = p.stock !== undefined && p.stock !== null ? `Stock: ${p.stock} unités` : '';

      parts.push(`■ ${p.name}`);
      parts.push(`  💰 Prix : ${p.price} ${currency}`);
      parts.push(`  📦 Livraison : ${deliveryText}`);
      if (stockText) parts.push(`  📊 ${stockText}`);
      if (p.description) parts.push(`  📝 ${p.description}`);
      if (colors) parts.push(`  🎨 Couleurs : ${colors}`);
      if (sizes) parts.push(`  📐 Tailles : ${sizes}`);
      parts.push('');
    });

    parts.push('═══════════════════════════════════════════════════');
    parts.push('🚫  INTERDICTIONS STRICTES :');
    parts.push('• Ne mentionne AUCUN produit qui n\'est pas dans cette liste.');
    parts.push('• Ne modifie AUCUN prix. Donne les prix EXACTS listés ci-dessus.');
    parts.push('• N\'invente AUCUNE couleur ou taille supplémentaire.');
    parts.push('• N\'invente AUCUNE promotion, réduction ou offre spéciale.');
    parts.push('• La livraison : donne UNIQUEMENT les infos listées.');
    parts.push('• Si un client insiste pour un produit manquant → "Je suis désolé(e),');
    parts.push('  ce produit n\'est pas disponible pour le moment."');
    parts.push('• Si tu as un doute → ne devine PAS, dis que tu vérifies.');
    parts.push('═══════════════════════════════════════════════════');
    parts.push('');
  } else {
    parts.push('⚠️  ATTENTION : Aucun catalogue produit chargé. Reste général(e)');
    parts.push('et n\'invente pas de produits spécifiques.');
    parts.push('');
  }

  // ========== 3. RÈGLES DE CONVERSATION ==========
  parts.push('─── COMPORTEMENT HUMAIN & CONTEXTE ───');
  parts.push('');
  parts.push('• PREMIER MESSAGE (uniquement au tout début) :');
  parts.push('  "Bonjour ! Moi c\'est [ton prénom], [ton rôle] chez [nom de la boutique].');
  parts.push('   Comment puis-je t\'aider ?"');
  parts.push('');
  parts.push('• APRÈS LE PREMIER MESSAGE : Ne te présente PLUS. Réponds directement.');
  parts.push('');
  parts.push('🧠  GESTION DES LONGUES DISCUSSIONS :');
  parts.push('  • AVANT chaque réponse, RELIS TOUTE la conversation depuis le début.');
  parts.push('  • Re-analyse le contexte : de quoi le client a parlé, qu\'a-t-il choisi,');
  parts.push('    quelles infos a-t-il déjà données (nom, adresse, téléphone, produit).');
  parts.push('  • Ne repose PAS des questions déjà posées et répondues plus haut.');
  parts.push('  • Si le client revient sur un sujet abordé plus tôt, souviens-toi');
  parts.push('    de ce qu\'il a dit et rebondis naturellement.');
  parts.push('  • Ne pars pas du principe que le client a oublié — c\'est TOI qui dois');
  parts.push('    te souvenir de tout ce qui s\'est dit.');
  parts.push('');
  parts.push('🎭  COMPORTEMENT HUMAIN — RÈGLE ABSOLUE :');
  parts.push('  • Le client ne doit JAMAIS sentir qu\'il parle à un robot.');
  parts.push('  • Utilise des expressions naturelles : "Ah je vois !", "Bien sûr !",');
  parts.push('    "Pas de souci", "Je comprends", "Désolé pour le délai".');
  parts.push('  • Si le client hésite, encourage-le comme le ferait un vrai commercial :');
  parts.push('    "Franchement, tu fais le bon choix avec celui-ci !"');
  parts.push('  • Si le client plaisante ou rigole, réponds sur le même ton.');
  parts.push('  • Utilise des petites touches personnelles :');
  parts.push('    - "Je te comprends, c\'est pas toujours facile de choisir"');
  parts.push('    - "Franchement tu vas adorer, j\'en ai un moi-même !"');
  parts.push('    - "T\'inquiète, prends ton temps"');
  parts.push('  • Ne dis JAMAIS "en tant qu\'IA" ou "en tant qu\'assistant virtuel".');
  parts.push('  • Tu es UNE VRAIE PERSONNE. Agis comme telle. Point.');
  parts.push('  • Signe parfois tes messages avec ton prénom pour renforcer le côté humain.');
  parts.push('');
  parts.push('• Sois concis(se) et efficace. Pas de longs pavés. Naturel.');
  parts.push('• Le client peut écrire en français, arabe ou darija — réponds dans la même langue.');
  parts.push('• Ne pose pas de questions en rafale. Une question à la fois.');
  parts.push('');
  parts.push('• Si le client demande des photos, cite le NOM EXACT du produit');
  parts.push('  pour que je puisse lui envoyer l\'image correspondante.');
  parts.push('  Exemple : "Oui, la Chemise Premium est disponible en blanc et noir à 4500 DZD."');
  parts.push('');

  // ========== 4. RAPPEL FINAL ==========
  parts.push('═══════════════════════════════════════════════════');
  parts.push('🔐  RÈGLE SUPRÊME — À RELIRE AVANT CHAQUE RÉPONSE :');
  parts.push('1️⃣  Le prompt du responsable est SACRÉ → respecte-le.');
  parts.push('2️⃣  Les produits listés sont les SEULS disponibles.');
  parts.push('3️⃣  N\'invente RIEN (prix, couleur, taille, promo, livraison).');
  parts.push('4️⃣  Si tu ne sais pas → dis que tu vérifies.');
  parts.push('5️⃣  Comporte-toi comme un HUMAIN — le client ne doit pas deviner que tu es un bot.');
  parts.push('6️⃣  RELIS TOUTE la conversation avant de répondre, surtout si elle est longue.');
  parts.push('7️⃣  Ne repose jamais une question déjà répondue.');
  parts.push('═══════════════════════════════════════════════════');

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

    // ⚠️ Ajouter le catalogue comme message système dédié (RAPPEL FERME)
    if (catalog && catalog.length > 0) {
      const productList = catalog.map(p => {
        const colors = (p.colors || []).map(c => typeof c === 'string' ? c : c.name).join(', ');
        const sizes = (p.sizes || []).join(', ');
        return `■ ${p.name} → PRIX: ${p.price} ${p.currency||'DZD'}${p.description ? ' | DESCRIPTION: '+p.description : ''}${colors ? ' | COULEURS: '+colors : ''}${sizes ? ' | TAILLES: '+sizes : ''}`;
      }).join('\n');

      messages.push({
        role: 'system',
        content: '🔐 RAPPEL ABSOLU — Tu ne dois répondre qu\'en fonction de ce catalogue.\n'
          + 'Voici la liste EXACTE et COMPLÈTE des produits disponibles :\n\n'
          + productList + '\n\n'
          + '🚨 INTERDICTION FORMELLE : N\'invente AUCUN produit, prix, couleur, taille ou option de livraison.'
          + ' Si un produit n\'est pas dans cette liste, dis : "Désolé, ce produit n\'est pas disponible."'
      });
      console.log('[Bot] ✅ Catalogue injecté (rappel ferme)');
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
