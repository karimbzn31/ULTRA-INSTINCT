// ============================================================
// ⚡ ULTRA INSTINCT — Google Sheets Closer (push commandes)
// ============================================================
// Pousse automatiquement les commandes clients validées
// vers Google Sheets pour traitement par l'équipe.
// ============================================================

import { google } from 'googleapis';
import { supabase } from '../lib/supabase.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// ─── Charger la config Google Sheets d'un client ──────────
async function getSheetConfig(clientId) {
  try {
    // Essayer depuis la base de données client
    const { data, error } = await supabase
      .from('clients')
      .select('google_sheet_id, google_sheet_service_key')
      .eq('id', clientId)
      .single();

    if (error || !data) {
      // Fallback sur les variables d'environnement globales
      const envSheetId = process.env.GOOGLE_SHEET_ID;
      const envServiceKey = process.env.GOOGLE_SERVICE_KEY;
      if (envSheetId && envServiceKey) {
        return {
          sheetId: envSheetId,
          serviceKey: envServiceKey,
          sheetName: process.env.GOOGLE_SHEET_NAME || 'Commandes',
        };
      }
      return null;
    }

    if (data.google_sheet_id && data.google_sheet_service_key) {
      return {
        sheetId: data.google_sheet_id,
        serviceKey: data.google_sheet_service_key,
        sheetName: 'Commandes',
      };
    }

    return null;
  } catch (err) {
    console.error('[Sheets] Erreur chargement config:', err.message);
    return null;
  }
}

// ─── Authentification Google ─────────────────────────────
function getAuth(serviceKeyJson) {
  try {
    const credentials = JSON.parse(serviceKeyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
    return auth;
  } catch (err) {
    console.error('[Sheets] Erreur auth Google:', err.message);
    return null;
  }
}

// ─── Pousser une commande vers Google Sheets ─────────────
export async function pushOrderToSheet(clientId, orderData) {
  try {
    const config = await getSheetConfig(clientId);
    if (!config) {
      console.log('[Sheets] ❌ Aucune config Google Sheets pour ce client');
      return { success: false, reason: 'NO_CONFIG' };
    }

    const auth = getAuth(config.serviceKey);
    if (!auth) {
      return { success: false, reason: 'AUTH_FAILED' };
    }

    const sheets = google.sheets({ version: 'v4', auth });

    // Ligne à ajouter : Date, Produit, Couleur, Taille, Nom, Téléphone, Wilaya, Commune
    const row = [
      new Date().toLocaleDateString('fr-FR'),
      orderData.product || '',
      orderData.color || '',
      orderData.size || '',
      orderData.nom || '',
      orderData.telephone || '',
      orderData.wilaya || '',
      orderData.commune || '',
      orderData.notes || '',
    ];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${config.sheetName}!A:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log('[Sheets] ✅ Commande poussée vers Google Sheets:', response.data.updates?.updatedRange || 'OK');
    return { success: true, range: response.data.updates?.updatedRange };
  } catch (err) {
    console.error('[Sheets] ❌ Erreur push commande:', err.message);
    return { success: false, reason: err.message };
  }
}

// ─── Vérifier la connexion Google Sheets ─────────────────
export async function testSheetConnection(clientId) {
  try {
    const config = await getSheetConfig(clientId);
    if (!config) {
      return { success: false, message: 'Aucune config Google Sheets trouvée.' };
    }

    const auth = getAuth(config.serviceKey);
    if (!auth) {
      return { success: false, message: 'Échec authentification Google.' };
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.get({
      spreadsheetId: config.sheetId,
    });

    return {
      success: true,
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title) || [],
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
