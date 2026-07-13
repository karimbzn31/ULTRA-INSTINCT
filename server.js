// ============================================================
// ⚡ ULTRA INSTINCT — SERVEUR ADMIN + API
// ============================================================

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

// ─── Config ────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.ADMIN_PORT || 3580;
const JWT_SECRET = process.env.JWT_SECRET || 'ultra-instinct-secret-key-2026';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'clients');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

// ─── Init ───────────────────────────────────────────────────
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Storage ────────────────────────────────────────────────
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg|json|csv)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('Format non supporté. Utilise jpg, png, gif, svg, json ou csv.'));
  }
});

// ─── Helpers ────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

function writeJSON(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getClients() {
  return readJSON(CLIENTS_FILE) || [];
}

function saveClients(clients) {
  writeJSON(CLIENTS_FILE, clients);
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

// ─── Init admin par défaut ──────────────────────────────────
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
    console.log('✅ Admin par défaut créé : admin@ultra-instinct.ai / admin123');
  }
}
await initAdmin();

// ─── App ────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files pour le dashboard admin
app.use('/admin/assets', express.static(path.join(__dirname, 'admin', 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Middleware Auth ──────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé. Token manquant.' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

// ─── Routes Auth ──────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  const admin = readJSON(ADMIN_FILE);
  if (!admin) {
    return res.status(500).json({ error: 'Erreur de configuration admin.' });
  }

  if (email !== admin.email) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  const token = jwt.sign(
    { email: admin.email, name: admin.name, role: admin.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    admin: { email: admin.email, name: admin.name, role: admin.role }
  });
});

app.get('/api/admin/me', authMiddleware, (req, res) => {
  res.json({ admin: req.admin });
});

app.put('/api/admin/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis.' });
  }

  const admin = readJSON(ADMIN_FILE);
  const valid = await bcrypt.compare(currentPassword, admin.password);
  if (!valid) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }

  admin.password = await bcrypt.hash(newPassword, 10);
  writeJSON(ADMIN_FILE, admin);
  res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
});

// ─── Routes Stats ─────────────────────────────────────────
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const clients = getClients();
  const active = clients.filter(c => c.active).length;
  const inactive = clients.filter(c => !c.active).length;
  const totalMessages = clients.reduce((sum, c) => sum + (c.stats?.messagesProcessed || 0), 0);

  // Stats par plateforme
  const platformStats = {
    messenger: clients.filter(c => c.platforms?.messenger).length,
    instagram: clients.filter(c => c.platforms?.instagram).length,
    whatsapp: clients.filter(c => c.platforms?.whatsapp).length,
    telegram: clients.filter(c => c.platforms?.telegram).length,
  };

  res.json({
    total: clients.length,
    active,
    inactive,
    totalMessages,
    platformStats,
    recentClients: clients.slice(-5).reverse().map(c => ({
      id: c.id,
      name: c.name,
      company: c.company,
      active: c.active,
      createdAt: c.createdAt
    }))
  });
});

// ─── Routes CRUD Clients ─────────────────────────────────
// GET /api/clients — Liste tous les clients
app.get('/api/clients', authMiddleware, (req, res) => {
  const clients = getClients();
  const { search, active } = req.query;

  let filtered = clients;
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(c =>
      c.name?.toLowerCase().includes(s) ||
      c.company?.toLowerCase().includes(s) ||
      c.email?.toLowerCase().includes(s)
    );
  }
  if (active !== undefined) {
    filtered = filtered.filter(c => c.active === (active === 'true'));
  }

  res.json(filtered.reverse());
});

// GET /api/clients/:id — Détail d'un client
app.get('/api/clients/:id', authMiddleware, (req, res) => {
  const clients = getClients();
  const client = clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé.' });
  res.json(client);
});

