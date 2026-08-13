function maintainAlignment(targetId) {
  const target = state.decks[targetId];
  if (!target?.syncActive || !target.track) return;
  const masterId = target.syncMasterId;
  const master = state.decks[masterId];
  if (!master?.track) return releaseBeatLink(targetId, true);

  const now = performance.now();
  if (now - (target.lastSyncAt || 0) < 25) return;
  target.lastSyncAt = now;

  const targetBase = sourceBpm(targetId);
  const masterNow = effectiveBpm(masterId);
  if (!targetBase || !masterNow) return;
  const nominal = masterNow / targetBase;
  target.syncNominalRate = nominal;

  if (target.audio.paused || master.audio.paused) {
    target.audio.playbackRate = nominal;
    target.syncMode = 'ARM';
    target.syncStableCount = 0;
    setSyncUi(targetId, true, masterId, 'ARM');
    return;
  }

  const gridReady = (target.beatConfidence || 0) >= 3 &&
    (master.beatConfidence || 0) >= 3 &&
    (target.tempoConfidence || 0) >= 3 &&
    (master.tempoConfidence || 0) >= 3;
  if (!gridReady) {
    target.audio.playbackRate = nominal;
    target.syncMode = 'ARM';
    setSyncUi(targetId, true, masterId, 'ARM');
    return;
  }

  const error = normalizedPhaseError(targetId, masterId);
  if (error === null) return;
  const abs = Math.abs(error);
  let correction = 0;
  if (abs > .12) {
    correction = Math.max(-.24, Math.min(.24, -error * 1.15));
    target.syncMode = 'ALIGN'; target.syncStableCount = 0;
  } else if (abs > .035) {
    correction = Math.max(-.085, Math.min(.085, -error * .75));
    target.syncMode = 'ALIGN'; target.syncStableCount = 0;
  } else if (abs > .012) {
    correction = Math.max(-.026, Math.min(.026, -error * .42));
    target.syncMode = 'ALIGN'; target.syncStableCount = 0;
  } else {
    correction = Math.max(-.004, Math.min(.004, -error * .10));
    target.syncStableCount = (target.syncStableCount || 0) + 1;
    if (target.syncStableCount >= 7) target.syncMode = 'LOCK';
  }
  target.audio.playbackRate = nominal * (1 + correction);
  setSyncUi(targetId, true, masterId, target.syncMode === 'LOCK' ? 'LOCK' : 'ALIGN');
  updateBpmDisplay(targetId);
}

async function alignDeck(targetId) {
  await initAudio();
  const masterId = state.masterDeck;
  if (masterId === targetId) {
    const other = targetId === 'A' ? 'B' : 'A';
    if (!state.decks[other]?.track) return setMessage('Deck ini MASTER. Load deck lain lalu pilih SYNC pada follower.', true);
    return setMessage(`Deck ${targetId} adalah MASTER. Pilih SYNC di Deck ${other}.`, true);
  }
  const target = state.decks[targetId];
  const master = state.decks[masterId];
  if (!target?.track || !master?.track) return setMessage('Load lagu ke MASTER dan follower dulu.', true);
  if (target.syncActive) { releaseBeatLink(targetId); return; }

  const targetBase = sourceBpm(targetId);
  const masterNow = effectiveBpm(masterId);
  if (!targetBase || !masterNow) return setMessage('BPM salah satu track belum tersedia.', true);
  const rate = masterNow / targetBase;
  const pct = (rate - 1) * 100;
  if (Math.abs(pct) > 10) return setMessage(`Beda tempo terlalu jauh (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%).`, true);

  target.syncActive = true;
  target.syncMasterId = masterId;
  target.syncNominalRate = rate;
  target.syncStableCount = 0;
  target.audio.playbackRate = rate;
  $(`pitch${targetId}`).value = Math.max(-8, Math.min(8, pct)).toFixed(1);
  $(`pitchLabel${targetId}`).textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  updateBpmDisplay(targetId);

  if (!target.audio.paused && !master.audio.paused) {
    startBeatAlignment(targetId);
    maintainAlignment(targetId);
    setMessage(`Deck ${targetId} sedang menyelaraskan beat ke MASTER ${masterId}.`);
  } else {
    target.syncMode = 'ARM';
    setSyncUi(targetId, true, masterId, 'ARM');
    setMessage(`Deck ${targetId} armed. PLAY kapan pun → otomatis menyelaraskan ke MASTER ${masterId}.`);
  }
}

function nudgeDeck(id, direction) {
  const d = state.decks[id];
  const bpm = sourceBpm(id);
  if (!d?.track || !bpm) return setMessage(`Deck ${id} belum punya BPM untuk NUDGE.`, true);
  const step = (60 / bpm) * .08 * Number(direction);
  d.audio.currentTime = Math.max(0, d.audio.currentTime + step);
  setMessage(`Deck ${id} nudge ${direction < 0 ? '◀' : '▶'} ${(Math.abs(step) * 1000).toFixed(0)} ms.`);
}
