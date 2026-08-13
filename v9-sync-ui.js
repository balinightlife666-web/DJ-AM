function setSyncUi(id, active, masterId=null, mode='LOCK') {
  const btn = document.querySelector(`[data-action="sync"][data-deck="${id}"]`);
  const label = $(`syncState${id}`);
  if (btn) {
    btn.classList.toggle('synced', active);
    btn.textContent = active ? 'SYNC ✓' : 'SYNC';
  }
  const deckEl = document.querySelector(`.deck[data-deck="${id}"]`);
  if (deckEl) deckEl.classList.toggle('sync-follow', active);
  if (label) {
    label.className = 'sync-state';
    if (active) label.classList.add(mode === 'LOCK' ? 'locked' : mode === 'CHASE' ? 'chasing' : 'armed');
    label.textContent = active ? `${mode} ${masterId}` : (state.masterDeck === id ? 'MASTER' : 'FREE');
  }
}