// POST /api/clients — Créer un client
app.post('/api/clients', authMiddleware, (req, res) => {
  const { name, email, phone, company, businessType, platforms, prompt, notes } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Nom et email requis.' });
  }

  const clients = getClients();

  const newClient = {
    id: uuidv4(),
    name,
    email,
    phone: phone || '',
    company: company || '',
    businessType: businessType || 'boutique',
    active: true,
    platforms: {
      messenger: platforms?.messenger || false,
      instagram: platforms?.instagram || false,
      whatsapp: platforms?.whatsapp || false,
      telegram: platforms?.telegram || false,
    },
    prompt: prompt || getDefaultPrompt(name),
    logo: '',
    catalog: [],
    catalogFileName: '',
    notes: notes || '',
    stats: {
      messagesProcessed: 0,
      ordersCompleted: 0,
      lastActivity: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  clients.push(newClient);
  saveClients(clients);

  res.status(201).json(newClient);
});

// PUT /api/clients/:id — Modifier un client
app.put('/api/clients/:id', authMiddleware, (req, res) => {
  const clients = getClients();
  const index = clients.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Client non trouvé.' });

  const updates = req.body;
  const client = clients[index];

  // Champs modifiables
  const allowed = ['name', 'email', 'phone', 'company', 'businessType', 'platforms', 'prompt', 'notes'];
  for (const field of allowed) {
    if (updates[field] !== undefined) {
      client[field] = updates[field];
    }
  }

  client.updatedAt = new Date().toISOString();
  clients[index] = client;
  saveClients(clients);

  res.json(client);
});

// PUT /api/clients/:id/toggle — Activer/Désactiver
app.put('/api/clients/:id/toggle', authMiddleware, (req, res) => {
  const clients = getClients();
  const client = clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé.' });

  client.active = !client.active;
  client.updatedAt = new Date().toISOString();
  saveClients(clients);

  res.json({ id: client.id, active: client.active });
});

// DELETE /api/clients/:id — Supprimer
app.delete('/api/clients/:id', authMiddleware, (req, res) => {
  let clients = getClients();
  const index = clients.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Client non trouvé.' });

  clients.splice(index, 1);
  saveClients(clients);
  res.json({ success: true, message: 'Client supprimé.' });
});

// ─── Uploads ──────────────────────────────────────────────
// Upload logo
app.post('/api/upload/logo', authMiddleware, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const clientId = req.body.clientId;
  if (clientId) {
    const clients = getClients();
    const client = clients.find(c => c.id === clientId);
    if (client) {
      client.logo = `/uploads/clients/${req.file.filename}`;
      client.updatedAt = new Date().toISOString();
      saveClients(clients);
    }
  }

  res.json({
    success: true,
    filename: req.file.filename,
    url: `/uploads/clients/${req.file.filename}`
  });
});

// Upload catalogue
app.post('/api/upload/catalog', authMiddleware, upload.single('catalog'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const clientId = req.body.clientId;
  let catalogData = [];

  // Si c'est un JSON, on le parse
  if (req.file.mimetype === 'application/json' || req.file.originalname.endsWith('.json')) {
    try {
      const content = readFileSync(req.file.path, 'utf-8');
      catalogData = JSON.parse(content);
    } catch (err) {
      return res.status(400).json({ error: 'Erreur de parsing du fichier JSON.' });
    }
  }

  if (clientId) {
    const clients = getClients();
    const client = clients.find(c => c.id === clientId);
    if (client) {
      client.catalog = catalogData;
      client.catalogFileName = req.file.originalname;
      client.updatedAt = new Date().toISOString();
      saveClients(clients);
    }
  }

  res.json({
    success: true,
    filename: req.file.originalname,
    items: catalogData.length
  });
});

// ─── Pages Admin (SPA-like redirects) ────────────────────
const ADMIN_PAGES = ['/', '/dashboard', '/clients', '/client'];
app.get('/admin*', (req, res) => {
  // Servir le bon fichier HTML basé sur le chemin
  let page = 'login.html';
  const pathname = req.path.replace('/admin', '') || '/';

  if (pathname === '/' || pathname === '/login') page = 'login.html';
  else if (pathname === '/dashboard') page = 'dashboard.html';
  else if (pathname === '/clients') page = 'clients.html';
  else if (pathname === '/client') page = 'client-detail.html';
  else if (pathname === '/new-client') page = 'new-client.html';

  res.sendFile(path.join(__dirname, 'admin', page));
});

// ─── Redirection racine ───────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ─── Démarrage ────────────────────────────────────────────
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
