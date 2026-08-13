function startBeatAlignment(targetId) {
  const d = state.decks[targetId];
  if (!d?.syncActive) return;
  d.syncMode = 'ALIGN';
  d.syncStableCount = 0;
  d.lastSyncAt = 0;
  d.chaseStartedAt = performance.now();
  setSyncUi(targetId, true, d.syncMasterId, 'ALIGN');
}
