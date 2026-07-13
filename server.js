// ============================================================
// ⚡ ULTRA INSTINCT — SERVEUR ADMIN + API (Supabase)
// Compatible Vercel (serverless) + localhost
// ============================================================

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// ─── Supabase ──────────────────────────────────────────────
import {
  getClients, getClient, createClient, updateClient,
  toggleClient, deleteClient, getStats, getAdminSettings, updateAdminSettings
} from './lib/supabase.js';

// ─── Config ────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3580;
const JWT_SECRET = process.env.JWT_SECRET || 'ultra-instinct-secret-key-2026';
const isVercel = !!process.env.VERCEL;

// Sur Vercel, on utilise /tmp pour les uploads
const UPLOAD_DIR = isVercel
  ? path.join('/tmp', 'uploads', 'clients')
  : path.join(__dirname, 'uploads', 'clients');

// ─── Admin via variables d'environnement (Vercel) ───────────
// En local : utilise data/admin.json (fallback)
// Sur Vercel : utilise les vars d'env
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@ultra-instinct.ai';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Karim';

// ─── Init dossiers ─────────────────────────────────────────
function ensureDir(dir) {
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
}
ensureDir(UPLOAD_DIR);

// ─── Multer ────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const clientId = req.body.clientId || 'new';
    const ext = path.extname(file.originalname);
    cb(null, `${clientId}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg|json|csv)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('Format non supporté.'));
  }
});

// ─── Admin auth ────────────────────────────────────────────
// Sur Vercel : admin défini via vars d'env
// En local : on crée un fichier admin.json si pas de vars d'env
async function initAdmin() {
  const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');

  // Si on est sur Vercel, les vars d'env suffisent
  if (isVercel || process.env.ADMIN_EMAIL) {
    console.log(`✅ Admin configuré : ${ADMIN_EMAIL}`);
    return;
  }

  // Local : fichier JSON
  let admin = null;
  try {
    if (existsSync(ADMIN_FILE)) {
      admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf-8'));
    }
  } catch {}

  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    ensureDir(path.join(__dirname, 'data'));
    writeFileSync(ADMIN_FILE, JSON.stringify({
      email: 'admin@ultra-instinct.ai',
      password: hash,
      name: 'Karim',
      role: 'superadmin',
      createdAt: new Date().toISOString()
    }, null, 2), 'utf-8');
    console.log('✅ Admin local : admin@ultra-instinct.ai / admin123');
  }
}
await initAdmin();

// ─── Fonction admin check ────────────────────────────────
async function checkAdmin(email, password) {
  // Vérifier les variables d'environnement (Vercel) en PRIORITÉ
  if (process.env.ADMIN_EMAIL) {
    console.log(`[Auth] Checking env vars: expected=${process.env.ADMIN_EMAIL}, got=${email}`);
    return email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD;
  }

  // Sinon vérifier Supabase
  try {
    const settings = await getAdminSettings();
    if (settings && settings.email === email && settings.password) {
      return await bcrypt.compare(password, settings.password);
    }
  } catch (e) {
    console.warn('[Auth] Supabase check failed:', e.message);
  }

  // Fallback fichier local
  try {
    const adminPath = path.join(__dirname, 'data', 'admin.json');
    if (!existsSync(adminPath)) return false;
    const admin = JSON.parse(readFileSync(adminPath, 'utf-8'));
    return email === admin.email && await bcrypt.compare(password, admin.password);
  } catch {
    return false;
  }
}

function getAdminInfo() {
  if (process.env.ADMIN_EMAIL) {
    return { email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME || 'Admin', role: 'superadmin' };
  }

  try {
    const adminPath = path.join(__dirname, 'data', 'admin.json');
    if (existsSync(adminPath)) {
      const a = JSON.parse(readFileSync(adminPath, 'utf-8'));
      return { email: a.email, name: a.name, role: a.role };
    }
  } catch {}
  return { email: 'admin@ultra-instinct.ai', name: 'Admin', role: 'superadmin' };
}

// ─── App ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/admin/assets', express.static(path.join(__dirname, 'admin', 'assets')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ─── Auth middleware ────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé. Token manquant.' });
  }
  try {
    req.admin = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

// ─── Diagnostic ───────────────────────────────────────────
app.get('/api/debug', (req, res) => {
  res.json({
    vercel: !!process.env.VERCEL,
    adminEmail: process.env.ADMIN_EMAIL ? '✅ définie' : '❌ NON définie',
    adminPassword: process.env.ADMIN_PASSWORD ? '✅ définie' : '❌ NON définie',
    supabaseUrl: process.env.SUPABASE_URL ? '✅ définie' : '❌ NON définie',
    supabaseKey: process.env.SUPABASE_SERVICE_KEY ? '✅ définie' : '❌ NON définie',
  });
});

// ─── Routes Auth ──────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const valid = await checkAdmin(email, password);
    if (!valid) {
      console.log(`[Auth] Échec connexion pour: ${email} (env vars: ${!!process.env.ADMIN_EMAIL})`);
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const admin = getAdminInfo();
    const token = jwt.sign(admin, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, admin });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.get('/api/admin/me', authMiddleware, (req, res) => {
  res.json({ admin: req.admin });
});

// ─── Routes Stats ─────────────────────────────────────────
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement stats.' });
  }
});

// ─── Route Admin Settings ────────────────────────────────
app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await updateAdminSettings({ email, password: hash });

    // Mettre à jour aussi les vars d'env Vercel ? Non, on utilise Supabase
    res.json({ success: true, message: 'Identifiants mis à jour.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour.' });
  }
});

// ─── Routes CRUD Clients ─────────────────────────────────
app.get('/api/clients', authMiddleware, async (req, res) => {
  try {
    const { search, active } = req.query;
    res.json(await getClients(search, active));
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement clients.' });
  }
});

app.get('/api/clients/:id', authMiddleware, async (req, res) => {
  try {
    const client = await getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client non trouvé.' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement client.' });
  }
});

app.post('/api/clients', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, company, businessType, platforms, prompt, notes } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Nom et email requis.' });

    const client = await createClient({
      name, email, phone, company, businessType, platforms,
      prompt: prompt || `Tu es un assistant commercial chaleureux et professionnel pour ${name}.\n\nTon rôle est d'accueillir les clients, les aider à choisir les bons produits/services, et collecter les informations nécessaires.\n\n🌍 LANGUES : Détecte automatiquement la langue du client.\n💬 SOIS : chaleureux(se), professionnel(le), empathique.\n📦 CATALOGUE : Présente uniquement les produits disponibles avec leurs prix.\n📋 COLLECTE : Demande les infos UNE PAR UNE.\n✅ VALIDATION : Une fois confirmé, génère un JSON structuré.`,
      notes
    });
    res.status(201).json(client);
  } catch (err) {
    res.status(500).json({ error: 'Erreur création client.' });
  }
});

