// ============================================================
// ⚡ ULTRA INSTINCT — Client Supabase
// ============================================================

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  Supabase non configuré. Mets SUPABASE_URL et SUPABASE_SERVICE_KEY dans .env');
}

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' },
});

// ─── Clients ──────────────────────────────────────────────

export async function getClients(search, activeFilter) {
  let query = supabase.from('clients').select('*');

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);
  }
  if (activeFilter === 'true') {
    query = query.eq('active', true);
  } else if (activeFilter === 'false') {
    query = query.eq('active', false);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getClient(id) {
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function createClient(clientData) {
  const { data, error } = await supabase.from('clients').insert([{
    name: clientData.name,
    email: clientData.email,
    phone: clientData.phone || '',
    company: clientData.company || '',
    business_type: clientData.businessType || 'boutique',
    platforms: clientData.platforms || { messenger: false, instagram: false, whatsapp: false, telegram: false },
    prompt: clientData.prompt || '',
    notes: clientData.notes || '',
    api_key: clientData.api_key || '',
    api_model: clientData.api_model || '',
    gemini_api_key: clientData.gemini_api_key || '',
    whisper_api_key: clientData.whisper_api_key || '',
    meta_token: clientData.meta_token || '',
    meta_page_id: clientData.meta_page_id || '',
    meta_verify_token: clientData.meta_verify_token || '',
    bot_capabilities: clientData.bot_capabilities || 'text',
    pricing: clientData.pricing || { price: 0, delivery_free: false, delivery_fee: 0, currency: 'DZD', conditions: '' },
    active: true,
    catalog: [],
    stats: { messages_processed: 0, orders_completed: 0, last_activity: null },
  }]).select();

  if (error) throw error;
  return data?.[0];
}

export async function updateClient(id, updates) {
  const clean = {};
  const allowed = ['name', 'email', 'phone', 'company', 'business_type', 'platforms', 'prompt', 'notes', 'catalog', 'logo', 'catalog_filename', 'api_key', 'api_model', 'gemini_api_key', 'whisper_api_key', 'meta_token', 'meta_page_id', 'meta_verify_token', 'bot_capabilities', 'pricing'];
  for (const key of allowed) {
    if (updates[key] !== undefined) clean[key] = updates[key];
  }
  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('clients').update(clean).eq('id', id).select();
  if (error) throw error;
  return data?.[0];
}

export async function toggleClient(id) {
  const { data: current } = await supabase.from('clients').select('active').eq('id', id).single();
  if (!current) throw new Error('Client non trouvé');

  const { data, error } = await supabase.from('clients')
    .update({ active: !current.active, updated_at: new Date().toISOString() })
    .eq('id', id).select();
  if (error) throw error;
  return data?.[0];
}

export async function deleteClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ─── Stats ────────────────────────────────────────────────

export async function getStats() {
  const { count: total, error: err1 } = await supabase.from('clients').select('*', { count: 'exact', head: true });
  const { count: active, error: err2 } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('active', true);
  const { count: inactive, error: err3 } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('active', false);

  if (err1 || err2 || err3) throw err1 || err2 || err3;

  // Messages totaux (approximatif via la table messages)
  const { count: totalMessages } = await supabase.from('messages').select('*', { count: 'exact', head: true });

  // Platform counts
  const { data: platformData } = await supabase.from('clients').select('platforms');
  const platformStats = { messenger: 0, instagram: 0, whatsapp: 0, telegram: 0 };
  for (const c of platformData || []) {
    if (c.platforms?.messenger) platformStats.messenger++;
    if (c.platforms?.instagram) platformStats.instagram++;
    if (c.platforms?.whatsapp) platformStats.whatsapp++;
    if (c.platforms?.telegram) platformStats.telegram++;
  }

  // Derniers clients
  const { data: recent } = await supabase.from('clients')
    .select('id, name, company, active, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  return {
    total: total || 0,
    active: active || 0,
    inactive: inactive || 0,
    totalMessages: totalMessages || 0,
    platformStats,
    recentClients: (recent || []).map(c => ({
      id: c.id,
      name: c.name,
      company: c.company || '',
      active: c.active,
      createdAt: c.created_at,
    })),
  };
}

// ─── Admin Settings ──────────────────────────────────────────
export async function getAdminSettings() {
  const { data, error } = await supabase.from('admin_settings').select('*').eq('id', 1).single();
  if (error) return null;
  return data;
}

export async function updateAdminSettings({ email, password, name }) {
  const updates = { updated_at: new Date().toISOString() };
  if (email) updates.email = email;
  if (password) updates.password = password; // hash fait dans server.js
  if (name) updates.name = name;

  const { data, error } = await supabase.from('admin_settings').update(updates).eq('id', 1).select();
  if (error) throw error;
  return data?.[0];
}
