// ============================================================
// ⚡ ULTRA INSTINCT — Gestion des médias (Images + Audio)
// ============================================================
// Images  → MiMo V2.5 Free (vision native, OpenCode Zen)
// Audio   → Whisper (OpenAI) pour transcription
// ============================================================

import axios from 'axios';
import https from 'https';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─── OpenCode (MiMo Vision) config ────────────────────────
const OPENCODE_BASE = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
const GLOBAL_API_KEY = process.env.OPENCODE_API_KEY || '';

// ─── Analyse d'image AVEC MiMo V2.5 (vision native OpenCode) ──
export async function analyzeImageWithMiMo(imageUrl, apiKey, catalog = [], metaToken = '') {
  const key = apiKey || GLOBAL_API_KEY;
  if (!key) {
    console.warn('[Media] ⚠️ Aucune clé API OpenCode pour MiMo Vision');
    return await analyzeImageFallback(imageUrl, null, metaToken); // fallback Gemini
  }

  try {
    // 1. Télécharger l'image
    let imageBuffer;
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

    const base64Image = imageBuffer.toString('base64');
    const mimeType = getMimeType(imageUrl);

    // 2. Construire le prompt avec le catalogue
    let catalogContext = '';
    if (catalog && catalog.length > 0) {
      catalogContext = '\n\nVoici les produits disponibles dans notre catalogue :\n';
      catalog.forEach(p => {
        catalogContext += `- ${p.name}: ${p.price} DZD`;
        if (p.colors) catalogContext += `, couleurs: ${p.colors.map(c => typeof c === 'string' ? c : c.name).join(', ')}`;
        if (p.sizes) catalogContext += `, tailles: ${p.sizes.join(', ')}`;
        if (p.description) catalogContext += ` — ${p.description}`;
        catalogContext += '\n';
      });
      catalogContext += '\nDis à quel produit du catalogue correspond cette image. Si ça ne correspond à rien, dis ce que tu vois.';
    }

    const prompt = 'Analyse cette image en détail.' + catalogContext;

    // 3. Appel MiMo V2.5 (vision native)
    const response = await axios.post(
      `${OPENCODE_BASE}/chat/completions`,
      {
        model: 'mimo-v2.5-free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
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
      || response?.data?.choices?.[0]?.message?.reasoning
      || '';

    if (text && text.trim()) {
      console.log(`[Media] ✅ Image analysée par MiMo: "${text.substring(0, 80)}..."`);
      return text;
    }

    console.warn('[Media] ⚠️ MiMo a retourné une réponse vide');
    return null;
  } catch (err) {
    console.error('[Media] ❌ Erreur MiMo Vision:', err.response?.data?.error?.message || err.message);
    // Fallback : essayer Gemini
    console.log('[Media] 🔄 Fallback vers Gemini...');
    return await analyzeImageFallback(imageUrl, null, metaToken);
  }
}

// ─── Analyse d'image avec Gemini (fallback) ──────────────
async function analyzeImageFallback(imageUrl, apiKey, metaToken) {
  if (!apiKey) {
    console.warn('[Media] ⚠️ Clé Gemini manquante pour fallback');
    return null;
  }

  try {
    let imageBuffer;
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

    const base64Data = imageBuffer.toString('base64');
    const mimeType = getMimeType(imageUrl);

    const response = await axios.post(
      `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { text: "Décris cette image en détail pour un assistant commercial. Que vois-tu ?" },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300 }
      },
      { timeout: 20000 }
    );

    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      console.log(`[Media] ✅ Image analysée par Gemini (fallback): "${text.substring(0, 80)}..."`);
      return text;
    }
    return null;
  } catch (err) {
    console.error('[Media] ❌ Fallback Gemini échoué:', err.message);
    return null;
  }
}

// ─── Transcription audio avec MiMo (OpenCode) + fallback Gemini ──
export async function transcribeAudio(audioUrl, apiKey, geminiKey, metaToken = '') {
  const key = apiKey || GLOBAL_API_KEY;

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

  if (!audioBuffer || audioBuffer.length < 100) {
    console.warn('[Media] ⚠️ Audio vide ou trop petit');
    return null;
  }

  const audioBase64 = audioBuffer.toString('base64');
  const mimeType = getAudioMimeType(audioUrl);
  console.log(`[Media] 🎤 Audio téléchargé: ${(audioBuffer.length / 1024).toFixed(1)} KB (${mimeType})`);

  // 2. Essayer MiMo (vision + audio via OpenCode)
  if (key) {
    try {
      const response = await axios.post(
        `${OPENCODE_BASE}/chat/completions`,
        {
          model: 'mimo-v2.5-free',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Transcris précisément ce message vocal en texte. Réponds UNIQUEMENT avec la transcription, rien d\'autre.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${audioBase64}` } }
            ]
          }],
          max_tokens: 512,
          temperature: 0.1,
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
        || response?.data?.choices?.[0]?.message?.reasoning
        || '';

      if (text && text.trim() && text.trim().length > 2) {
        console.log(`[Media] ✅ Audio transcrit par MiMo: "${text.substring(0, 80)}..."`);
        return text.trim();
      }
    } catch (err) {
      console.warn('[Media] ⚠️ MiMo audio échoué, fallback Gemini:', err.message?.substring(0, 60));
    }
  }

  // 3. Fallback : Gemini
  if (geminiKey) {
    try {
      const response = await axios.post(
        `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          contents: [{
            parts: [
              { text: "Transcris précisément ce message vocal en texte. Ne rajoute rien d'autre que la transcription." },
              { inline_data: { mime_type: mimeType, data: audioBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        },
        { timeout: 30000 }
      );

      const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        console.log(`[Media] ✅ Audio transcrit par Gemini: "${text.substring(0, 80)}..."`);
        return text;
      }
    } catch (err) {
      console.warn('[Media] ⚠️ Gemini audio échoué:', err.message?.substring(0, 60));
    }
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
