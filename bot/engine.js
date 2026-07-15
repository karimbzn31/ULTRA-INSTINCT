// ============================================================
// ⚡ ULTRA INSTINCT — Bot Engine (Closer + Google Sheets)
// ============================================================
// Reçoit un message d'un client, utilise SA config (clé API,
// prompt, modèle, capacités) pour générer une réponse via LLM.
// Gère le cycle de vente : prospection → collecte → Google Sheets
// ============================================================

import axios from 'axios';
import { supabase, getClient } from '../lib/supabase.js';
import { getSession, saveSession, addToHistory, getHistory, ORDER_STATES, COLLECT_ORDER, getNextCollectState } from './session.js';
import { analyzeImageWithMiMo, transcribeAudio } from './media.js';
import { pushOrderToSheet } from './sheets.js';

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
      return { text: "Désolée, je ne peux pas analyser les images pour le moment. Peux-tu me décrire ce dont tu as besoin ?", images: [] };
    }
    // Audio : on essaie TOUJOURS, meme si pas configuré
    // Si la transcription echoue, le bot demandera d'ecrire

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

    // ─── CLOSER STATE MACHINE — traitement du message avant LLM ──
    const currentState = session.state || ORDER_STATES.DISCOVERY;
    if (!session.order) session.order = {};

    // Extraction des infos collectées selon l'état
    if (currentState === ORDER_STATES.COLLECTING_NOM) {
      const cleaned = content.replace(/^(je m'appelle|mon nom|c'est|moi c'est|moi c|nom)\s*/i, '').trim();
      if (cleaned.length > 1) {
        session.order.nom = cleaned;
        session.state = ORDER_STATES.COLLECTING_PHONE;
        console.log(`[Closer] ✅ Nom collecté: ${cleaned}`);
      }
    } else if (currentState === ORDER_STATES.COLLECTING_PHONE) {
      const phoneMatch = content.match(/(?:\+213|00213|0)[5-9]\s*[\s\d]{7,11}/);
      if (phoneMatch) {
        session.order.telephone = phoneMatch[0].replace(/[\s-]/g, '');
        session.state = ORDER_STATES.COLLECTING_WILAYA;
        console.log(`[Closer] ✅ Téléphone collecté: ${session.order.telephone}`);
      }
    } else if (currentState === ORDER_STATES.COLLECTING_WILAYA) {
      const cleaned = content.replace(/^(j'habite à|j'habite|je suis|wilaya de|wilaya|c'est|à)\s*/i, '').trim();
      if (cleaned.length > 2) {
        session.order.wilaya = cleaned;
        session.state = ORDER_STATES.COLLECTING_COMMUNE;
        console.log(`[Closer] ✅ Wilaya collectée: ${cleaned}`);
      }
    } else if (currentState === ORDER_STATES.COLLECTING_COMMUNE) {
      const cleaned = content.replace(/^(commune de|commune|à|la commune|c'est)\s*/i, '').trim();
      if (cleaned.length > 2) {
        session.order.commune = cleaned;
        session.state = ORDER_STATES.COMPLETED;
        console.log(`[Closer] ✅ Commune collectée: ${cleaned} → Commande complète !`);
      }
    }

    // Détection d'intention d'achat (DISCOVERY → collecte)
    if (currentState === ORDER_STATES.DISCOVERY) {
      const intentWords = /je veux|je prends|commander|acheter|bghit|je valide|c bon|ok (?:je|d'acc)|d'accord|vas-y|j'ai besoin|je suis chaud|je suis intéressé|j'achète|j'en veux|je le prends|j'aimerais|chwiya|hanini|nheb|nchri/i.test(content);
      if (intentWords) {
        session.state = ORDER_STATES.COLLECTING_NOM;
        session.order = session.order || {};
        const productName = extractProductFromContext(content, client.catalog);
        if (productName) session.order.product = productName;
        console.log(`[Closer] 🔥 Intention d'achat ! Collecte des infos...`);
      }
    }

    // Sauvegarde immédiate de l'état pour le prompt
    saveSession(clientId, platform, senderId, session);

    // 8. Traiter selon le type de message
    let reply;
    let mediaDescription = '';

    if (messageType === 'image') {
      // Image → Analyse avec MiMo V2.5 (vision native OpenCode)
      console.log('[Bot] 🔍 Analyse image avec MiMo Vision...');
      const metaToken = client.meta_token || '';
      const imageAnalysis = await analyzeImageWithMiMo(attachmentUrl, client.api_key, client.catalog, metaToken);
      if (imageAnalysis) {
        mediaDescription = `\n---\n🖼️ Le client a envoyé une image. Analyse : ${imageAnalysis}\n---`;
        console.log('[Bot] ✅ Image analysée par MiMo Vision');
      } else {
        mediaDescription = "\n---\n🖼️ Le client a envoyé une image. (Analyse non disponible)\n---";
      }
      reply = await callLLM(history, systemPrompt + mediaDescription, apiKey, model, client.catalog);

    } else if (messageType === 'audio') {
      // Audio → Transcription via MiMo (ou Gemini en fallback)
      console.log('[Bot] 🎤 Transcription audio...');
      const metaToken = client.meta_token || '';
      const geminiKey = client.gemini_api_key || process.env.GOOGLE_AI_API_KEY || '';
      const transcription = await transcribeAudio(attachmentUrl, geminiKey, metaToken);
      if (transcription) {
        mediaDescription = `\n---\n🎤 L'utilisateur a envoyé un message vocal. Transcription : "${transcription}"\n---`;
        console.log('[Bot] ✅ Audio transcrit');
      } else {
        // Message naturel : pas d'instruction "dis que tu peux pas"
        // Le LLM est assez intelligent pour gérer ça tout seul
        const hint = geminiKey
          ? "\n---\n🎤 L'utilisateur a envoyé un message vocal mais la transcription a échoué.\n"
          : "\n---\n🎤 L'utilisateur a envoyé un message vocal.\n";
        mediaDescription = hint + "Réponds naturellement comme le ferait un commercial à qui on envoie un vocal.\n---";
        if (!geminiKey) console.log('[Bot] ⚠️ Pas de clé Gemini → transcription impossible');
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

    // ─── CLOSER: Push Google Sheets si commande complète ──
    if (session.state === ORDER_STATES.COMPLETED && session.order) {
      const o = session.order;
      if (o.nom && o.telephone && o.wilaya && o.commune) {
        // Ne push qu'une seule fois
        if (!session._pushed) {
          session._pushed = true;
          // Essayer d'extraire couleur/taille du contexte
          if (!o.color || !o.size) {
            const extras = extractColorSize('', client.catalog);
            // Chercher dans l'historique récent
            const recentChat = (history || []).slice(-6).map(m => m.content).join(' ').toLowerCase();
            const extrasFromHist = extractColorSize(recentChat, client.catalog);
            if (!o.color && extrasFromHist.color) o.color = extrasFromHist.color;
            if (!o.size && extrasFromHist.size) o.size = extrasFromHist.size;
          }
          console.log(`[Closer] 📤 Push commande vers Google Sheets...`);
          pushOrderToSheet(clientId, o).then(res => {
            if (res.success) console.log(`[Closer] ✅ Commande pushée (${res.range})`);
            else console.log(`[Closer] ⚠️ Push sheets: ${res.reason}`);
          }).catch(e => console.warn('[Closer] Push error:', e.message));
        }
      }
    }

    return { text: replyText, images: imagesToSend };
  } catch (err) {
    console.error(`[Bot] Erreur pour client ${clientId}:`, err.message);
    return { text: "Désolée, une erreur technique est survenue. Réessaie plus tard. 😊", images: [] };
  }
}

// ─── Extraction du produit depuis le contexte ────────────
function extractProductFromContext(userMessage, catalog) {
  if (!catalog || !Array.isArray(catalog)) return null;
  const msg = userMessage.toLowerCase();

  for (const product of catalog) {
    if (!product.name) continue;
    const pName = product.name.toLowerCase();
    if (msg.includes(pName)) return product.name;

    // Vérifier les mots significatifs du nom du produit
    const words = pName.split(/\s+/).filter(w => w.length > 3);
    for (const w of words) {
      if (msg.includes(w)) return product.name;
    }
  }

  return null;
}

// ─── Détection couleur/taille dans l'historique ─────────
function extractColorSize(userMessage, catalog) {
  const msg = userMessage.toLowerCase();
  let color = null, size = null;

  for (const product of catalog || []) {
    for (const c of product.colors || []) {
      const cName = typeof c === 'string' ? c : (c.name || '');
      if (cName && msg.includes(cName.toLowerCase())) {
        color = cName;
        break;
      }
    }
    for (const s of product.sizes || []) {
      if (s && msg.includes(s.toLowerCase())) {
        size = s;
        break;
      }
    }
  }

  return { color, size };
}

// ─── Construction du prompt système ───────────────────────
function buildSystemPrompt(client, session = {}) {
  const pricing = client.pricing || {};
  const catalogList = client.catalog || [];
  const order = session.order || {};
  const currentState = session.state || ORDER_STATES.DISCOVERY;

  const parts = [];

  // ========== PRÉAMBULE ABSOLU ==========
  parts.push('═══════════════════════════════════════════════════');
  parts.push('⚠️  INSTRUCTION ABSOLUE — À RESPECTER À LA LETTRE');
  parts.push('═══════════════════════════════════════════════════');
  parts.push('');
  parts.push('Tu es un CLOSER commercial professionnel. Ton rôle est simple :');
  parts.push('1️⃣  VENDRE — Convaincre le client, répondre à ses questions,');
  parts.push('    gérer les objections, montrer la valeur du produit.');
  parts.push('2️⃣  COLLECTER — Une fois le client chaud, récupérer ses coordonnées.');
  parts.push('3️⃣  PASSER LE RELAIS — Une fois les infos complètes, dire qu\'un');
  parts.push('    responsable va l\'appeler pour confirmer la commande.');
  parts.push('');

  // ========== 1. PROMPT PERSONNALISÉ DU CLIENT ==========
  if (client.prompt) {
    parts.push('─── INSTRUCTION DU RESPONSABLE ───');
    parts.push(client.prompt);
    parts.push('─── FIN DE L\'INSTRUCTION ───');
    parts.push('');
  } else {
    parts.push(`Tu es un closer pour ${client.company || client.name}.`);
    parts.push('');
  }

  // ========== 2. CATALOGUE — LA SEULE VÉRITÉ ==========
  if (catalogList.length > 0) {
    parts.push('═══════════════════════════════════════════════════');
    parts.push('📦  CATALOGUE OFFICIEL — PRODUITS RÉELLEMENT DISPONIBLES');
    parts.push('═══════════════════════════════════════════════════');
    parts.push('');
    parts.push('⚠️  RÈGLE ABSOLUE : Tu ne parles QUE des produits listés ci-dessous.');
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
    parts.push('• Ne modifie AUCUN prix. Donne les prix EXACTS.');
    parts.push('• N\'invente AUCUNE couleur ou taille supplémentaire.');
    parts.push('• N\'invente AUCUNE promotion ou offre spéciale.');
    parts.push('• Donne les infos de livraison EXACTES listées.');
    parts.push('═══════════════════════════════════════════════════');
    parts.push('');
  }

  // ========== 3. COMPORTEMENT CLOSER ==========
  parts.push('─── COMPORTEMENT CLOSER ───');
  parts.push('');

  // 3a. Instructions selon l'état actuel
  if (currentState === ORDER_STATES.DISCOVERY) {
    parts.push('🎯  PHASE DE PROSPECTION :');
    parts.push('• Accueille le client chaleureusement.');
    parts.push('• Montre les produits, vante leurs qualités.');
    parts.push('• Utilise des techniques de closing :');
    parts.push('  - "Franchement je te conseille celui-ci, il est top !"');
    parts.push('  - "On a eu plein de retours positifs dessus"');
    parts.push('  - "Y\'a une offre spéciale en ce moment"');
    parts.push('  - "Je te le recommande à 100%, tu vas pas regretter"');
    parts.push('• Gère les objections avec empathie.');
    parts.push('• RÉPONDS À TOUTES LES QUESTIONS : prix, livraison, qualité,');
    parts.push('  disponibilité, couleurs, tailles, délais.');
    parts.push('• RELANCE si le client hésite.');
    parts.push('• Le but : faire passer le client à l\'achat.');
    parts.push('');
    parts.push('🔄  Quand le client montre une intention d\'achat, PASSE à la collecte :');
    parts.push('  "Parfait ! Alors pour finaliser, quel est ton nom complet ?"');
    parts.push('');
  } else if (currentState.startsWith('COLLECTING_')) {
    // En phase de collecte — on détermine ce qu'il reste à demander
    const missing = [];
    if (!order.nom) missing.push('Nom complet');
    if (!order.telephone) missing.push('Numéro de téléphone');
    if (!order.wilaya) missing.push('Wilaya');
    if (!order.commune) missing.push('Commune');

    parts.push('📋  PHASE DE COLLECTE :');
    if (order.product) parts.push(`🛒  Produit choisi : ${order.product}`);
    if (order.color) parts.push(`🎨  Couleur : ${order.color}`);
    if (order.size) parts.push(`📐  Taille : ${order.size}`);
    parts.push(`📝  Coordonnées à récupérer : ${missing.join(' → ')}`);
    parts.push('');
    parts.push('🎯  RÈGLES DE COLLECTE :');
    parts.push('• Demande les infos UNE PAR UNE, de façon naturelle.');
    parts.push('• Quand le client donne une info, CONFIRME-la avant de passer à la suivante.');
    parts.push('  Exemple : "Merci Karim ! Maintenant ton numéro de téléphone ?"');
    parts.push('• Ne demande JAMAIS tout d\'un coup.');
    parts.push('• Sois encourageant(e) : "Plus que ton adresse, on y est presque !"');
    parts.push('• Si une info n\'est pas claire, redemande poliment.');
    parts.push('');
  } else if (currentState === ORDER_STATES.COMPLETED) {
    parts.push('✅  PHASE DE CONFIRMATION :');
    parts.push('• Remercie chaleureusement le client.');
    parts.push('• Récapitule sa commande (produit, couleur, taille, coordonnées).');
    parts.push('• Dis-lui qu\'un responsable va le contacter très rapidement');
    parts.push('  pour confirmer la commande et organiser la livraison.');
    parts.push('• Sois enthousiaste : "Félicitations !"');
    parts.push('• Ne redemande PAS d\'infos déjà fournies.');
    parts.push('');
  }

  // 3b. Conseils généraux de closer
  parts.push('💡  CONSEILS DE CLOSER PRO :');
  parts.push('• Crée un sentiment d\'urgence : "Il n\'en reste que [X] en stock"');
  parts.push('• Rassure : "Y\'a pas de souci, on livre partout en Algérie"');
  parts.push('• Si le client hésite sur le prix : "Franchement c\'est le meilleur rapport qualité-prix"');
  parts.push('• Si le client compare : "Franchement tu trouveras pas mieux ailleurs"');
  parts.push('• Propose toujours : "Je te l\'envoie dans quelle couleur ?"');
  parts.push('');

  // 3c. Comportement humain
  parts.push('🧠  GESTION DES LONGUES DISCUSSIONS :');
  parts.push('• AVANT chaque réponse, RELIS TOUTE la conversation.');
  parts.push('• Ne repose PAS des questions déjà posées et répondues.');
  parts.push('• Souviens-toi de ce que le client a déjà choisi et dit.');
  parts.push('');
  parts.push('🎭  COMPORTEMENT HUMAIN :');
  parts.push('• Le client ne doit JAMAIS sentir qu\'il parle à un robot.');
  parts.push('• Utilise des expressions naturelles : "Ah je vois !", "Bien sûr !", "Pas de souci"');
  parts.push('• Ne dis JAMAIS "en tant qu\'IA" ou "assistant virtuel".');
  parts.push('• Tu es UN VRAI COMMERCIAL. Agis comme tel.');
  parts.push('• Sois concis(se), pas de longs pavés.');
  parts.push('• Le client peut parler en français, arabe ou darija — réponds dans la même langue.');
  parts.push('');

  // ========== 4. RÉCAPITULATIF DES DONNÉES COLLECTÉES ==========
  parts.push('📋  DONNÉES DÉJÀ COLLECTÉES :');
  const fields = [
    ['Produit', order.product],
    ['Couleur', order.color],
    ['Taille', order.size],
    ['Nom', order.nom],
    ['Téléphone', order.telephone],
    ['Wilaya', order.wilaya],
    ['Commune', order.commune],
  ];
  let hasData = false;
  for (const [label, val] of fields) {
    if (val) { parts.push(`  ✅ ${label}: ${val}`); hasData = true; }
  }
  if (!hasData) parts.push('  (Aucune donnée collectée pour le moment)');
  parts.push('');

  // ========== 5. RAPPEL FINAL ==========
  parts.push('═══════════════════════════════════════════════════');
  parts.push('🔐  RÈGLE SUPRÊME :');
  parts.push('1️⃣  Le prompt du responsable est SACRÉ.');
  parts.push('2️⃣  Les produits listés sont les SEULS disponibles.');
  parts.push('3️⃣  N\'invente RIEN (prix, couleur, taille, promo).');
  parts.push('4️⃣  Tu es un CLOSER → vends et collecte les infos.');
  parts.push('5️⃣  Demande les infos UNE PAR UNE, de façon naturelle.');
  parts.push('6️⃣  RELIS toute la conversation avant chaque réponse.');
  parts.push('7️⃣  Quand tout est collecté → dis qu\'un responsable va appeler.');
  parts.push('8️⃣  Comporte-toi comme un HUMAIN, pas comme un robot.');
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
