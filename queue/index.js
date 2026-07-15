// ============================================================
// ⚡ ULTRA INSTINCT — File d'attente des messages (Queue)
// ============================================================
// Permet de répondre immédiatement à Meta (200 OK) avant même
// d'avoir fini de traiter le message. Le worker s'occupe du
// traitement en arrière-plan.
// ============================================================

import { supabase } from '../lib/supabase.js';

const TABLE = 'message_queue';
const MAX_RETRIES = 3;

// ─── 1. ENFILER UN MESSAGE ─────────────────────────────────
// Retourne l'ID du message enfilé, ou null si erreur.
export async function enqueue(clientId, platform, senderId, messageType, content, attachmentUrl) {
  try {
    const { data, error } = await supabase.from(TABLE).insert([{
      client_id: clientId,
      platform,
      sender_id: senderId,
      message_type: messageType,
      content: content || '',
      attachment_url: attachmentUrl || '',
      status: 'pending',
      attempts: 0,
      error: '',
    }]).select('id');

    if (error) throw error;
    console.log(`[Queue] ✅ Message enfilé (${platform}/${senderId}): ${data?.[0]?.id}`);
    return data?.[0]?.id;
  } catch (err) {
    console.error('[Queue] ❌ Erreur enqueue:', err.message);
    return null;
  }
}

// ─── 2. CLAIM ATOMIQUE du prochain message à traiter ──────
// FOR UPDATE SKIP LOCKED = pas de doublon entre workers.
// Retourne l'item complet ou null si rien à traiter.
export async function claimNext() {
  try {
    const { data, error } = await supabase.rpc('claim_queue_item');
    if (error) throw error;
    if (!data || data.length === 0) return null;
    console.log(`[Queue] 🔄 Claimed: ${data[0].id} (tentative #${data[0].attempts})`);
    return data[0];
  } catch (err) {
    console.error('[Queue] ❌ Erreur claim:', err.message);
    return null;
  }
}

// ─── 3. MARQUER COMME TRAITÉ ──────────────────────────────
export async function markDone(id) {
  try {
    await supabase.from(TABLE).update({
      status: 'done',
      processed_at: new Date().toISOString(),
    }).eq('id', id);
    console.log(`[Queue] ✅ Done: ${id}`);
  } catch (err) {
    console.error('[Queue] ❌ Erreur markDone:', err.message);
  }
}

// ─── 4. MARQUER COMME ÉCHEC ───────────────────────────────
export async function markFailed(id, errorMsg) {
  try {
    await supabase.from(TABLE).update({
      status: 'failed',
      error: (errorMsg || '').substring(0, 500),
      processed_at: new Date().toISOString(),
    }).eq('id', id);
    console.log(`[Queue] ❌ Failed: ${id} — ${errorMsg}`);
  } catch (err) {
    console.error('[Queue] ❌ Erreur markFailed:', err.message);
  }
}

// ─── 5. RECULER (relâcher sans marquer done/failed) ──────
// Remet le message en pending pour un prochain worker
export async function release(id) {
  try {
    await supabase.from(TABLE).update({
      status: 'pending',
      locked_at: null,
    }).eq('id', id);
    console.log(`[Queue] 🔄 Released: ${id}`);
  } catch (err) {
    console.error('[Queue] ❌ Erreur release:', err.message);
  }
}

// ─── 6. COMPTER LES EN ATTENTE ────────────────────────────
export async function pendingCount() {
  try {
    const { count, error } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('[Queue] ❌ Erreur count:', err.message);
    return 0;
  }
}

// ─── 7. NETTOYAGE des vieux messages (Tâche manuelle) ─────
// Supprime les messages traités de plus de 7 jours
export async function cleanupOld(days = 7) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .lt('created_at', cutoff)
      .neq('status', 'pending');
    if (error) throw error;
    console.log(`[Queue] 🧹 Nettoyage: ${data?.length || 0} vieux messages supprimés`);
  } catch (err) {
    console.error('[Queue] ❌ Erreur cleanup:', err.message);
  }
}
