import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, serverTimestamp, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll, getMetadata, uploadString } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { firebaseConfig, adminPasswordHash } from "./firebase-config.js";
import { renderPdfThumb, populateFolderPreview } from "./folderPreview.js";
import { app, auth, db, storage } from "./firebase-init.js";
import { setupViewer3D } from "./viewer3d.js";
import { initSearch, initFilters, updateFilterHighlight } from "./filters.js";
import { initViewToggle, updateViewToggle } from "./viewToggle.js";

// Firebase é inicializado via firebase-init.js

// UI elements
const loginSection = document.getElementById("login");
const dashboardSection = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const itemsEl = document.getElementById("items");
const emptyEl = document.getElementById("empty");
const breadcrumbsEl = document.getElementById("breadcrumbs");
const newFolderBtn = document.getElementById("new-folder-btn");
const fileInput = document.getElementById("file-input");
const viewToggleBtn = document.getElementById("view-toggle");
const backBtn = document.getElementById("back-btn");
const adminBtn = document.getElementById("admin-btn");
const adminModal = document.getElementById("admin-modal");
const adminConfirm = document.getElementById("admin-confirm");
const adminCancel = document.getElementById("admin-cancel");
const adminPasswordInput = document.getElementById("admin-password");
const adminError = document.getElementById("admin-error");
const viewerModal = document.getElementById("viewer-modal");
const viewerClose = document.getElementById("viewer-close");
const viewerCanvas = document.getElementById("viewer-canvas");
const viewerCenter = document.getElementById('viewer-center');
const { openViewer3D, closeViewer } = setupViewer3D({ viewerModal, viewerClose, viewerCanvas, viewerCenter });
const uploadProgress = document.getElementById("upload-progress");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const uploadProgressText = document.getElementById("upload-progress-text");
const searchInput = document.getElementById("search-input");
const sidebarEl = document.getElementById('sidebar');
// Sidebar filtros e FAB
const filterAll = document.getElementById('filter-all');
const filterFolders = document.getElementById('filter-folders');
const filterImages = document.getElementById('filter-images');
const filterPdfs = document.getElementById('filter-pdfs');
const filterModels = document.getElementById('filter-models');
const fabUpload = document.getElementById('fab-upload');
const dropzone = document.getElementById('dropzone');

// State
let currentFolder = null; // Firestore doc id or null for root
let folderPath = [{ id: null, name: "Raiz" }];
let viewMode = "grid"; // 'grid' or 'list'
let isAdminAuthorized = false;
let searchQuery = ""; // busca por nome de pasta
let filterType = 'all'; // all | folders | images | pdfs | models
// Painel inline aberto atualmente (na raiz)
let openInlinePanel = null;
// Token para evitar renders concorrentes/duplicados
let itemsFetchToken = 0;

// Cache simples em memória para acelerar listagens
const CACHE_TTL_MS = 30000; // 30s
const folderListCache = new Map(); // key 'root' -> { time, items }
const folderFilesCache = new Map(); // key folderId -> { time, items }

// Removido: cache persistente via localStorage (não utilizado)

// IDs de pasta baseados no nome para evitar duplicidade
function folderIdFromName(name){
  return (name || '').trim().toLowerCase();
}

const STORAGE_ROOT = 'projects';

// Extensões suportadas para modelos 3D
const MODEL_EXTS = ['.stl','.slt','.obj','.fbx','.gltf','.glb','.3mf','.ply','.step','.stp','.iges','.igs','.x_t','.sldprt'];
function isModelItem(it){
  const name = (it.name || '').toLowerCase();
  const ft = (it.fileType || '').toLowerCase();
  return it.type === 'file' && (
    MODEL_EXTS.some(ext => name.endsWith(ext)) ||
    ['stl','obj','fbx','gltf','glb','3mf','ply','step','stp','iges','igs'].some(k => ft.includes(k))
  );
}

