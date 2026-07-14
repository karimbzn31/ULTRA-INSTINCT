// ============================================================
// ⚡ ULTRA INSTINCT — Gestion des médias (Images + Audio)
// ============================================================
// Images  → Gemini (Google AI) pour analyse visuelle
// Audio   → Whisper (OpenAI) pour transcription
// ============================================================

import axios from 'axios';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─── Analyse d'image avec Gemini ─────────────────────────
export async function analyzeImage(imageUrl, apiKey, metaToken) {
  if (!apiKey) {
    console.warn('[Media] ⚠️ Clé Gemini manquante');
    return null;
  }

  try {
    // Télécharger l'image avec ou sans token Meta
    let imageBuffer;
    if (metaToken && (imageUrl.includes('facebook.com') || imageUrl.includes('fbcdn.net'))) {
      // Image Meta → utiliser l'API Graph avec le token
      const fbRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: { 'Authorization': `OAuth ${metaToken}` },
        timeout: 15000,
      });
      imageBuffer = Buffer.from(fbRes.data);
    } else {
      // Image classique
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
            { text: "Décris cette image en détail pour un assistant commercial. Que vois-tu ? Quels produits ou éléments sont présents ?" },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300 }
      },
      { timeout: 20000 }
    );

    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      console.log(`[Media] ✅ Image analysée: "${text.substring(0, 80)}..."`);
      return text;
    }
    return null;
  } catch (err) {
    console.error('[Media] ❌ Erreur analyse image:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ─── Transcription audio avec GEMINI (gratuit, même clé) ──
export async function transcribeAudio(audioUrl, apiKey) {
  if (!apiKey) {
    console.warn('[Media] ⚠️ Clé Gemini manquante pour audio');
    return null;
  }

  try {
    console.log('[Media] 🎤 Transcription audio via Gemini...');

    // Télécharger l'audio
    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 20000 });
    const audioBase64 = Buffer.from(audioRes.data).toString('base64');
    const mimeType = getAudioMimeType(audioUrl);

    const response = await axios.post(
      `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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
      console.log(`[Media] ✅ Audio transcrit: "${text.substring(0, 80)}..."`);
      return text;
    }
    return null;
  } catch (err) {
    console.error('[Media] ❌ Erreur transcription audio:', err.response?.data?.error?.message || err.message);
    return null;
  }
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
