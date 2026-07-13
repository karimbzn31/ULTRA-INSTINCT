// ============================================================
// ⚡ ULTRA INSTINCT — Gestion des médias (Images + Audio)
// ============================================================
// Images  → Gemini (Google AI) pour analyse visuelle
// Audio   → Whisper (OpenAI) pour transcription
// ============================================================

import axios from 'axios';
import FormData from 'form-data';

// ─── Analyse d'image avec Gemini ─────────────────────────
export async function analyzeImage(imageUrl) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[Media] ⚠️ GOOGLE_AI_API_KEY non configurée');
    return null;
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { text: "Décris cette image en détail pour un assistant commercial. Que vois-tu ? Quels produits ou éléments sont présents ?" },
            { inline_data: { mime_type: getMimeType(imageUrl), data: await urlToBase64(imageUrl) } }
          ]
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 300 }
      },
      { timeout: 15000 }
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

// ─── Transcription audio avec Whisper ────────────────────
export async function transcribeAudio(audioUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[Media] ⚠️ OPENAI_API_KEY non configurée');
    return null;
  }

  try {
    // Télécharger l'audio
    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const audioBuffer = Buffer.from(audioRes.data);

    // Créer un FormData pour Whisper
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    form.append('model', 'whisper-1');
    form.append('language', 'fr');

    const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: 20000,
    });

    const text = whisperRes?.data?.text?.trim();
    if (text) {
      console.log(`[Media] ✅ Audio transcrit: "${text.substring(0, 80)}..."`);
      return text;
    }
    return null;
  } catch (err) {
    console.error('[Media] ❌ Erreur transcription:', err.response?.data?.error?.message || err.message);
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

async function urlToBase64(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(response.data).toString('base64');
}