// Ícone visual para arquivos sem miniatura
function getFileIcon(item){
  const name = (item.name || '').toLowerCase();
  const ft = (item.fileType || '').toLowerCase();
  if (item.fileType && item.fileType.startsWith('image/')) return '🖼️';
  if (ft.includes('pdf') || name.endsWith('.pdf')) return '📄';
  if (isModelItem(item)) return '🧊';
  if (ft.includes('zip') || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (ft.includes('audio') || name.endsWith('.mp3') || name.endsWith('.wav')) return '🎵';
  if (ft.includes('video') || name.endsWith('.mp4') || name.endsWith('.mov')) return '🎬';
  return '📎';
}

// Extensão de arquivo (sem ponto), em maiúsculas
function getFileExtension(name){
  const n = (name || '').trim();
  const idx = n.lastIndexOf('.');
  if (idx <= 0 || idx === n.length - 1) return '';
  return n.slice(idx + 1).toUpperCase();
}

// Atualização visual do toggle de visualização agora em viewToggle.js

// Auth state
function hide(el){ el.hidden = true; el.style.display = 'none'; }
function show(el){ el.hidden = false; el.style.display = ''; }

onAuthStateChanged(auth, (user) => {
  if (user) {
    hide(loginSection);
    show(dashboardSection);
    renderBreadcrumbs();
    updateContextUI();
    const w = document.getElementById('welcome-text');
    if (w) w.textContent = `Bem-vindo, ${user.email}`;
    fetchItems();
  } else {
    show(loginSection);
    hide(dashboardSection);
    isAdminAuthorized = false;
    updateContextUI();
    const w = document.getElementById('welcome-text');
    if (w) w.textContent = 'Bem-vindo';
  }
});

// Busca e filtros modularizados
initSearch(searchInput, (value) => {
  searchQuery = (value || '').trim().toLowerCase();
  fetchItems();
});
function setFilter(type){
  filterType = type;
  updateFilterHighlight({ filterAll, filterFolders, filterImages, filterPdfs, filterModels }, type);
  fetchItems();
}
initFilters({ filterAll, filterFolders, filterImages, filterPdfs, filterModels }, (type) => setFilter(type));
setFilter('all');

// Login
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  loginBtn.disabled = true;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Oculta imediatamente o login para evitar qualquer sobreposição
    hide(loginSection);
    show(dashboardSection);
  } catch (err) {
    loginError.textContent = "Falha no login. Verifique seu email e senha.";
    loginError.hidden = false;
    console.error(err);
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  adminBtn.textContent = '🔒 Admin';
});

