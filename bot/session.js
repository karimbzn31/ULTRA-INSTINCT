// ============================================================
// ⚡ ULTRA INSTINCT — Gestion de sessions (mémoire client)
// ============================================================
// Chaque client sur chaque plateforme a sa propre session
// avec son historique de conversation.
// ============================================================

import { supabase } from '../lib/supabase.js';

// Cache mémoire pour éviter les requêtes Supabase à chaque message
const sessionsCache = new Map();
const HISTORY_MAX = 30;

// ─── Récupérer ou créer une session ─────────────────────
export function getSession(clientId, platform, userId) {
  const key = `${clientId}:${platform}:${userId}`;

  if (sessionsCache.has(key)) {
    return sessionsCache.get(key);
  }

  // Nouvelle session
  const session = {
    clientId,
    platform,
    userId,
    state: 'DISCOVERY',
    order: {},
    createdAt: new Date().toISOString(),
  };

  sessionsCache.set(key, session);
  return session;
}

// ─── Sauvegarder une session ────────────────────────────
export function saveSession(clientId, platform, userId, session) {
  const key = `${clientId}:${platform}:${userId}`;
  sessionsCache.set(key, session);
}

// ─── Ajouter un message à l'historique ──────────────────
export function addToHistory(clientId, platform, userId, role, content) {
  const session = getSession(clientId, platform, userId);
  if (!session.history) session.history = [];

  session.history.push({ role, content, timestamp: new Date().toISOString() });

  // Limiter la taille de l'historique
  if (session.history.length > HISTORY_MAX) {
    session.history = session.history.slice(-HISTORY_MAX);
  }
}

// ─── Récupérer l'historique ─────────────────────────────
export function getHistory(clientId, platform, userId) {
  const session = getSession(clientId, platform, userId);
  return session.history || [];
}

// ─── Réinitialiser une session ──────────────────────────
export function resetSession(clientId, platform, userId) {
  const key = `${clientId}:${platform}:${userId}`;
  sessionsCache.delete(key);
}

// ─── Persister les sessions en base (toutes les N opérations) ──
let persistCounter = 0;

export async function persistSessions() {
  persistCounter++;
  if (persistCounter % 5 !== 0) return; // Toutes les 5 opérations

  for (const [key, session] of sessionsCache.entries()) {
    try {
      const [clientId, platform, userId] = key.split(':');
      const { data: existing } = await supabase
        .from('sessions')
        .select('id')
        .eq('client_id', clientId)
        .eq('user_id', userId)
        .eq('platform', platform)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('sessions')
          .update({
            state: session.state,
            order_data: session.order || {},
            history: session.history || [],
            last_interaction: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('sessions')
          .insert([{
            client_id: clientId,
            user_id: userId,
            platform,
            state: session.state,
            order_data: session.order || {},
            history: session.history || [],
          }]);
      }
    } catch (err) {
      console.warn('[Session] Persist error:', err.message);
    }
  }
}
