// ============================================================
// ⚡ ULTRA INSTINCT — Gestion des médias (Images + Audio)
// ============================================================
// Images  → Gemini 2.0 Flash (vision IA, prioritaire)
// Audio   → Gemini 2.0 Flash (transcription)
// Fallback vision → MiMo V2.5 Free (OpenCode Zen)
// ============================================================

import axios from 'axios';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─── OpenCode (MiMo Vision) config pour fallback ────────────
const OPENCODE_BASE = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
const GLOBAL_API_KEY = process.env.OPENCODE_API_KEY || '';

// ─── Analyse d'image AVEC GEMINI (prioritaire) ────────────
export async function analyzeImage(imageUrl, geminiKey, catalog = [], metaToken = '') {
  // 1. Télécharger l'image
  let imageBuffer;
  try {
    if (metaToken && (imageUrl.includes('facebook.com') || imageUrl.includes('fbcdn.net'))) {
      const fbRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `OAuth ${metaToken}` },
        timeout: 15000,
      });
      imageBuffer = Buffer.from(fbRes.data);
    } else {
      const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
      imageBuffer = Buffer.from(res.data);
    }
  } catch (err) {
    console.error('[Media] ❌ Téléchargement image échoué:', err.message);
    return null;
  }

  const base64Data = imageBuffer.toString('base64');
  const mimeType = getMimeType(imageUrl);

  // 2. Essayer GEMINI en premier
  if (geminiKey) {
    try {
      let prompt = 'Décris cette image en détail. Que vois-tu ?';

      // Ajouter le catalogue si disponible (Gemini peut analyser + comparer)
      if (catalog && catalog.length > 0) {
        prompt = 'Analyse cette image. Voici notre catalogue produit :\n';
        catalog.forEach(p => {
          prompt += `- ${p.name}: ${p.price} DZD`;
          if (p.colors) prompt += `, couleurs: ${p.colors.map(c => typeof c === 'string' ? c : c.name).join(', ')}`;
          if (p.sizes) prompt += `, tailles: ${p.sizes.join(', ')}`;
          if (p.description) prompt += ` — ${p.description}`;
          prompt += '\n';
        });
        prompt += '\nDis à quel produit du catalogue correspond cette image. Si ça ne correspond à aucun produit, décris ce que tu vois.';
      }

      const response = await axios.post(
        `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 }
        },
        { timeout: 20000 }
      );

      const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`[Media] ✅ Image analysée par Gemini: "${text.substring(0, 80)}..."`);
        return text;
      }
    } catch (err) {
      console.warn('[Media] ⚠️ Gemini vision échoué:', err.response?.data?.error?.message || err.message?.substring(0, 80));
    }
  }

  // 3. Fallback : MiMo Vision (OpenCode)
  const key = GLOBAL_API_KEY;
  if (key) {
    try {
      let catalogContext = '';
      if (catalog && catalog.length > 0) {
        catalogContext = '\n\nCatalogue produits :\n';
        catalog.forEach(p => {
          catalogContext += `- ${p.name}: ${p.price} DZD`;
          if (p.colors) catalogContext += `, couleurs: ${p.colors.map(c => typeof c === 'string' ? c : c.name).join(', ')}`;
          if (p.sizes) catalogContext += `, tailles: ${p.sizes.join(', ')}`;
          catalogContext += '\n';
        });
        catalogContext += '\nÀ quel produit du catalogue correspond cette image ?';
      }

      const response = await axios.post(
        `${OPENCODE_BASE}/chat/completions`,
        {
          model: 'mimo-v2.5-free',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Analyse cette image.' + catalogContext },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
            ]
          }],
          max_tokens: 1024,
          temperature: 0.3,
        },
        {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const text = response?.data?.choices?.[0]?.message?.content
        || response?.data?.choices?.[0]?.message?.reasoning || '';
      if (text && text.trim()) {
        console.log(`[Media] ✅ Image analysée par MiMo (fallback): "${text.substring(0, 80)}..."`);
        return text;
      }
    } catch (err) {
      console.warn('[Media] ⚠️ MiMo fallback échoué:', err.message?.substring(0, 60));
    }
  }

  return null;
}

// ─── Transcription audio avec Gemini (le seul qui gere l'audio) ──
export async function transcribeAudio(audioUrl, geminiKey, metaToken = '') {
  // 1. Télécharger l'audio (avec token Meta si Messenger)
  let audioBuffer;
  try {
    if (metaToken && (audioUrl.includes('facebook.com') || audioUrl.includes('fbcdn.net'))) {
      const fbRes = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `OAuth ${metaToken}` },
        timeout: 20000,
      });
      audioBuffer = Buffer.from(fbRes.data);
    } else {
      const res = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 20000 });
      audioBuffer = Buffer.from(res.data);
    }
  } catch (err) {
    console.error('[Media] ❌ Téléchargement audio échoué:', err.message);
    return null;
  }

  if (!audioBuffer || audioBuffer.length < 200) {
    console.warn('[Media] ⚠️ Audio vide ou trop petit');
    return null;
  }

  const audioBase64 = audioBuffer.toString('base64');
  const mimeType = getAudioMimeType(audioUrl);
  console.log(`[Media] 🎤 Audio téléchargé: ${(audioBuffer.length / 1024).toFixed(1)} KB (${mimeType})`);

  // 2. Essayer Gemini (le SEUL qui supporte l'audio nativement)
  if (geminiKey) {
    try {
      // Gemini 2.0 Flash supporte l'audio inline
      const response = await axios.post(
        `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          contents: [{
            parts: [
              { text: "Transcris précisément ce message vocal en texte. Réponds UNIQUEMENT avec la transcription, rien d'autre." },
              { inline_data: { mime_type: mimeType, data: audioBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
        },
        { timeout: 30000 }
      );

      const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text && text.length > 1) {
        console.log(`[Media] ✅ Audio transcrit par Gemini: "${text.substring(0, 80)}..."`);
        return text;
      }
    } catch (err) {
      console.warn('[Media] ⚠️ Gemini audio échoué:', err.response?.data?.error?.message || err.message?.substring(0, 80));
    }
  } else {
    console.warn('[Media] ⚠️ Clé Gemini manquante pour audio');
  }

  console.warn('[Media] ❌ Aucune transcription possible');
  return null;
}

// ─── Utilitaires ─────────────────────────────────────────
function getMimeType(url = '') {
  if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  if (url.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function getAudioMimeType(url = '') {
  if (url.includes('.mp3')) return 'audio/mpeg';
  if (url.includes('.wav')) return 'audio/wav';
  if (url.includes('.ogg')) return 'audio/ogg';
  if (url.includes('.m4a')) return 'audio/mp4';
  return 'audio/mpeg';
}

async function urlToBase64(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(response.data).toString('base64');
}