// Buscar conteúdo do contexto atual (Storage-only)
async function fetchItems() {
  const token = ++itemsFetchToken;
  itemsEl.innerHTML = "";
  emptyEl.hidden = true;
  let items = [];
  // Render rápido a partir do cache em memória, se disponível e recente
  if (!currentFolder) {
    let cachedItems = null;
    const mem = folderListCache.get('root');
    if (mem && (Date.now() - mem.time) < CACHE_TTL_MS) cachedItems = mem.items;
    if (cachedItems) {
      let filtered = cachedItems.slice();
      filtered.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      // Filtro por tipo
      if (filterType === 'folders'){
        filtered = filtered.filter(it => it.type === 'folder');
      } else if (filterType === 'images'){
        filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.startsWith('image/'));
      } else if (filterType === 'pdfs'){
        filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.toLowerCase().includes('pdf'));
      } else if (filterType === 'models'){
        filtered = filtered.filter(isModelItem);
      }
      // Filtro de busca
      if (searchQuery){
        filtered = filtered.filter(it => it.type === 'folder' && (it.name || '').toLowerCase().includes(searchQuery));
      }
      // Proteção extra contra duplicidades por nome na raiz
      const seen = new Set();
      filtered = filtered.filter(it => {
        if (it.type !== 'folder') return true;
        const key = (it.name || '').trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      renderItems(filtered);
    }
  } else {
    let cachedItems = null;
    const mem = folderFilesCache.get(currentFolder);
    if (mem && (Date.now() - mem.time) < CACHE_TTL_MS) cachedItems = mem.items;
    if (cachedItems) {
      let filtered = cachedItems.slice();
      filtered.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      // Filtro por tipo
      if (filterType === 'folders'){
        filtered = filtered.filter(it => it.type === 'folder');
      } else if (filterType === 'images'){
        filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.startsWith('image/'));
      } else if (filterType === 'pdfs'){
        filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.toLowerCase().includes('pdf'));
      } else if (filterType === 'models'){
        filtered = filtered.filter(isModelItem);
      }
      // Filtro de busca
      if (searchQuery){
        filtered = filtered.filter(it => it.type === 'file' && (it.name || '').toLowerCase().includes(searchQuery));
      }
      renderItems(filtered);
    }
  }
  if (!currentFolder){
    // Raiz: listar pastas (prefixes) em STORAGE_ROOT
    const rootRef = ref(storage, STORAGE_ROOT);
    const listing = await listAll(rootRef);
    items = listing.prefixes.map((p) => ({ id: p.name, type: 'folder', name: p.name }));
    // Ler nome exibido do marcador __folder__.json, se existir
    await Promise.all(items.map(async (it) => {
      try{
        const markerUrl = await getDownloadURL(ref(storage, `${STORAGE_ROOT}/${it.id}/__folder__.json`));
        const meta = await fetch(markerUrl).then(r => r.json()).catch(() => null);
        if (meta && meta.name) it.name = meta.name;
      }catch(_){ /* sem marcador */ }
    }));
    // Atualiza cache da raiz (mem)
    const copy = items.slice();
    folderListCache.set('root', { time: Date.now(), items: copy });
  } else {
    // Dentro da pasta: listar arquivos do prefixo
    items = await loadFolderFiles(currentFolder);
    // Atualiza cache da pasta (mem)
    const copy = items.slice();
    folderFilesCache.set(currentFolder, { time: Date.now(), items: copy });
  }
  // Se outra busca começou depois desta, aborta render para evitar duplicação
  if (token !== itemsFetchToken) return;
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  // Filtro por tipo
  let filtered = items;
  if (filterType === 'folders'){
    filtered = filtered.filter(it => it.type === 'folder');
  } else if (filterType === 'images'){
    filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.startsWith('image/'));
  } else if (filterType === 'pdfs'){
    filtered = filtered.filter(it => it.type === 'file' && it.fileType && it.fileType.toLowerCase().includes('pdf'));
  } else if (filterType === 'models'){
    filtered = filtered.filter(isModelItem);
  }
  // Filtro de busca: na raiz busca por pastas; dentro de pasta, busca por arquivos
  if (searchQuery){
    if (currentFolder){
      filtered = filtered.filter(it => it.type === 'file' && (it.name || '').toLowerCase().includes(searchQuery));
    } else {
      filtered = filtered.filter(it => it.type === 'folder' && (it.name || '').toLowerCase().includes(searchQuery));
    }
  }
  // Na raiz, proteção extra contra duplicidades por nome
  if (!currentFolder){
    const seen = new Set();
    filtered = filtered.filter(it => {
      if (it.type !== 'folder') return true;
      const key = (it.name || '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  // Verificar novamente antes de renderizar
  if (token !== itemsFetchToken) return;
  // Substituir renderização inicial de cache pela lista atualizada
  if (itemsEl) { itemsEl.innerHTML = ""; }
  if (emptyEl) { emptyEl.hidden = true; }
  renderItems(filtered);
}

function renderItems(items) {
  // Garantir deduplicação de pastas por nome na raiz
  if (!currentFolder && Array.isArray(items)){
    const seen = new Set();
    items = items.filter(it => {
      if (it.type !== 'folder') return true;
      const key = (it.name || '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (itemsEl){
    itemsEl.classList.toggle("list", viewMode === "list");
    itemsEl.classList.toggle("grid", viewMode === "grid");
  }
  updateSingleToggleLabel();
  if (!items.length) {
    emptyEl.hidden = false;
    return;
  }

  // Dentro de pasta: renderizar painel único com lista de arquivos
  if (currentFolder){
    renderFolderPanel(items);
    return;
  }

  for (const item of items) {
    const el = document.createElement("div");
    el.className = item.type === 'folder' ? "item folder" : "item file";

    const del = document.createElement("button");
    del.className = "icon-btn delete";
    del.title = "Excluir";
    del.textContent = "✕";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteItem(item); });

    // Preparar botão Visualizar 3D para arquivos STL/SLT
    let v3d = null;
    if (item.type === 'file'){
      const nameLower = (item.name || '').toLowerCase();
      const isSTL = nameLower.endsWith('.stl') || nameLower.endsWith('.slt') || (item.fileType && item.fileType.toLowerCase().includes('stl'));
      if (isSTL && item.filePath){
        v3d = document.createElement('button');
        v3d.className = 'icon-btn view3d';
        v3d.title = 'Visualizar 3D (STL)';
        v3d.textContent = '🧊';
        v3d.addEventListener('click', async (e) => { e.stopPropagation(); try{ const url = await getDownloadURL(ref(storage, item.filePath)); closeViewer(); openViewer3D(url); } catch(_){} });
      }
    }

    if (item.type === "folder") {
      // Sempre usar um container .thumb para permitir overlay de botões
      const container = document.createElement("div");
      container.className = "thumb";
      container.style.display = "grid";
      container.style.placeItems = "center";
      container.style.background = "rgba(18,18,18,.6)";
      el.appendChild(container);

      // Slot interno para o preview (mantém botões sobrepostos intactos)
      const previewSlot = document.createElement('div');
      previewSlot.style.width = '100%';
      previewSlot.style.height = '100%';
      previewSlot.style.borderRadius = '12px';
      previewSlot.style.overflow = 'hidden';
      container.appendChild(previewSlot);
      if (item.thumbnailUrl) {
        const img = document.createElement("img");
        img.src = item.thumbnailUrl;
        img.alt = item.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        previewSlot.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.textContent = '📁';
        ph.style.fontSize = '42px';
        ph.style.lineHeight = '1';
        ph.style.display = 'grid';
        ph.style.placeItems = 'center';
        previewSlot.appendChild(ph);
        populateFolderPreview(db, item, previewSlot).catch(()=>{});
      }

      // Botões de ação apenas quando admin estiver autorizado
      if (isAdminAuthorized){
        const coverBtn = document.createElement('button');
        coverBtn.className = 'icon-btn cover';
        coverBtn.title = 'Definir imagem da pasta';
        coverBtn.textContent = '🖼️';
        coverBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.hidden = true;
          input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const coverRef = ref(storage, `${STORAGE_ROOT}/${item.id}/cover_${Date.now()}_${file.name}`);
            const task = uploadBytesResumable(coverRef, file);
            show(uploadProgress);
            uploadProgressBar.style.width = '0%';
            uploadProgressText.textContent = 'Upload 0%';
            await new Promise((resolve, reject) => {
              task.on('state_changed', (snap) => {
                const pct = Math.floor((snap.bytesTransferred / snap.totalBytes) * 100);
                uploadProgressBar.style.width = pct + '%';
                uploadProgressText.textContent = `Upload ${pct}%`;
              }, (err) => reject(err), () => resolve());
            });
            // Atualizar marcador __folder__.json com caminho da capa
            try{
              const markerRef = ref(storage, `${STORAGE_ROOT}/${item.id}/__folder__.json`);
              let meta = {};
              try{
                const markerUrl = await getDownloadURL(markerRef);
                meta = await fetch(markerUrl).then(r => r.json()).catch(() => ({}));
              }catch(_){ /* sem marcador ainda */ }
              meta.cover = coverRef.fullPath; // salvar path no Storage
              await uploadString(markerRef, JSON.stringify(meta), 'raw', { contentType: 'application/json' });
            }catch(_){ /* falha ao atualizar marcador, segue fluxo */ }
            // Invalida cache da raiz para atualizar capas/nome exibido
            folderListCache.delete('root');
            hide(uploadProgress);
            fetchItems();
          }, { once: true });
          document.body.appendChild(input);
          input.click();
          setTimeout(() => { input.remove(); }, 1000);
        });
        // Botão Renomear pasta
        const renameBtn = document.createElement('button');
        renameBtn.className = 'icon-btn rename';
        renameBtn.title = 'Renomear pasta';
        renameBtn.textContent = '✏️';
        renameBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const novo = prompt('Novo nome da pasta:', item.name);
          const newName = (novo || '').trim();
          if (!newName || newName === item.name) return;
          try{
            const markerRef = ref(storage, `${STORAGE_ROOT}/${item.id}/__folder__.json`);
            let meta = {};
            try{
              const markerUrl = await getDownloadURL(markerRef);
              meta = await fetch(markerUrl).then(r => r.json()).catch(() => ({}));
            }catch(_){ /* sem marcador */ }
            meta.name = newName;
            meta.updatedAt = Date.now();
            await uploadString(markerRef, JSON.stringify(meta), 'raw', { contentType: 'application/json' });
            // Invalida cache da raiz para refletir novo nome
            folderListCache.delete('root');
            fetchItems();
          }catch(err){
            alert('Falha ao renomear: ' + (err && err.message ? err.message : err));
          }
        });
        container.appendChild(renameBtn);
        container.appendChild(coverBtn);
        container.appendChild(del);
      }
  } else if (item.thumbnailUrl) {
    // Envolver miniatura em container .thumb e sobrepor o botão 3D
    const container = document.createElement('div');
    container.className = 'thumb';
    container.style.display = 'grid';
    container.style.placeItems = 'center';
    container.style.background = 'rgba(18,18,24,.6)';
    const img = document.createElement('img');
    img.src = item.thumbnailUrl;
    img.alt = item.name;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    container.appendChild(img);
    // Não renderizar botão 3D sobre a miniatura do card para evitar sobreposição do nome
    el.appendChild(container);
  } else {
    const container = document.createElement('div');
    container.className = 'thumb';
    container.style.display = 'grid';
    container.style.placeItems = 'center';
    container.style.background = 'rgba(18,18,24,.6)';
    el.appendChild(container);
    const iconEl = document.createElement('div');
    iconEl.className = 'file-icon';
    iconEl.textContent = getFileIcon(item);
    container.appendChild(iconEl);
    // Não renderizar botão 3D sobre a miniatura do card para evitar sobreposição do nome
  }

    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    const type = document.createElement("div");
    type.className = "type";
    type.textContent = item.type === "folder" ? "Pasta" : (item.fileType || "Arquivo");
    // Badge de extensão (apenas arquivos)
    if (item.type === 'file'){
      const ext = getFileExtension(item.name);
      if (ext){
        const badge = document.createElement('span');
        badge.className = 'ext-badge';
        badge.textContent = ext;
        row.appendChild(badge);
      }
    }
    row.appendChild(name);
    row.appendChild(type);
    el.appendChild(row);

    el.addEventListener("click", async () => {
      if (item.type === "folder") {
        // Expandir painel inline abaixo do card, sem navegar
        // Se já existe painel desta pasta, alternar (fecha o atual)
        const thumb = el.querySelector('.thumb');
        const siblingAfterThumb = thumb ? thumb.nextElementSibling : null;
        const siblingAfterCard = el.nextElementSibling;
        const isPanelAfterThumb = siblingAfterThumb && siblingAfterThumb.classList && (siblingAfterThumb.classList.contains('inline-panel') || siblingAfterThumb.classList.contains('inline') || siblingAfterThumb.classList.contains('folder-panel') && siblingAfterThumb.classList.contains('inline'));
        const isPanelAfterCard = siblingAfterCard && siblingAfterCard.classList && (siblingAfterCard.classList.contains('inline-panel') || siblingAfterCard.classList.contains('inline') || siblingAfterCard.classList.contains('folder-panel') && siblingAfterCard.classList.contains('inline'));
        const existingPanel = isPanelAfterThumb ? siblingAfterThumb : (isPanelAfterCard ? siblingAfterCard : null);
        if (existingPanel){
          // Toggle: se clicar na mesma pasta, fecha
          existingPanel.remove();
          openInlinePanel = null;
          return;
        }
        // Antes de abrir uma nova pasta, feche o painel aberto em outra pasta
        if (openInlinePanel && openInlinePanel.parentNode){
          try { openInlinePanel.remove(); } catch(_) {}
          openInlinePanel = null;
        }
        const panel = document.createElement('div');
        panel.className = 'folder-panel glass inline inline-panel';
        if (thumb){
          thumb.insertAdjacentElement('afterend', panel);
        } else {
          el.insertAdjacentElement('afterend', panel);
        }
        // Placeholder de carregamento imediato para evitar sensação de travamento
        panel.innerHTML = `
          <div class="panel-header">
            <div class="panel-left">
              <h3>Carregando...</h3>
              <div class="panel-sub">Buscando arquivos</div>
            </div>
          </div>
          <div class="file-list">
            <div class="file-row">
              <div class="left">
                <div class="icon">⏳</div>
                <div class="name">Aguarde um instante</div>
              </div>
            </div>
          </div>`;
        const files = await loadFolderFiles(item.id);
        renderFolderPanelInto(panel, files, item);
        openInlinePanel = panel;
      } else if (item.filePath) {
        try {
          const url = await getDownloadURL(ref(storage, item.filePath));
          window.open(url, "_blank");
        } catch(_){}
      }
    });

    // Para arquivos, mostrar excluir apenas se admin
    if (item.type !== 'folder'){
      if (isAdminAuthorized){ el.appendChild(del); }
    }

    itemsEl.appendChild(el);
  }
}

