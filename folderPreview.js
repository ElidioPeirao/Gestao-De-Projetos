// Helpers de preview de pasta e miniatura de PDF
// Mantidos separados para reduzir o tamanho de app.js

export async function renderPdfThumb(url, container){
  try{
    const pdfjsLib = await import('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.mjs';
    const loadingTask = pdfjsLib.getDocument({ url });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.borderRadius = '12px';
    const targetW = 180, targetH = 160;
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(targetW / viewport.width, targetH / viewport.height);
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    container.innerHTML = '';
    container.appendChild(canvas);
  }catch(err){
    console.warn('Falha ao gerar miniatura de PDF', err);
    throw err;
  }
}

// Preview baseado no Storage
import { ref, listAll, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { storage } from "./firebase-init.js";

export async function populateFolderPreview(_db, folderItem, container){
  try{
    const folderRef = ref(storage, `projects/${folderItem.id}`);
    // Primeiro tenta ler marcador __folder__.json para capa específica
    try{
      const markerUrl = await getDownloadURL(ref(storage, `projects/${folderItem.id}/__folder__.json`));
      const meta = await fetch(markerUrl).then(r => r.json()).catch(() => null);
      const coverPath = meta && meta.cover;
      if (coverPath){
        const url = await getDownloadURL(ref(storage, coverPath));
        const el = document.createElement('img');
        el.style.maxWidth = '100%';
        el.style.maxHeight = '100%';
        el.alt = folderItem.name;
        el.src = url;
        container.innerHTML = '';
        container.appendChild(el);
        return;
      }
    } catch(_) { /* sem marcador ou sem capa, continua */ }
    const listing = await listAll(folderRef);
    // Primeiro tenta imagem
    for (const obj of listing.items){
      const name = obj.name.toLowerCase();
      if (name === '__folder__.json') continue;
      if (name.match(/\.(png|jpg|jpeg|gif|webp)$/)){
        const url = await getDownloadURL(obj);
        const el = document.createElement('img');
        el.style.maxWidth = '100%';
        el.style.maxHeight = '100%';
        el.alt = folderItem.name;
        el.src = url;
        container.innerHTML = '';
        container.appendChild(el);
        return;
      }
    }
    // Senão tenta PDF
    for (const obj of listing.items){
      const name = obj.name.toLowerCase();
      if (name.endsWith('.pdf')){
        const url = await getDownloadURL(obj);
        await renderPdfThumb(url, container);
        return;
      }
    }
  }catch(err){ console.warn('Preview de pasta indisponível', err); }
}