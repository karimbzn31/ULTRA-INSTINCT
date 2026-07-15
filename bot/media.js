// ============================================================
// ⚡ ULTRA INSTINCT — Gestion des médias (Images + Audio)
// ============================================================
// Images  → MiMo V2.5 Free via OpenCode (pas de quota limit)
// Audio   → Gemini 2.0 Flash (si quota dispo)
// Fallback → Message naturel si échec
// ============================================================

import axios from 'axios';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const OPENCODE_BASE = (process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
const GLOBAL_API_KEY = process.env.OPENCODE_API_KEY || '';

// ─── Téléchargement d'un média (image ou audio) ─────────
async function downloadMedia(url, metaToken) {
  try {
    const isMeta = metaToken && (url.includes('facebook.com') || url.includes('fbcdn.net') || url.includes('fbsbx.com'));
    if (isMeta) {
      const fbRes = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `OAuth ${metaToken}` },
        timeout: 20000,
      });
      return Buffer.from(fbRes.data);
    } else {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
      return Buffer.from(res.data);
    }
  } catch (err) {
    console.error('[Media] ❌ Téléchargement échoué:', err.message);
    return null;
  }
}

function getMimeType(url = '') {
  if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  if (url.includes('.webp')) return 'image/webp';
  if (url.includes('.svg')) return 'image/svg+xml';
  if (url.includes('cdn.fbsbx.com') || url.includes('facebook.com') || url.includes('fbcdn')) return 'image/jpeg';
  return 'image/jpeg';
}

function getAudioMimeType(url = '') {
  if (url.includes('.mp3')) return 'audio/mpeg';
  if (url.includes('.wav')) return 'audio/wav';
  if (url.includes('.ogg')) return 'audio/ogg';
  if (url.includes('.m4a')) return 'audio/mp4';
  if (url.includes('.webm')) return 'audio/webm';
  if (url.includes('cdn.fbsbx.com') || url.includes('facebook.com') || url.includes('fbcdn')) return 'audio/ogg';
  return 'audio/mpeg';
}

// ─── Construire le contexte catalogue ────────────────────
function buildCatalogContext(catalog) {
  if (!catalog || catalog.length === 0) return '';
  let ctx = '\n\n📦 Catalogue disponible :\n';
  catalog.forEach(p => {
    ctx += `- ${p.name}: ${p.price} DZD`;
    if (p.colors) ctx += `, couleurs: ${p.colors.map(c => typeof c === 'string' ? c : c.name).join(', ')}`;
    if (p.sizes) ctx += `, tailles: ${p.sizes.join(', ')}`;
    if (p.description) ctx += ` — ${p.description}`;
    ctx += '\n';
  });
  ctx += '\nÀ quel produit du catalogue cela correspond-il ? Si ça ne correspond à rien, dis ce que tu vois.';
  return ctx;
}

// ─── Analyse d'image AVEC MiMo V2.5 (pas de quota, OpenCode) ──
export async function analyzeImage(imageUrl, geminiKey, catalog = [], metaToken = '') {
  const apiKey = GLOBAL_API_KEY;
  if (!apiKey) {
    console.warn('[Media] ⚠️ Aucune clé API pour MiMo Vision');
    return null;
  }

  // 1. Télécharger l'image
  const imageBuffer = await downloadMedia(imageUrl, metaToken);
  if (!imageBuffer || imageBuffer.length < 100) {
    console.warn('[Media] ⚠️ Image vide ou trop petite');
    return null;
  }

  const base64Data = imageBuffer.toString('base64');
  const mimeType = getMimeType(imageUrl);
  const catalogCtx = buildCatalogContext(catalog);
  const prompt = 'Analyse cette image en détail.' + catalogCtx;

  // 2. MiMo V2.5 (vision native, pas de quota gratuit)
  try {
    const response = await axios.post(
      `${OPENCODE_BASE}/chat/completions`,
      {
        model: 'mimo-v2.5-free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
          ]
        }],
        max_tokens: 1024,
        temperature: 0.3,
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
      || '';

    if (text && text.trim()) {
      console.log(`[Media] ✅ Image analysée par MiMo: "${text.substring(0, 80)}..."`);
      return text;
    }
  } catch (err) {
    console.warn('[Media] ⚠️ MiMo vision échoué:', err.response?.data?.error?.message || err.message?.substring(0, 60));
  }

  // 3. Fallback: Gemini (si quota pas epuisé)
  if (geminiKey) {
    try {
      const response = await axios.post(
        `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          contents: [{
            parts: [
              { text: 'Décris cette image en détail.' + catalogCtx },
              { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 }
        },
        { timeout: 20000 }
      );

      const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`[Media] ✅ Image analysée par Gemini (fallback): "${text.substring(0, 80)}..."`);
        return text;
      }
    } catch (err) {
      console.warn('[Media] ⚠️ Gemini fallback échoué:', err.message?.substring(0, 80));
    }
  }

  return null;
}

// ─── Transcription audio (Gemini uniquement) ──
export async function transcribeAudio(audioUrl, geminiKey, metaToken = '') {
  // 1. Télécharger l'audio
  const audioBuffer = await downloadMedia(audioUrl, metaToken);
  if (!audioBuffer || audioBuffer.length < 200) {
    console.warn('[Media] ⚠️ Audio vide ou trop petit');
    return null;
  }

  const audioBase64 = audioBuffer.toString('base64');
  const mimeType = getAudioMimeType(audioUrl);
  console.log(`[Media] 🎤 Audio téléchargé: ${(audioBuffer.length / 1024).toFixed(1)} KB (${mimeType})`);

  // 2. Gemini
  if (geminiKey) {
    try {
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
      const geminiErr = err.response?.data?.error?.message || err.message;
      console.error('[Media] ❌ Gemini audio échoué:', geminiErr);

      if (err.response?.status === 429) {
        console.error('[Media] ⚠️ Quota Gemini épuisé');
      }
    }
  } else {
    console.warn('[Media] ⚠️ Pas de clé Gemini');
  }

  return null;
}
