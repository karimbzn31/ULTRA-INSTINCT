import fs from 'fs';
let html = fs.readFileSync('views/client-detail.html', 'utf8');

const markerStart = '// ═══ WIZARD PRODUIT ═══';
const idx1 = html.indexOf(markerStart);
if (idx1 < 0) { console.log('Marqueur WIZARD non trouvé'); process.exit(1); }

// Find the end of the old wizard section - look for the last function that's part of the old wizard
// After the wizard functions, there's usually a closing script or another section
const afterWizard = html.indexOf('function deleteProduct', idx1);
if (afterWizard < 0) { console.log('Fin wizard non trouvée'); process.exit(1); }

const newJSSection = `
// ═══ WIZARD PRODUIT ═══
let prodStep = 0;
let productColors = [];
let productSizes = [];
let editingProductId = null;

function openProductWizard() {
  editingProductId = null; prodStep = 0;
  document.getElementById('modalTitle').textContent = '➕ Nouveau produit';
  document.getElementById('saveProductBtn').textContent = '💾 Ajouter le produit';
  document.getElementById('prodName').value = '';
  document.getElementById('prodDesc').value = '';
  document.getElementById('prodPrice').value = '';
  document.getElementById('prodDelivery').value = '';
  document.getElementById('prodStock').value = '10';
  productColors = []; productSizes = [];
  document.getElementById('editProdId').value = '';
  renderColorImageList();
  updatePStep(0);
  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

function updatePStep(step) {
  prodStep = step;
  document.querySelectorAll('.p-step').forEach((el,i) => {
    el.classList.toggle('active', i === step);
    el.classList.toggle('done', i < step);
  });
  document.querySelectorAll('[data-pw]').forEach(el => el.classList.toggle('active', parseInt(el.dataset.pw) === step));
}
function productStep(s) { updatePStep(s); }

function addColorWithImage() {
  const name = document.getElementById('prodColorInput').value.trim();
  const image = document.getElementById('pendingColorImage').value;
  if (!name) { showError('Nom de la couleur requis.'); return; }
  if (productColors.find(c => c.name.toLowerCase() === name.toLowerCase())) { showError('Couleur deja ajoutee.'); return; }
  productColors.push({ name, image });
  document.getElementById('prodColorInput').value = '';
  document.getElementById('pendingColorImage').value = '';
  renderColorImageList();
}

function removeColorWithImage(name) {
  productColors = productColors.filter(c => c.name !== name);
  renderColorImageList();
}

function renderColorImageList() {
  const list = document.getElementById('colorImageList');
  if (productColors.length === 0) {
    list.innerHTML = '<div class="text-purple-300/40 text-sm text-center py-4">Aucune couleur ajoutee.</div>';
    return;
  }
  list.innerHTML = productColors.map((c,i) =>
    '<div class="flex items-center gap-3 p-3 bg-white/5 rounded-xl" key="'+i+'">' +
    (c.image ? '<div class="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"><img src="'+c.image+'" class="w-full h-full object-cover" /></div>' : '<div class="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center text-sm">📷</div>') +
    '<span class="flex-1 text-white">'+c.name+'</span>' +
    '<button onclick="removeColorWithImage(\\''+c.name+'\\')" class="text-red-400 hover:text-red-300 text-sm">✕</button>' +
    '</div>'
  ).join('');
}

document.getElementById('prodColorImageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const fd = new FormData(); fd.append('image', file);
    const data = await apiUpload('/api/upload/product-image', fd);
    document.getElementById('pendingColorImage').value = data.url;
    const colorName = document.getElementById('prodColorInput').value.trim();
    if (colorName) {
      if (!productColors.find(c => c.name.toLowerCase() === colorName.toLowerCase())) {
        productColors.push({ name: colorName, image: data.url });
        document.getElementById('prodColorInput').value = '';
        document.getElementById('pendingColorImage').value = '';
        renderColorImageList();
      }
    }
    showSuccess('Image uploadée!');
  } catch(err) { showError('Erreur upload: '+err.message); }
});

function addSize() {
  const v = document.getElementById('prodSizeInput').value.trim().toUpperCase();
  if (v && !productSizes.includes(v)) { productSizes.push(v); document.getElementById('prodSizeInput').value = ''; renderSizeTags(); }
}
function removeSize(s) { productSizes = productSizes.filter(x => x !== s); renderSizeTags(); }
function renderSizeTags() {
  document.getElementById('sizeTags').innerHTML = productSizes.map(s =>
    '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 text-blue-300 rounded-lg text-xs">'+s+' <button onclick="removeSize(\\''+s+'\\')" class="text-purple-300/50 hover:text-red-400">✕</button></span>'
  ).join('');
}

document.getElementById('prodSizeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } });

function saveProduct() {
  const name = document.getElementById('prodName').value.trim();
  const price = document.getElementById('prodPrice').value;
  if (!name || !price) { showError('Nom et prix requis.'); return; }
  if (productColors.length === 0) { showError('Ajoute au moins une couleur.'); return; }
  const product = {
    id: editingProductId || 'prod_'+Date.now(),
    name,
    description: document.getElementById('prodDesc').value.trim(),
    price: parseFloat(price),
    delivery_fee: parseFloat(document.getElementById('prodDelivery').value) || 0,
    stock: parseInt(document.getElementById('prodStock').value) || 0,
    colors: productColors,
    sizes: productSizes,
    currency: 'DZD',
  };
  let products = currentClient.catalog || [];
  if (editingProductId) {
    const idx = products.findIndex(p => p.id === editingProductId);
    if (idx >= 0) products[idx] = product;
  } else {
    products.push(product);
  }
  currentClient.catalog = products;
  renderProducts(products);
  closeProductModal();
  showSuccess(editingProductId ? 'Produit modifie' : 'Produit ajoute');
}

function editProduct(id) {
  const p = (currentClient.catalog || []).find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById('modalTitle').textContent = '✏️ '+p.name;
  document.getElementById('saveProductBtn').textContent = '💾 Enregistrer';
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodDesc').value = p.description || '';
  document.getElementById('prodPrice').value = p.price || '';
  document.getElementById('prodDelivery').value = p.delivery_fee || 0;
  document.getElementById('prodStock').value = p.stock || 0;
  productColors = (p.colors || []).map(c => typeof c === 'string' ? {name:c, image:''} : c);
  productSizes = p.sizes || [];
  renderColorImageList();
  renderSizeTags();
  document.getElementById('editProdId').value = id;
  updatePStep(0);
  document.getElementById('productModal').classList.remove('hidden');
}

function deleteProduct(id) {
  if (!confirm('Supprimer ce produit ?')) return;
  currentClient.catalog = (currentClient.catalog || []).filter(p => p.id !== id);
  renderProducts(currentClient.catalog);
  showSuccess('Supprime');
}

function renderProducts(products) {
  const list = document.getElementById('productsList');
  if (!products || products.length === 0) {
    list.innerHTML = '<div class="text-center py-8 text-purple-300/40">Aucun produit. Clique sur Nouveau produit.</div>';
    return;
  }
  list.innerHTML = products.map(p =>
    '<div class="flex gap-4 p-4 bg-white/5 rounded-xl border border-white/5 hover:border-purple-500/30 transition group">' +
    '<div class="flex-1 min-w-0">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<h4 class="text-white font-semibold">'+p.name+'</h4>' +
        '<div class="flex gap-1 flex-shrink-0">' +
          '<button onclick="editProduct(\\''+p.id+'\\')" class="text-purple-400 hover:text-purple-300 text-xs" title="Modifier">✏️</button>' +
          '<button onclick="deleteProduct(\\''+p.id+'\\')" class="text-red-400 hover:text-red-300 text-xs" title="Supprimer">🗑️</button>' +
        '</div>' +
      '</div>' +
      (p.description ? '<p class="text-purple-300/60 text-xs mt-1">'+p.description+'</p>' : '') +
      '<div class="flex flex-wrap gap-1 mt-2">' +
      '<span class="px-2 py-0.5 bg-purple-600/20 text-purple-300 rounded text-xs font-semibold">'+p.price+' DZD</span>' +
      (p.delivery_fee > 0 ? '<span class="px-2 py-0.5 bg-yellow-600/15 text-yellow-300 rounded text-xs">Livr. '+p.delivery_fee+' DZD</span>' : '<span class="px-2 py-0.5 bg-green-600/15 text-green-300 rounded text-xs">Livr. offerte</span>') +
      (p.stock ? '<span class="px-2 py-0.5 bg-green-600/15 text-green-300 rounded text-xs">'+p.stock+' dispo</span>' : '') +
      '</div>' +
      '<div class="flex flex-wrap gap-2 mt-2">' +
      (p.colors || []).map(c => {
        const cn = typeof c === 'string' ? c : c.name;
        const ci = typeof c === 'string' ? '' : (c.image||'');
        return '<div class="flex items-center gap-1 px-2 py-1 bg-purple-600/15 text-purple-300 rounded-lg text-xs">'+
          (ci ? '<img src="'+ci+'" class="w-5 h-5 rounded object-cover" onerror="this.style.display=\'none\'" />' : '')+
          cn+'</div>';
      }).join('') +
      (p.sizes || []).map(s => '<span class="px-2 py-0.5 bg-blue-600/15 text-blue-300 rounded text-xs">'+s+'</span>').join('') +
      '</div>' +
    '</div>' +
    '</div>'
  ).join('');
}
`;

html = html.substring(0, idx1) + newJSSection + html.substring(afterWizard);
fs.writeFileSync('views/client-detail.html', html);
console.log('✅ Remplacement JS effectué');
