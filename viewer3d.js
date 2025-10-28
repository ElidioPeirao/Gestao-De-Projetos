// Módulo do viewer 3D (STL)
export function setupViewer3D({ viewerModal, viewerClose, viewerCanvas, viewerCenter }){
  function show(el){ el.hidden = false; el.style.display = ''; }
  function hide(el){ el.hidden = true; el.style.display = 'none'; }

  let _viewerCleanup = null;
  let _modelMesh = null;
  let _autoRotate = true;
  let _cleanupListeners = [];

  async function openViewer3D(fileUrl){
    // Se já existe um viewer aberto, feche/limpe antes de abrir o próximo
    if (_viewerCleanup) {
      try { _viewerCleanup(); } catch(_) {}
      _viewerCleanup = null;
    }
    _modelMesh = null;
    _autoRotate = true;
    _cleanupListeners = [];
    show(viewerModal);
    viewerCanvas.innerHTML = "";
    const THREE = await import('https://unpkg.com/three@0.157.0/build/three.module.js');
    const { STLLoader } = await import('https://unpkg.com/three@0.157.0/examples/jsm/loaders/STLLoader.js');
    const { OrbitControls } = await import('https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x111111, 1);
    viewerCanvas.appendChild(renderer.domElement);
    const loadingEl = document.createElement('div');
    loadingEl.className = 'viewer-loading';
    loadingEl.textContent = 'Carregando modelo 3D...';
    viewerCanvas.appendChild(loadingEl);
    let width = viewerCanvas.clientWidth;
    let height = viewerCanvas.clientHeight;
    if (!width || !height){ width = 640; height = 420; }
    renderer.setSize(width, height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width/height, 0.1, 1000);
    camera.position.set(0, 0, 120);

    const light1 = new THREE.DirectionalLight(0xffffff, 1);
    light1.position.set(1,1,1);
    scene.add(light1);
    const light2 = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(light2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const loader = new STLLoader();
    loader.load(fileUrl, (geometry) => {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const size = bb.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 80 / maxDim;
      const material = new THREE.MeshStandardMaterial({ color: 0xffa000, metalness: 0.1, roughness: 0.9 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(scale, scale, scale);
      geometry.center();
      scene.add(mesh);
      _modelMesh = mesh;
      geometry.computeBoundingSphere();
      const r = (geometry.boundingSphere?.radius || maxDim/2) * scale;
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, Math.max(r * 2.5, 120));
      camera.lookAt(0,0,0);
      controls.update();

      // Parar rotação automática ao interagir
      const stopAuto = () => { _autoRotate = false; };
      controls.addEventListener('start', stopAuto);
      renderer.domElement.addEventListener('pointerdown', stopAuto);
      renderer.domElement.addEventListener('wheel', stopAuto, { passive: true });
      renderer.domElement.addEventListener('touchstart', stopAuto, { passive: true });
      _cleanupListeners.push(() => controls.removeEventListener('start', stopAuto));
      _cleanupListeners.push(() => renderer.domElement.removeEventListener('pointerdown', stopAuto));
      _cleanupListeners.push(() => renderer.domElement.removeEventListener('wheel', stopAuto));
      _cleanupListeners.push(() => renderer.domElement.removeEventListener('touchstart', stopAuto));

      // Botão Centralizar
      if (viewerCenter){
        const onCenter = () => {
          try{
            if (!_modelMesh) return;
            const g = _modelMesh.geometry;
            g.computeBoundingSphere();
            const rr = (g.boundingSphere?.radius || 40) * _modelMesh.scale.x;
            _modelMesh.rotation.set(0,0,0);
            _modelMesh.position.set(0,0,0);
            controls.target.set(0,0,0);
            camera.position.set(0, 0, Math.max(rr * 2.5, 120));
            camera.lookAt(0,0,0);
            controls.update();
            _autoRotate = true;
          }catch(e){ console.warn('Falha ao centralizar', e); }
        };
        viewerCenter.addEventListener('click', onCenter);
        _cleanupListeners.push(() => viewerCenter.removeEventListener('click', onCenter));
      }
      if (loadingEl) loadingEl.remove();
    }, undefined, (err) => {
      console.error('Falha ao carregar STL', err);
      if (loadingEl){
        loadingEl.textContent = 'Não foi possível carregar o modelo 3D.';
        loadingEl.style.background = 'rgba(0,0,0,.5)';
        loadingEl.style.color = '#ff6b00';
      }
    });

    let rafId;
    function animate(){
      rafId = requestAnimationFrame(animate);
      if (_modelMesh && _autoRotate){ _modelMesh.rotation.y += 0.005; }
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function onResize(){
      const w = viewerCanvas.clientWidth;
      const h = viewerCanvas.clientHeight;
      camera.aspect = w/h;
      camera.updateProjectionMatrix();
      renderer.setSize(w,h);
    }
    window.addEventListener('resize', onResize);

    _viewerCleanup = () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      // Remover listeners adicionados
      _cleanupListeners.forEach(fn => { try{ fn(); }catch(_){} });
      _cleanupListeners = [];
      renderer.dispose();
      viewerCanvas.innerHTML = "";
      _modelMesh = null;
      _autoRotate = false;
    };
  }

  function closeViewer(){
    if (_viewerCleanup) _viewerCleanup();
    hide(viewerModal);
  }
  viewerClose.addEventListener('click', closeViewer);

  return { openViewer3D, closeViewer };
}