// ============================================================
// ⚡ ULTRA INSTINCT — Utilitaires Dashboard
// ============================================================

// ─── API Helper ──────────────────────────────────────────
function getToken() {
  const token = localStorage.getItem('ui_token');
  if (!token) {
    window.location.href = '/admin/login';
    return null;
  }
  return token;
}

async function api(url, method = 'GET', body = null) {
  const token = getToken();
  if (!token) return;

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 401) {
    localStorage.removeItem('ui_token');
    localStorage.removeItem('ui_admin');
    window.location.href = '/admin/login';
    return;
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Erreur API');
  }

  return data;
}

async function apiUpload(url, formData) {
  const token = getToken();
  if (!token) return;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem('ui_token');
    window.location.href = '/admin/login';
    return;
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Erreur upload');
  }

  return data;
}

// ─── Auth Check ──────────────────────────────────────────
function checkAuth() {
  const token = localStorage.getItem('ui_token');
  if (!token) {
    window.location.href = '/admin/login';
    return false;
  }

  // Afficher le nom de l'admin
  const adminData = localStorage.getItem('ui_admin');
  if (adminData) {
    try {
      const admin = JSON.parse(adminData);
      const nameEl = document.getElementById('adminName');
      const avatarEl = document.getElementById('adminAvatar');
      if (nameEl) nameEl.textContent = admin.name || admin.email;
      if (avatarEl) avatarEl.textContent = (admin.name || admin.email).charAt(0).toUpperCase();
    } catch {}
  }

  return true;
}

// ─── Logout ──────────────────────────────────────────────
function logout() {
  localStorage.removeItem('ui_token');
  localStorage.removeItem('ui_admin');
  window.location.href = '/admin/login';
}

// ─── Sidebar Toggle (mobile) ─────────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

// ─── Format Date ─────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

// ─── Notifications ───────────────────────────────────────
function showSuccess(msg) {
  const el = document.createElement('div');
  el.className = 'notification success';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'notification error';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Fermer sidebar en cliquant à côté (mobile)
  document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar');
    const toggle = e.target.closest('[onclick="toggleSidebar()"]');
    if (window.innerWidth <= 768 && sidebar?.classList.contains('open') && !sidebar.contains(e.target) && !toggle) {
      sidebar.classList.remove('open');
    }
  });
});