function renderFolderPanel(files){
  itemsEl.innerHTML = '';
  // Dedup: garantir que cada arquivo apareça uma única vez
  const seen = new Set();
  const uniqueFiles = files.filter(f => {
    if (f.type !== 'file') return true;
    const key = (f.filePath || `${f.id}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const panel = document.createElement('div');
  panel.className = 'folder-panel glass';
  // Preview
  const preview = document.createElement('div');
  preview.className = 'folder-preview';
  (async () => {
    const imgItem = uniqueFiles.find(f => f.type === 'file' && f.fileType && f.fileType.startsWith('image/'));
    if (imgItem && imgItem.filePath){
      try{
        const url = await getDownloadURL(ref(storage, imgItem.filePath));
        const img = document.createElement('img');
        img.src = url;
        img.alt = imgItem.name;
        preview.innerHTML = '';
        preview.appendChild(img);
      } catch(_){ preview.textContent = ''; }
    } else {
      preview.textContent = '';
    }
  })();
  panel.appendChild(preview);

  // Header
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('h3');
  title.textContent = folderPath[folderPath.length-1]?.name || 'Pasta';
  const sub = document.createElement('div');
  sub.className = 'panel-sub';
  sub.textContent = `${uniqueFiles.filter(f => f.type==='file').length} arquivos`;
  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn primary outline';
  uploadBtn.title = 'Upload para esta pasta';
  uploadBtn.textContent = 'Upload';
  uploadBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      await handleFilesUploadTo(files, currentFolder);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
  actions.appendChild(uploadBtn);
  const left = document.createElement('div');
  left.className = 'panel-left';
  left.appendChild(title);
  left.appendChild(sub);
  header.appendChild(left);
  header.appendChild(actions);
  panel.appendChild(header);

  // Lista de arquivos
  const list = document.createElement('div');
  list.className = 'file-list';
  for (const item of uniqueFiles){
    const row = document.createElement('div');
    row.className = 'file-row';
    row.addEventListener('click', async () => {
      if (item.filePath){
        try{ const url = await getDownloadURL(ref(storage, item.filePath)); window.open(url, '_blank'); } catch(_){}
      }
    });
    const left = document.createElement('div');
    left.className = 'left';
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = getFileIcon(item);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    // Extensão ao lado do nome
    if (item.type === 'file'){
      const ext = getFileExtension(item.name);
      if (ext){
        const badge = document.createElement('span');
        badge.className = 'ext-badge';
        badge.textContent = ext;
        left.appendChild(badge);
      }
    }
    left.appendChild(icon);
    left.appendChild(name);
    const right = document.createElement('div');
    right.className = 'right';
    const nameLower = (item.name || '').toLowerCase();
    const isSTL = nameLower.endsWith('.stl') || nameLower.endsWith('.slt') || (item.fileType && item.fileType.toLowerCase().includes('stl'));
    if (isSTL && item.filePath){
      const btn3d = document.createElement('button');
      btn3d.className = 'action view3d';
      btn3d.title = '3D';
      btn3d.addEventListener('click', async (e) => { e.stopPropagation(); try{ const url = await getDownloadURL(ref(storage, item.filePath)); closeViewer(); openViewer3D(url); } catch(_){} });
      right.appendChild(btn3d);
    }
    const dl = document.createElement('button');
    dl.className = 'action download';
    dl.title = 'Baixar';
    dl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-16a2 2 0 0 0-2 2v6H8l4 4 4-4h-2V6a2 2 0 0 0-2-2z"/></svg>';
    dl.addEventListener('click', async (e) => { e.stopPropagation(); if (item.filePath){ try{ const url = await getDownloadURL(ref(storage, item.filePath)); window.open(url, '_blank'); } catch(_){} } });
    right.appendChild(dl);
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
  panel.appendChild(list);
  itemsEl.appendChild(panel);
}

// Renderiza painel de pasta dentro de um container específico (inline)
function renderFolderPanelInto(container, files, folderItem){
  // Dedup: garantir que cada arquivo apareça uma única vez
  const seen = new Set();
  const uniqueFiles = files.filter(f => {
    if (f.type !== 'file') return true;
    const key = (f.filePath || `${f.id}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  container.innerHTML = '';
  // Inline panel não repete imagem: a miniatura já está no card acima

  // Header
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('h3');
  title.textContent = (folderItem && folderItem.name) || 'Pasta';
  const sub = document.createElement('div');
  sub.className = 'panel-sub';
  sub.textContent = `${files.length} arquivos`;
  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn primary outline';
  uploadBtn.title = 'Upload para esta pasta';
  uploadBtn.textContent = 'Upload';
  uploadBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      await handleFilesUploadTo(files, folderItem?.id || null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
  actions.appendChild(uploadBtn);
  const left = document.createElement('div');
  left.className = 'panel-left';
  left.appendChild(title);
  left.appendChild(sub);
  header.appendChild(left);
  header.appendChild(actions);
  container.appendChild(header);

  // Lista
  const list = document.createElement('div');
  list.className = 'file-list';
  for (const item of uniqueFiles){
    const row = document.createElement('div');
    row.className = 'file-row';
    row.addEventListener('click', async () => {
      if (item.filePath){
        try{ const url = await getDownloadURL(ref(storage, item.filePath)); window.open(url, '_blank'); } catch(_){}
      }
    });
    const left = document.createElement('div');
    left.className = 'left';
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = getFileIcon(item);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    // Extensão ao lado do nome (inline)
    if (item.type === 'file'){
      const ext = getFileExtension(item.name);
      if (ext){
        const badge = document.createElement('span');
        badge.className = 'ext-badge';
        badge.textContent = ext;
        left.appendChild(badge);
      }
    }
    left.appendChild(icon);
    left.appendChild(name);
    const right = document.createElement('div');
    right.className = 'right';
    const nameLower = (item.name || '').toLowerCase();
    const isSTL = nameLower.endsWith('.stl') || nameLower.endsWith('.slt') || (item.fileType && item.fileType.toLowerCase().includes('stl'));
    if (isSTL && item.filePath){
      const btn3d = document.createElement('button');
      btn3d.className = 'action view3d';
      btn3d.title = '3D';
      btn3d.addEventListener('click', async (e) => { e.stopPropagation(); try{ const url = await getDownloadURL(ref(storage, item.filePath)); closeViewer(); openViewer3D(url); } catch(_){} });
      right.appendChild(btn3d);
    }
    const dl = document.createElement('button');
    dl.className = 'action download';
    dl.title = 'Baixar';
    dl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-16a2 2 0 0 0-2 2v6H8l4 4 4-4h-2V6a2 2 0 0 0-2-2z"/></svg>';
    dl.addEventListener('click', async (e) => { e.stopPropagation(); if (item.filePath){ try{ const url = await getDownloadURL(ref(storage, item.filePath)); window.open(url, '_blank'); } catch(_){} } });
    right.appendChild(dl);
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
  container.appendChild(list);
}

async function loadFolderFiles(folderId){
  const folderRef = ref(storage, `${STORAGE_ROOT}/${folderId}`);
  const listing = await listAll(folderRef);
  const items = [];
  const seen = new Set();
  for (const it of listing.items){
    const name = it.name;
    if (name === '__folder__.json') continue; // ignora marcador
    const lower = name.toLowerCase();
    let fileType = '';
    if (lower.endsWith('.pdf')) fileType = 'application/pdf';
    else if (lower.match(/\.(png|jpg|jpeg|gif|webp)$/)) fileType = 'image/*';
    else if (lower.endsWith('.stl') || lower.endsWith('.slt') || lower.endsWith('.obj') || lower.endsWith('.gltf') || lower.endsWith('.glb')) fileType = 'model/3d';
    const filePath = `${STORAGE_ROOT}/${folderId}/${name}`;
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue; // evita duplicidade
    seen.add(key);
    items.push({ id: `${folderId}/${name}`, type: 'file', name, fileType, filePath });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  // Atualiza cache da pasta
  folderFilesCache.set(folderId, { time: Date.now(), items: items.slice() });
  return items;
}

function renderBreadcrumbs() {
  breadcrumbsEl.innerHTML = "";
  folderPath.forEach((f, idx) => {
    const a = document.createElement("a");
    a.textContent = idx === 0 ? "🏠 Início" : f.name;
    a.addEventListener("click", () => {
      folderPath = folderPath.slice(0, idx + 1);
      currentFolder = folderPath[folderPath.length - 1].id;
      renderBreadcrumbs();
      fetchItems();
    });
    breadcrumbsEl.appendChild(a);
    if (idx < folderPath.length - 1) {
      const sep = document.createElement("span");
      sep.textContent = " › ";
      breadcrumbsEl.appendChild(sep);
    }
  });
  updateBackButton();
}

// New folder
if (newFolderBtn){
  newFolderBtn.addEventListener("click", async () => {
    const name = prompt("Nome da pasta:");
    if (!name || !name.trim()) return;
    const id = folderIdFromName(name);
    const markerRef = ref(storage, `${STORAGE_ROOT}/${id}/__folder__.json`);
    try {
      await getMetadata(markerRef);
      alert('Já existe uma pasta com este nome.');
      return;
    } catch(_) { /* não existe, criar */ }
    await uploadString(markerRef, JSON.stringify({ name: name.trim() }), 'raw', { contentType: 'application/json' });
    fetchItems();
  });
}

// Botão Novo Projeto no appbar aciona criação de pasta
const newProjectBtn = document.getElementById('new-project-btn');
if (newProjectBtn){
  newProjectBtn.addEventListener('click', async () => {
    const name = prompt("Nome do projeto:");
    if (!name || !name.trim()) return;
    const id = folderIdFromName(name);
    const markerRef = ref(storage, `${STORAGE_ROOT}/${id}/__folder__.json`);
    try {
      await getMetadata(markerRef);
      alert('Já existe uma pasta com este nome.');
      return;
    } catch(_) { /* não existe, criar */ }
    await uploadString(markerRef, JSON.stringify({ name: name.trim() }), 'raw', { contentType: 'application/json' });
    fetchItems();
  });
}

// Upload file
fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  if (!currentFolder){ alert('Selecione/abra uma pasta para enviar arquivos.'); e.target.value = ""; return; }
  await handleFilesUpload(files);
  e.target.value = ""; // reset
});

// Delete item
async function deleteItem(item) {
  // Bloqueia exclusões sem senha de administrador válida
  if (!adminPasswordHash || !isAdminAuthorized) {
    openAdminModal(!adminPasswordHash);
    return;
  }
  if (item.type === 'folder'){
    try{
      const folderRef = ref(storage, `${STORAGE_ROOT}/${item.id}`);
      const listing = await listAll(folderRef);
      const ops = [];
      listing.items.forEach(obj => ops.push(deleteObject(obj).catch(()=>{})));
      await Promise.all(ops);
      // Não há objeto de 'pasta' a remover além dos arquivos; prefixes somem quando vazios
    } catch(err){ console.warn('Falha ao excluir pasta:', err); }
  } else {
    try{
      if (item.filePath){ await deleteObject(ref(storage, item.filePath)); }
    } catch (err){ console.warn('Falha ao excluir arquivo:', err); }
  }
  // Invalida caches afetados
  if (item.type === 'folder'){
    folderFilesCache.delete(item.id);
  } else if (item.id && typeof item.id === 'string'){
    const folderId = (item.id.split('/')[0] || '').trim();
    if (folderId) folderFilesCache.delete(folderId);
  }
  folderListCache.delete('root');
  fetchItems();
}

// Toggle de visualização
function updateSingleToggleLabel(){
  if (!viewToggleBtn) return;
  // Mostra o destino do próximo clique
  viewToggleBtn.textContent = viewMode === 'list' ? 'Cards' : 'Lista';
  viewToggleBtn.title = viewMode === 'list' ? 'Cards' : 'Lista';
}

viewToggleBtn && viewToggleBtn.addEventListener('click', () => {
  viewMode = viewMode === 'list' ? 'grid' : 'list';
  updateSingleToggleLabel();
  fetchItems();
});
updateSingleToggleLabel();

// (filtros foram modularizados em filters.js)

// Upload via FAB
fabUpload && fabUpload.addEventListener('click', () => {
  document.querySelector('#file-input')?.click();
});

// Drag & drop uploads
function showDrop(){ dropzone && show(dropzone); }
function hideDrop(){ dropzone && hide(dropzone); }
['dragenter','dragover'].forEach(evt => window.addEventListener(evt, (e) => { e.preventDefault(); showDrop(); }));
['dragleave','drop'].forEach(evt => window.addEventListener(evt, (e) => { e.preventDefault(); hideDrop(); }));
window.addEventListener('drop', async (e) => {
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  await handleFilesUpload(files);
});

// Upload para uma pasta específica (utilizado pelos botões dentro do painel)
async function handleFilesUploadTo(files, targetFolderId){
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const progressBytes = new Array(files.length).fill(0);
  show(uploadProgress);
  const updateUI = () => {
    const loaded = progressBytes.reduce((s, v) => s + v, 0);
    const pct = totalBytes ? Math.floor((loaded / totalBytes) * 100) : 0;
    uploadProgressBar.style.width = pct + "%";
    uploadProgressText.textContent = `Upload ${pct}%`;
  };
  updateUI();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `${STORAGE_ROOT}/${targetFolderId}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    await new Promise((resolve, reject) => {
      task.on('state_changed', (snap) => {
        progressBytes[i] = snap.bytesTransferred;
        updateUI();
      }, (err) => reject(err), async () => {
        // Upload concluído no Storage
        resolve();
      });
    });
  }
  // Invalida caches para refletir novos arquivos
  folderFilesCache.delete(targetFolderId);
  folderListCache.delete('root');
  fetchItems();
  hide(uploadProgress);
}

// Função comum de upload (input e drop)
async function handleFilesUpload(files){
  if (!currentFolder){ alert('Selecione/abra uma pasta para enviar arquivos.'); return; }
  return handleFilesUploadTo(files, currentFolder);
}

function updateBackButton(){
  if (!backBtn) return;
  const atRoot = folderPath.length <= 1;
  backBtn.disabled = atRoot;
  backBtn.classList.toggle('selected', !atRoot);
}

if (backBtn) backBtn.addEventListener('click', () => {
  if (folderPath.length > 1){
    folderPath = folderPath.slice(0, folderPath.length - 1);
    currentFolder = folderPath[folderPath.length - 1].id;
    renderBreadcrumbs();
    updateContextUI();
    fetchItems();
  }
});

// Atualiza visibilidade da sidebar e placeholder da busca conforme contexto
function updateContextUI(){
  const atRoot = folderPath.length <= 1;
  if (sidebarEl){
    if (atRoot){ hide(sidebarEl); } else { show(sidebarEl); }
  }
  if (searchInput){
    searchInput.placeholder = atRoot ? 'Buscar pastas...' : 'Buscar arquivos...';
  }
}

// ---- Admin helpers ----
function openAdminModal(notConfigured = false){
  adminError.hidden = true;
  adminPasswordInput.value = "";
  show(adminModal);
  if (notConfigured){
    adminError.textContent = "Senha de administrador não configurada.";
    adminError.hidden = false;
  }
}
function closeAdminModal(){ hide(adminModal); }

async function sha256Hex(str){
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
}

adminBtn.addEventListener('click', () => {
  // Toggle: se já está autorizado, bloqueia; senão, abre modal
  if (isAdminAuthorized){
    isAdminAuthorized = false;
    adminBtn.textContent = '🔒 Admin';
    fetchItems(); // Atualiza UI para esconder botões de admin
  } else {
    openAdminModal(!adminPasswordHash);
  }
});
adminCancel.addEventListener('click', () => closeAdminModal());
adminConfirm.addEventListener('click', async () => {
  adminConfirm.disabled = true;
  adminError.hidden = true;
  try {
    const pass = adminPasswordInput.value.trim();
    const cfg = (adminPasswordHash || '').trim();
    let ok = false;
    if (!cfg){
      adminError.textContent = "Senha de administrador não configurada";
      adminError.hidden = false;
    } else if (/^[0-9a-fA-F]{64}$/.test(cfg)) {
      const hex = await sha256Hex(pass);
      ok = hex === cfg.toLowerCase();
    } else {
      ok = pass === cfg; // aceitar senha em texto claro
    }
    if (ok){
      isAdminAuthorized = true;
      adminBtn.textContent = '🔓 Admin';
      closeAdminModal();
      fetchItems(); // Atualiza UI para mostrar botões de admin
    } else {
      adminError.textContent = "Senha incorreta";
      adminError.hidden = false;
    }
  } catch(err){
    console.error(err);
    adminError.textContent = "Erro ao validar senha";
    adminError.hidden = false;
  } finally {
    adminConfirm.disabled = false;
  }
});

// (viewer 3D foi modularizado em viewer3d.js)

// (helpers de preview movidos para folderPreview.js)