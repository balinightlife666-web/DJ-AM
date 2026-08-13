(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const links = { A: false, B: false };
  const stable = { A: 0, B: 0 };
  let master = 'A';

  function setStatus(id, mode) {
    const button = document.querySelector(`[data-action="sync"][data-deck="${id}"]`);
    const label = byId(`syncState${id}`);
    if (button) {
      button.classList.toggle('synced', links[id]);
      button.textContent = links[id] ? 'SYNC ✓' : 'SYNC';
    }
    if (label) {
      label.className = 'sync-state';
      if (mode === 'LOCK') label.classList.add('locked');
      else if (mode === 'ALIGN') label.classList.add('chasing');
      else if (mode === 'ARM') label.classList.add('armed');
      label.textContent = links[id] ? `${mode} ${master}` : (id === master ? 'MASTER' : 'FREE');
    }
  }

  function phase(id) {
    const engine = window.ACCDJ9;
    const d = engine?.decks?.[id];
    const audio = byId(`audio${id}`);
    const bpm = engine?.sourceBpm?.(id);
    if (!d || !audio || !bpm || !Number.isFinite(d.anchor)) return null;
    const beat = 60 / bpm;
    return ((((audio.currentTime - d.anchor) / beat) % 1) + 1) % 1;
  }

  function phaseError(follower, leader) {
    const a = phase(follower), b = phase(leader);
    if (a === null || b === null) return null;
    let error = a - b;
    if (error > .5) error -= 1;
    if (error < -.5) error += 1;
    return error;
  }

  function alignOne(id) {
    if (!links[id] || id === master) return;
    const engine = window.ACCDJ9;
    const follower = byId(`audio${id}`);
    const leader = byId(`audio${master}`);
    if (!engine || !follower || !leader) return;
    const followerBpm = engine.sourceBpm(id);
    const leaderBpm = engine.sourceBpm(master);
    if (!followerBpm || !leaderBpm) { setStatus(id, 'ARM'); return; }

    const nominal = (leaderBpm * (leader.playbackRate || 1)) / followerBpm;
    const pct = (nominal - 1) * 100;
    if (Math.abs(pct) > 10) { setStatus(id, 'ARM'); return; }
    if (follower.paused || leader.paused) {
      follower.playbackRate = nominal;
      stable[id] = 0;
      setStatus(id, 'ARM');
      return;
    }

    const fd = engine.decks[id], md = engine.decks[master];
    const ready = fd.confidence >= 3 && md.confidence >= 3 && fd.beatConfidence >= 3 && md.beatConfidence >= 3;
    if (!ready) {
      follower.playbackRate = nominal;
      stable[id] = 0;
      setStatus(id, 'ARM');
      return;
    }

    const error = phaseError(id, master);
    if (error === null) return;
    const abs = Math.abs(error);
    let correction = 0;
    let mode = 'ALIGN';
    if (abs > .12) { correction = Math.max(-.24, Math.min(.24, -error * 1.15)); stable[id] = 0; }
    else if (abs > .035) { correction = Math.max(-.085, Math.min(.085, -error * .75)); stable[id] = 0; }
    else if (abs > .012) { correction = Math.max(-.026, Math.min(.026, -error * .42)); stable[id] = 0; }
    else {
      correction = Math.max(-.004, Math.min(.004, -error * .10));
      stable[id]++;
      if (stable[id] >= 7) mode = 'LOCK';
    }
    follower.playbackRate = nominal * (1 + correction);
    const label = byId(`pitchLabel${id}`);
    if (label) label.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    setStatus(id, mode);
  }

  function setMaster(id) {
    master = id;
    links[id] = false;
    setStatus('A', links.A ? 'ARM' : 'FREE');
    setStatus('B', links.B ? 'ARM' : 'FREE');
  }

  function toggleLink(id, event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (id === master) {
      const other = id === 'A' ? 'B' : 'A';
      setStatus(id, 'FREE');
      const label = byId(`syncState${id}`);
      if (label) label.textContent = 'MASTER';
      return;
    }
    links[id] = !links[id];
    stable[id] = 0;
    setStatus(id, links[id] ? 'ARM' : 'FREE');
  }

  document.addEventListener('click', (event) => {
    const masterButton = event.target.closest?.('[data-action="master"]');
    if (masterButton) setMaster(masterButton.dataset.deck);
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-action="sync"]');
    if (button) toggleLink(button.dataset.deck, event);
  }, true);

  function loop() {
    alignOne('A');
    alignOne('B');
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.ACCDJ9BeatLink = { setMaster, toggleLink, links };
})();