app.put('/api/clients/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, company, businessType, platforms, prompt, notes } = req.body;
    const client = await updateClient(req.params.id, {
      name, email, phone, company,
      business_type: businessType,
      platforms, prompt, notes
    });
    if (!client) return res.status(404).json({ error: 'Client non trouvé.' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Erreur modification client.' });
  }
});

app.put('/api/clients/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const client = await toggleClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client non trouvé.' });
    res.json({ id: client.id, active: client.active });
  } catch (err) {
    res.status(500).json({ error: 'Erreur toggle statut.' });
  }
});

app.delete('/api/clients/:id', authMiddleware, async (req, res) => {
  try {
    await deleteClient(req.params.id);
    res.json({ success: true, message: 'Client supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression client.' });
  }
});

// ─── Uploads ──────────────────────────────────────────────
app.post('/api/upload/logo', authMiddleware, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    const url = `/uploads/clients/${req.file.filename}`;

    if (req.body.clientId) {
      await updateClient(req.body.clientId, { logo: url });
    }

    res.json({ success: true, filename: req.file.filename, url });
  } catch (err) {
    res.status(500).json({ error: 'Erreur upload logo.' });
  }
});

app.post('/api/upload/catalog', authMiddleware, upload.single('catalog'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

    let catalogData = [];
    if (req.file.mimetype === 'application/json' || req.file.originalname.endsWith('.json')) {
      const content = readFileSync(req.file.path, 'utf-8');
      catalogData = JSON.parse(content);
    }

    if (req.body.clientId) {
      await updateClient(req.body.clientId, {
        catalog: catalogData,
        catalog_filename: req.file.originalname
      });
    }

    res.json({ success: true, filename: req.file.originalname, items: catalogData.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur upload catalogue.' });
  }
});

// ─── Pages Admin ─────────────────────────────────────────
app.get('/admin*', (req, res) => {
  let page = 'login.html';
  const pathname = req.path.replace('/admin', '') || '/';

  if (pathname === '/' || pathname === '/login') page = 'login.html';
  else if (pathname === '/dashboard') page = 'dashboard.html';
  else if (pathname === '/clients') page = 'clients.html';
  else if (pathname === '/client') page = 'client-detail.html';
  else if (pathname === '/new-client') page = 'new-client.html';
  else if (pathname === '/settings') page = 'settings.html';

  res.sendFile(path.join(__dirname, 'admin', page));
});

app.get('/', (req, res) => res.redirect('/admin'));

// ─── Vercel handler (export) ─────────────────────────────
export default app;

// ─── Local development ───────────────────────────────────
if (!isVercel) {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   ⚡ AGENT AI ULTRA INSTINCT — DASHBOARD     ║');
    console.log('╠═══════════════════════════════════════════════╣');
    console.log(`║  📍 http://localhost:${PORT}/admin            ║`);
    console.log('║  📧 admin@ultra-instinct.ai                  ║');
    console.log('║  🔑 admin123                                 ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
  });
}
