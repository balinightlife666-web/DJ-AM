function setMasterDeck(id, quiet=false) {
  if (!state.decks[id]?.track && state.audioReady) {
    if (!quiet) setMessage(`Load lagu ke Deck ${id} dulu untuk MASTER.`, true);
    return;
  }
  state.masterDeck = id;
  document.querySelectorAll('[data-action="master"]').forEach(b => b.classList.toggle('active', b.dataset.deck === id));
  const other = id === 'A' ? 'B' : 'A';
  if (state.decks[other]?.syncActive) {
    state.decks[other].syncMasterId = id;
    beginBeatChase(other);
  }
  if (state.decks[id]?.syncActive) disableSync(id, true);
  if (!quiet) setMessage(`Deck ${id} = MASTER CLOCK.`);
}
