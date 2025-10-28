// Filtros e busca

export function initSearch(searchInput, onSearchChange){
  if (!searchInput || typeof onSearchChange !== 'function') return;
  const update = () => onSearchChange((searchInput.value || '').trim());
  searchInput.addEventListener('input', update);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){ searchInput.value = ''; update(); }
  });
}

export function updateFilterHighlight(btns, type){
  if (!btns) return;
  const { filterAll, filterFolders, filterImages, filterPdfs, filterModels } = btns;
  [filterAll, filterFolders, filterImages, filterPdfs, filterModels].forEach(b => b && b.classList.remove('selected'));
  const map = { all: filterAll, folders: filterFolders, images: filterImages, pdfs: filterPdfs, models: filterModels };
  if (map[type]) map[type].classList.add('selected');
}

export function initFilters(btns, onFilterChange){
  if (!btns || typeof onFilterChange !== 'function') return;
  const { filterAll, filterFolders, filterImages, filterPdfs, filterModels } = btns;
  filterAll && filterAll.addEventListener('click', () => onFilterChange('all'));
  filterFolders && filterFolders.addEventListener('click', () => onFilterChange('folders'));
  filterImages && filterImages.addEventListener('click', () => onFilterChange('images'));
  filterPdfs && filterPdfs.addEventListener('click', () => onFilterChange('pdfs'));
  filterModels && filterModels.addEventListener('click', () => onFilterChange('models'));
}