// Toggle de visualização (grid/list)

export function initViewToggle(btns, onModeChange){
  if (!btns || typeof onModeChange !== 'function') return;
  const { viewListBtn, viewGridBtn } = btns;
  viewListBtn && viewListBtn.addEventListener('click', () => onModeChange('list'));
  viewGridBtn && viewGridBtn.addEventListener('click', () => onModeChange('grid'));
}

export function updateViewToggle(btns, mode){
  if (!btns) return;
  const { viewListBtn, viewGridBtn } = btns;
  viewListBtn && viewListBtn.classList.toggle('selected', mode === 'list');
  viewGridBtn && viewGridBtn.classList.toggle('selected', mode === 'grid');
}