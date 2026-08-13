function releaseBeatLink(id, quiet=false) {
  const d = state.decks[id];
  if (!d) return;
  d.syncActive = false;
  d.syncMasterId = null;
  d.syncMode = 'FREE';
  d.syncStableCount = 0;
  d.syncNominalRate = 1;
  d.lastSyncAt = 0;
  setSyncUi(id, false);
  updateBpmDisplay(id);
  if (!quiet && d.track) setMessage(`Deck ${id} link dilepas.`);
}
function disableSync(id, quiet=false) { return releaseBeatLink(id, quiet); }
