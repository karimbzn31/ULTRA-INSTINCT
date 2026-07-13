// ============================================================
// ⚡ ULTRA INSTINCT — SERVEUR ADMIN + API (Supabase)
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
  toggleClient, deleteClient, getStats, supabase
} from './lib/supabase.js';

// ─── Config ────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3580;
const JWT_SECRET = process.env.JWT_SECRET || 'ultra-instinct-secret-key-2026';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'clients');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

// ─── Init dossiers ─────────────────────────────────────────
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

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
    cb(new Error('Format non supporté. Utilise jpg, png, gif, svg, json ou csv.'));
  }
});

// ─── Helpers JSON (admin only) ─────────────────────────────
function readJSON(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}
function writeJSON(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Prompt par défaut ─────────────────────────────────────
function getDefaultPrompt(clientName) {
  return `Tu es un assistant commercial chaleureux et professionnel pour ${clientName}.

Ton rôle est d'accueillir les clients, les aider à choisir les bons produits/services, et collecter les informations nécessaires.

🌍 LANGUES : Détecte automatiquement la langue du client (français, arabe, darija) et réponds dans la même langue.

💬 SOIS : chaleureux(se), professionnel(le), empathique, naturel(le).

📦 CATALOGUE : Présente uniquement les produits/services disponibles avec leurs prix.

📋 COLLECTE : Demande les infos UNE PAR UNE de façon naturelle. Ne les demande JAMAIS d'un coup.

✅ VALIDATION : Une fois tout confirmé, génère un JSON structuré pour le système.`;
}

// ─── Init admin ────────────────────────────────────────────
async function initAdmin() {
  let admin = readJSON(ADMIN_FILE);
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    admin = {
      email: 'admin@ultra-instinct.ai',
      password: hash,
      name: 'Karim',
      role: 'superadmin',
      createdAt: new Date().toISOString()
    };
    writeJSON(ADMIN_FILE, admin);
    console.log('✅ Admin : admin@ultra-instinct.ai / admin123');
  }
}
await initAdmin();

// ─── App ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/admin/assets', express.static(path.join(__dirname, 'admin', 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Auth middleware ────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé. Token manquant.' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

// ─── Routes Auth ──────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const admin = readJSON(ADMIN_FILE);
    if (!admin) return res.status(500).json({ error: 'Erreur configuration admin.' });
    if (email !== admin.email) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    const token = jwt.sign(
      { email: admin.email, name: admin.name, role: admin.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, admin: { email: admin.email, name: admin.name, role: admin.role } });
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
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement stats.' });
  }
});

// ─── Routes CRUD Clients ──────────────────────────────────
app.get('/api/clients', authMiddleware, async (req, res) => {
  try {
    const { search, active } = req.query;
    const clients = await getClients(search, active);
    res.json(clients);
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
      prompt: prompt || getDefaultPrompt(name),
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

  res.sendFile(path.join(__dirname, 'admin', page));
});

app.get('/', (req, res) => res.redirect('/admin'));

// ─── Start ─────────────────────────────────────────────────
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

export default app;
