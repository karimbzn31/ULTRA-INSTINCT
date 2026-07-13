import fs from 'fs';

let html = fs.readFileSync('views/client-detail.html', 'utf8');

// ─── 1. Ajouter les fonctions produits ───────────────────
const marker = 'function toggleField(id)';
const idx = html.indexOf(marker);

const functions = `
    // ═══ GESTIONNAIRE DE PRODUITS ═══
    let productColors = [];
    let productSizes = [];
    let editingProductId = null;

    function showAddProduct() {
      editingProductId = null;
      document.getElementById('modalTitle').textContent = '➕ Nouveau produit';
      document.getElementById('saveProductBtn').textContent = '💾 Ajouter';
      document.getElementById('prodName').value = '';
      document.getElementById('prodDesc').value = '';
      document.getElementById('prodPrice').value = '';
      document.getElementById('prodStock').value = '10';
      document.getElementById('prodImage').value = '';
      document.getElementById('productModal').classList.remove('hidden');
      productColors = [];
      productSizes = [];
      renderTags();
    }

    function closeProductModal() {
      document.getElementById('productModal').classList.add('hidden');
    }

    function addColor() {
      const input = document.getElementById('prodColorInput');
      const val = input.value.trim();
      if (val && !productColors.includes(val)) { productColors.push(val); input.value = ''; renderTags(); }
    }
    function addSize() {
      const input = document.getElementById('prodSizeInput');
      const val = input.value.trim().toUpperCase();
      if (val && !productSizes.includes(val)) { productSizes.push(val); input.value = ''; renderTags(); }
    }
    function removeColor(c) { productColors = productColors.filter(x => x !== c); renderTags(); }
    function removeSize(s) { productSizes = productSizes.filter(x => x !== s); renderTags(); }

    function renderTags() {
      document.getElementById('colorTags').innerHTML = productColors.map(c =>
        '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-600/20 text-purple-300 rounded-lg text-xs">' + c + ' <button onclick="removeColor(\\'' + c + '\\')" class="text-purple-300/50 hover:text-red-400">✕</button></span>'
      ).join('');
      document.getElementById('sizeTags').innerHTML = productSizes.map(s =>
        '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 text-blue-300 rounded-lg text-xs">' + s + ' <button onclick="removeSize(\\'' + s + '\\')" class="text-purple-300/50 hover:text-red-400">✕</button></span>'
      ).join('');
    }

    document.getElementById('prodColorInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } });
    document.getElementById('prodSizeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } });

    document.getElementById('prodImageUpload').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const formData = new FormData(); formData.append('image', file);
        const data = await apiUpload('/api/upload/product-image', formData);
        document.getElementById('prodImage').value = data.url;
        document.getElementById('prodImagePreview').classList.remove('hidden');
        document.getElementById('prodImagePreviewImg').src = data.url;
        showSuccess('✅ Image uploadée !');
      } catch(err) { showError('Erreur upload: ' + err.message); }
    });

    document.getElementById('prodImage').addEventListener('input', function() {
      if (this.value) {
        document.getElementById('prodImagePreview').classList.remove('hidden');
        document.getElementById('prodImagePreviewImg').src = this.value;
      }
    });

    function saveProduct() {
      const name = document.getElementById('prodName').value.trim();
      const price = document.getElementById('prodPrice').value;
      if (!name || !price) { showError('Nom et prix requis.'); return; }
      const product = {
        id: editingProductId || 'prod_' + Date.now(),
        name,
        description: document.getElementById('prodDesc').value.trim(),
        price: parseFloat(price),
        stock: parseInt(document.getElementById('prodStock').value) || 0,
        colors: productColors,
        sizes: productSizes,
        image: document.getElementById('prodImage').value.trim(),
        currency: document.getElementById('editCurrency').value || 'DZD',
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
      showSuccess(editingProductId ? '✅ Produit modifié' : '✅ Produit ajouté');
    }

    function editProduct(id) {
      const product = (currentClient.catalog || []).find(p => p.id === id);
      if (!product) return;
      editingProductId = id;
      document.getElementById('modalTitle').textContent = '✏️ Modifier le produit';
      document.getElementById('saveProductBtn').textContent = '💾 Enregistrer';
      document.getElementById('prodName').value = product.name;
      document.getElementById('prodDesc').value = product.description || '';
      document.getElementById('prodPrice').value = product.price || '';
      document.getElementById('prodStock').value = product.stock || 0;
      document.getElementById('prodImage').value = product.image || '';
      productColors = product.colors || [];
      productSizes = product.sizes || [];
      renderTags();
      if (product.image) {
        document.getElementById('prodImagePreview').classList.remove('hidden');
        document.getElementById('prodImagePreviewImg').src = product.image;
      }
      document.getElementById('productModal').classList.remove('hidden');
    }

    function deleteProduct(id) {
      if (!confirm('Supprimer ce produit ?')) return;
      currentClient.catalog = (currentClient.catalog || []).filter(p => p.id !== id);
      renderProducts(currentClient.catalog);
      showSuccess('De produit supprimé');
    }

    function renderProducts(products) {
      const list = document.getElementById('productsList');
      if (!products || products.length === 0) {
        list.innerHTML = '<div class="text-center py-8 text-purple-300/40">Aucun produit. Clique sur "Ajouter".</div>';
        return;
      }
      list.innerHTML = products.map((p, i) =>
        '<div class="flex gap-4 p-4 bg-white/5 rounded-xl border border-white/5 hover:border-purple-500/30 transition group">' +
        (p.image ? '<div class="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-white/5"><img src="' + p.image + '" class="w-full h-full object-cover" onerror="this.style.display=\'none\'" /></div>' : '') +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-start justify-between">' +
            '<h4 class="text-white font-medium truncate">' + p.name + '</h4>' +
            '<span class="text-purple-300 font-semibold whitespace-nowrap ml-2">' + p.price + ' ' + (p.currency || 'DZD') + '</span>' +
          '</div>' +
          (p.description ? '<p class="text-purple-300/60 text-xs mt-1">' + p.description + '</p>' : '') +
          '<div class="flex flex-wrap gap-1 mt-2">' +
          (p.colors || []).map(c => '<span class="px-2 py-0.5 bg-purple-600/15 text-purple-300 rounded text-xs">' + c + '</span>').join('') +
          (p.sizes || []).map(s => '<span class="px-2 py-0.5 bg-blue-600/15 text-blue-300 rounded text-xs">' + s + '</span>').join('') +
          (p.stock ? '<span class="px-2 py-0.5 bg-green-600/15 text-green-300 rounded text-xs">' + p.stock + ' stock</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="flex flex-col gap-1 justify-center opacity-0 group-hover:opacity-100 transition">' +
          '<button onclick="editProduct(\\'' + p.id + '\\')" class="text-purple-400 hover:text-purple-300 text-sm">✏️</button>' +
          '<button onclick="deleteProduct(\\'' + p.id + '\\')" class="text-red-400 hover:text-red-300 text-sm">🗑️</button>' +
        '</div>' +
        '</div>'
      ).join('');
    }
`;

html = html.substring(0, idx) + functions + html.substring(idx);

// ─── 2. Ajouter l'appel renderProducts dans renderClient ──
const statsComment = html.indexOf('// Stats');
const beforeStats = html.lastIndexOf('\n', statsComment - 2);
const beforeStatsLine = html.lastIndexOf('\n', beforeStats - 1);
const insertRender = `
      // Produits
      renderProducts(c.catalog || []);
`;
html = html.substring(0, beforeStatsLine) + insertRender + html.substring(beforeStatsLine);

// ─── 3. Ajouter catalog dans saveClient ──────────────────
const pricingEnd = html.indexOf('},\n          });', html.indexOf('pricing:'));
if (pricingEnd > 0) {
  const before = html.substring(0, pricingEnd + 2); // after the closing }
  const after = html.substring(pricingEnd + 2);
  // Find the matching }); after "pricing: {"
  const saveEnd = after.indexOf('});');
  if (saveEnd > 0) {
    html = before + ',\n          catalog: currentClient?.catalog || []' + after;
  }
}

fs.writeFileSync('views/client-detail.html', html);
console.log('✅ Transformation terminée');
