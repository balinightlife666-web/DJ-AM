(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const APP_NAME = 'ACC_DJ_PWA';
  const PUBLIC_API = 'https://api.audius.co/v1';
  const LEGACY_PUBLIC_API = 'https://discoveryprovider.audius.co/v1';

  const state = {
    sdk: null,
    apiKey: localStorage.getItem('accdj_audius_api_key') || '',
    ctx: null,
    splitCue: false,
    crossfader: 0,
    decks: {},
    merger: null,
    masterBus: null,
    cueBus: null,
    masterGain: null,
    normalOut: null,
    audioReady: false,
    musicLoaded: false,
    lastQuery: '',
    lastTrending: true,
    searchOffset: 0,
    pageSize: 28,
    renderedTrackIds: new Set(),
    deferredInstallPrompt: null,
    focusMode: false,
  };

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function setMessage(text, error = false) {
    const el = $('libraryMessage');
    el.textContent = text;
    el.style.color = error ? '#fb7185' : '';
  }

  function openMusic() {
    const drawer = $('musicDrawer');
    const backdrop = $('drawerBackdrop');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.hidden = false;
    if (!state.musicLoaded) {
      state.musicLoaded = true;
      searchTracks('', true);
    }
  }

  function closeMusic() {
    const drawer = $('musicDrawer');
    const backdrop = $('drawerBackdrop');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.hidden = true;
  }

  function effectiveBpm(id) {
    const d = state.decks[id];
    const bpm = Number(d?.track?.bpm);
    if (!bpm || !Number.isFinite(bpm)) return null;
    return bpm * (Number(d.audio.playbackRate) || 1);
  }

  function updateBpmDisplay(id) {
    const d = state.decks[id];
    const base = Number(d?.track?.bpm);
    if (!base || !Number.isFinite(base)) {
      $(`bpm${id}`).textContent = 'BPM —';
      return;
    }
    const eff = effectiveBpm(id);
    const changed = Math.abs((d.audio.playbackRate || 1) - 1) > 0.0005;
    $(`bpm${id}`).textContent = changed ? `BPM ${eff.toFixed(1)}*` : `BPM ${base}`;
  }

  function normalizedPhaseError(targetId, masterId) {
    const target = state.decks[targetId];
    const master = state.decks[masterId];
    const targetBpm = Number(target?.track?.bpm);
    const masterBpm = Number(master?.track?.bpm);
    if (!targetBpm || !masterBpm) return null;
    const targetBeat = 60 / targetBpm;
    const masterBeat = 60 / masterBpm;
    const targetPhase = ((target.audio.currentTime / targetBeat) % 1 + 1) % 1;
    const masterPhase = ((master.audio.currentTime / masterBeat) % 1 + 1) % 1;
    let error = targetPhase - masterPhase;
    if (error > .5) error -= 1;
    if (error < -.5) error += 1;
    return error;
  }

  function setSyncUi(id, active, masterId = null) {
    const btn = document.querySelector(`[data-action="sync"][data-deck="${id}"]`);
    const label = $(`syncState${id}`);
    btn?.classList.toggle('synced', active);
    if (btn) btn.textContent = active ? 'SYNC ✓' : 'SYNC';
    if (label) {
      label.textContent = active ? `LOCK ${masterId}` : 'FREE';
      label.classList.toggle('locked', active);
    }
  }

  function disableSync(id, quiet = false) {
    const d = state.decks[id];
    if (!d) return;
    d.syncActive = false;
    d.syncMasterId = null;
    d.syncNominalRate = 1;
    d.lastSyncAt = 0;
    setSyncUi(id, false);
    if (!quiet && d.track) setMessage(`Deck ${id} SYNC dilepas.`);
  }

  function alignPhaseNow(targetId) {
    const target = state.decks[targetId];
    const masterId = target?.syncMasterId;
    const master = state.decks[masterId];
    if (!target?.syncActive || !master?.track || !target.track) return;
    const error = normalizedPhaseError(targetId, masterId);
    const baseBpm = Number(target.track.bpm);
    if (error === null || !baseBpm) return;
    const beatSeconds = 60 / baseBpm;
    const next = Math.max(0, target.audio.currentTime - error * beatSeconds);
    if (Number.isFinite(next)) target.audio.currentTime = next;
  }

  function maintainSync(targetId) {
    const target = state.decks[targetId];
    if (!target?.syncActive || !target.track) return;
    const masterId = target.syncMasterId;
    const master = state.decks[masterId];
    if (!master?.track) return disableSync(targetId, true);
    const now = performance.now();
    if (now - (target.lastSyncAt || 0) < 120) return;
    target.lastSyncAt = now;

    const targetBase = Number(target.track.bpm);
    const masterNow = effectiveBpm(masterId);
    if (!targetBase || !masterNow) return;
    const nominal = masterNow / targetBase;
    target.syncNominalRate = nominal;

    if (target.audio.paused || master.audio.paused) {
      target.audio.playbackRate = nominal;
      return;
    }

    const error = normalizedPhaseError(targetId, masterId);
    if (error === null) return;
    // Tiny PLL-style tempo correction: follows phase continuously without large jumps.
    const correction = Math.max(-0.009, Math.min(0.009, -error * 0.035));
    target.audio.playbackRate = nominal * (1 + correction);
    updateBpmDisplay(targetId);
  }

  async function syncDeck(targetId) {
    await initAudio();
    const masterId = targetId === 'A' ? 'B' : 'A';
    const target = state.decks[targetId];
    const master = state.decks[masterId];
    if (!target?.track || !master?.track) {
      return setMessage('Load lagu ke Deck A dan B dulu untuk SYNC.', true);
    }
    if (target.syncActive) {
      disableSync(targetId);
      return;
    }
    // Only one deck follows at a time to avoid circular sync.
    if (master.syncActive) disableSync(masterId, true);

    const targetBase = Number(target.track.bpm);
    const masterNow = effectiveBpm(masterId);
    if (!targetBase || !masterNow) {
      return setMessage('BPM metadata salah satu track tidak tersedia. Pilih track lain untuk SYNC.', true);
    }
    const rate = masterNow / targetBase;
    const percent = (rate - 1) * 100;
    if (Math.abs(percent) > 8) {
      return setMessage(`Beda tempo terlalu jauh (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%). SYNC dibatasi ±8%.`, true);
    }
    target.syncActive = true;
    target.syncMasterId = masterId;
    target.syncNominalRate = rate;
    target.lastSyncAt = 0;
    target.audio.playbackRate = rate;
    $(`pitch${targetId}`).value = percent.toFixed(1);
    $(`pitchLabel${targetId}`).textContent = `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
    alignPhaseNow(targetId);
    updateBpmDisplay(targetId);
    setSyncUi(targetId, true, masterId);
    setMessage(`Deck ${targetId} SMART SYNC → Deck ${masterId}: BPM + continuous phase lock aktif.`);
  }

  function nudgeDeck(id, direction) {
    const d = state.decks[id];
    const bpm = Number(d?.track?.bpm);
    if (!d?.track || !bpm) return setMessage(`Deck ${id} belum punya BPM untuk NUDGE.`, true);
    const step = (60 / bpm) * 0.08 * Number(direction);
    d.audio.currentTime = Math.max(0, d.audio.currentTime + step);
    setMessage(`Deck ${id} nudge ${direction < 0 ? '◀' : '▶'} ${(Math.abs(step) * 1000).toFixed(0)} ms.`);
  }


  function initSdk() {
    if (!state.apiKey || typeof window.audiusSdk !== 'function') {
      state.sdk = null;
      return;
    }
    try {
      state.sdk = window.audiusSdk({ apiKey: state.apiKey });
    } catch (err) {
      console.warn('Audius SDK init failed', err);
      state.sdk = null;
    }
  }

  async function initAudio() {
    if (state.audioReady) {
      if (state.ctx?.state === 'suspended') await state.ctx.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio API tidak didukung browser ini.');

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    state.ctx = ctx;
    state.masterBus = ctx.createGain();
    state.cueBus = ctx.createGain();
    state.masterGain = ctx.createGain();
    state.normalOut = ctx.createGain();
    state.merger = ctx.createChannelMerger(2);

    state.masterBus.connect(state.masterGain);
    state.masterGain.connect(state.normalOut);
    state.normalOut.connect(ctx.destination);

    ['A', 'B'].forEach((id) => createDeckGraph(id));
    state.masterGain.gain.value = Number($('masterVol').value);
    updateCrossfader();
    state.audioReady = true;
    $('audioStatus').textContent = `Audio ${Math.round(ctx.sampleRate / 1000)}kHz`;
    await ctx.resume();
    drawLoop();
  }

  function createDeckGraph(id) {
    const audio = $(`audio${id}`);
    const source = state.ctx.createMediaElementSource(audio);
    const low = state.ctx.createBiquadFilter();
    const mid = state.ctx.createBiquadFilter();
    const high = state.ctx.createBiquadFilter();
    const postEq = state.ctx.createGain();
    const crossGain = state.ctx.createGain();
    const cueGain = state.ctx.createGain();
    const analyser = state.ctx.createAnalyser();

    low.type = 'lowshelf'; low.frequency.value = 250;
    mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.8;
    high.type = 'highshelf'; high.frequency.value = 5000;
    cueGain.gain.value = 0;
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;

    source.connect(low).connect(mid).connect(high).connect(postEq);
    postEq.connect(crossGain).connect(state.masterBus);
    postEq.connect(cueGain).connect(state.cueBus);
    postEq.connect(analyser);

    state.decks[id] = {
      audio, source, low, mid, high, postEq, crossGain, cueGain, analyser,
      cue: false,
      loop: false,
      track: null,
      syncActive: false,
      syncMasterId: null,
      syncNominalRate: 1,
      lastSyncAt: 0,
    };
  }

  function updateCrossfader() {
    if (!state.audioReady) return;
    const x = Number($('crossfader').value); // -1..1
    state.crossfader = x;
    const t = (x + 1) * Math.PI / 4;
    state.decks.A.crossGain.gain.setTargetAtTime(Math.cos(t), state.ctx.currentTime, 0.01);
    state.decks.B.crossGain.gain.setTargetAtTime(Math.sin(t), state.ctx.currentTime, 0.01);
  }

  function setSplitCue(enabled) {
    if (!state.audioReady) return;
    state.splitCue = enabled;
    const btn = $('splitCueBtn');

    try { state.normalOut.disconnect(); } catch (_) {}
    try { state.merger.disconnect(); } catch (_) {}
    try { state.masterGain.disconnect(); } catch (_) {}
    try { state.cueBus.disconnect(); } catch (_) {}

    if (enabled) {
      // Each ChannelMerger input is mono: input 0 => L, input 1 => R.
      state.masterGain.connect(state.merger, 0, 0);
      state.cueBus.connect(state.merger, 0, 1);
      state.merger.connect(state.ctx.destination);
      btn.textContent = 'SPLIT CUE: ON';
      btn.classList.add('active');
      $('cueHelp').textContent = 'LEFT = master mono • RIGHT = cue mono';
    } else {
      state.masterGain.connect(state.normalOut);
      state.normalOut.connect(state.ctx.destination);
      btn.textContent = 'SPLIT CUE: OFF';
      btn.classList.remove('active');
      $('cueHelp').textContent = 'Normal: master stereo.';
    }
  }

  async function searchTracks(query, trending = false, append = false) {
    const genre = $('genreSelect').value;
    const offset = append ? state.searchOffset + state.pageSize : 0;
    if (!append) {
      state.lastQuery = query;
      state.lastTrending = trending;
      state.searchOffset = 0;
      state.renderedTrackIds = new Set();
      $('results').innerHTML = '';
    }
    setMessage(append ? 'Mengambil track berikutnya…' : 'Mengambil track dari Audius…');

    try {
      let tracks = [];
      if (state.sdk) {
        const response = trending
          ? await state.sdk.tracks.getTrendingTracks({ limit: state.pageSize, offset, ...(genre ? { genre } : {}) })
          : await state.sdk.tracks.searchTracks({ query, limit: state.pageSize, offset, sortMethod: 'relevant', ...(genre ? { genre: [genre] } : {}) });
        tracks = response?.data || [];
      } else {
        const params = new URLSearchParams({ app_name: APP_NAME, limit: String(state.pageSize), offset: String(offset) });
        if (genre) params.set('genre', genre);
        let url;
        if (trending) {
          url = `${PUBLIC_API}/tracks/trending?${params}`;
        } else {
          params.set('query', query);
          url = `${PUBLIC_API}/tracks/search?${params}`;
        }
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Audius HTTP ${r.status}`);
        const json = await r.json();
        tracks = json?.data || [];
      }

      state.searchOffset = offset;
      const rawCount = tracks.length;
      const beforeFilter = tracks.length;
      tracks = tracks.filter(isPlayableTrack);
      renderResults(tracks, append);
      const hidden = Math.max(0, beforeFilter - tracks.length);
      const totalShown = state.renderedTrackIds.size;
      $('moreBtn').hidden = rawCount < state.pageSize;
      if (tracks.length || append) {
        setMessage(`${totalShown} track tersedia${hidden ? ` • ${hidden} non-streamable dilewati` : ''}${state.apiKey ? ' • API key aktif' : ' • Public Mode'}.`);
      } else {
        setMessage('Tidak ada track streamable yang cocok. Coba genre/search lain.', true);
      }
    } catch (err) {
      console.error(err);
      setMessage('Gagal terhubung ke Audius. Buka API dan periksa Audius API key.', true);
    }
  }


  function boolish(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes') return true;
      if (v === 'false' || v === '0' || v === 'no') return false;
    }
    return null;
  }

  function isPlayableTrack(t) {
    if (!t || !t.id) return false;
    const streamable = boolish(t.isStreamable ?? t.is_streamable);
    if (streamable === false) return false;

    const gated = boolish(t.isStreamGated ?? t.is_stream_gated);
    if (gated === true) return false;

    const allowed = t.allowedApiKeys ?? t.allowed_api_keys;
    if (Array.isArray(allowed) && allowed.length) {
      if (!state.apiKey || !allowed.map(String).includes(String(state.apiKey))) return false;
    }
    return true;
  }

  async function getStreamUrl(track) {
    // Prefer the current official SDK URL builder so api_key is attached correctly.
    if (state.sdk && state.apiKey && typeof state.sdk.tracks?.getTrackStreamUrl === 'function') {
      return await state.sdk.tracks.getTrackStreamUrl({
        trackId: track.id,
        apiKey: state.apiKey
      });
    }

    const url = new URL(`${PUBLIC_API}/tracks/${encodeURIComponent(track.id)}/stream`);
    if (state.apiKey) url.searchParams.set('api_key', state.apiKey);
    return url.toString();
  }

  function legacyStreamUrl(track) {
    const url = new URL(`${LEGACY_PUBLIC_API}/tracks/${encodeURIComponent(track.id)}/stream`);
    url.searchParams.set('app_name', APP_NAME);
    if (state.apiKey) url.searchParams.set('api_key', state.apiKey);
    return url.toString();
  }

  function normalizeTrack(t) {
    const artwork = t.artwork || {};
    const user = t.user || {};
    return {
      id: String(t.id),
      title: t.title || 'Untitled',
      artist: user.name || user.handle || t.user?.name || 'Audius Artist',
      artwork: artwork._480x480 || artwork['480x480'] || artwork._150x150 || artwork['150x150'] || 'icons/placeholder.svg',
      genre: t.genre || '—',
      bpm: t.bpm || t.tempo || null,
      key: t.musicalKey || t.musical_key || null,
      duration: Number(t.duration) || 0,
      isStreamable: t.isStreamable ?? t.is_streamable ?? null,
      isStreamGated: t.isStreamGated ?? t.is_stream_gated ?? null,
      allowedApiKeys: t.allowedApiKeys ?? t.allowed_api_keys ?? null,
    };
  }

  function renderResults(tracks, append = false) {
    const root = $('results');
    if (!append) root.innerHTML = '';
    tracks.map(normalizeTrack).forEach(track => {
      if (state.renderedTrackIds.has(track.id)) return;
      state.renderedTrackIds.add(track.id);
      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = `
        <img src="${escapeHtml(track.artwork)}" alt="" loading="lazy" />
        <div>
          <h3 title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3>
          <p>${escapeHtml(track.artist)}</p>
          <div class="result-meta">${escapeHtml(track.genre)}${track.bpm ? ` • ${track.bpm} BPM` : ''}${track.key ? ` • ${escapeHtml(track.key)}` : ''}</div>
        </div>
        <div class="load-actions">
          <button data-load="A">LOAD A</button>
          <button data-load="B">LOAD B</button>
        </div>`;
      card.querySelector('[data-load="A"]').addEventListener('click', () => loadTrack('A', track));
      card.querySelector('[data-load="B"]').addEventListener('click', () => loadTrack('B', track));
      root.appendChild(card);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  async function loadTrack(id, track) {
    await initAudio();
    const deck = state.decks[id];
    deck.audio.pause();
    deck.audio.currentTime = 0;
    disableSync(id, true);
    deck.audio.playbackRate = 1;
    $(`pitch${id}`).value = 0;
    $(`pitchLabel${id}`).textContent = '0.0%';
    deck.track = track;

    // v3: build the stream URL through Audius' current SDK/API path.
    // This fixes the v2 bug where search used the new SDK but playback still used an old public stream URL.
    deck.streamAttempt = 0;
    deck.primaryStreamUrl = await getStreamUrl(track);
    deck.fallbackStreamUrl = legacyStreamUrl(track);
    deck.audio.src = deck.primaryStreamUrl;
    deck.audio.load();

    $(`title${id}`).textContent = track.title;
    $(`artist${id}`).textContent = track.artist;
    $(`cover${id}`).src = track.artwork || 'icons/placeholder.svg';
    updateBpmDisplay(id);
    $(`key${id}`).textContent = `KEY ${track.key || '—'}`;
    $(`duration${id}`).textContent = formatTime(track.duration);
    $(`seek${id}`).value = 0;
    $(`time${id}`).textContent = '00:00';
    setSyncUi(id, false);
    setMessage(`${track.title} → Deck ${id} loaded.`);
    closeMusic();
  }

  async function togglePlay(id) {
    await initAudio();
    const deck = state.decks[id];
    if (!deck.track) return setMessage(`Load track ke Deck ${id} dulu.`, true);
    const btn = document.querySelector(`[data-action="play"][data-deck="${id}"]`);
    if (deck.audio.paused) {
      try {
        if (deck.syncActive) {
          const master = state.decks[deck.syncMasterId];
          if (master?.track && !master.audio.paused) alignPhaseNow(id);
        }
        await deck.audio.play();
        if (deck.syncActive) alignPhaseNow(id);
        btn.textContent = 'Ⅱ';
        btn.classList.add('playing');
      } catch (err) {
        console.error(err);
        setMessage(`Playback Deck ${id} gagal. Coba track lain atau periksa koneksi/API.`, true);
      }
    } else {
      deck.audio.pause();
      btn.textContent = '▶';
      btn.classList.remove('playing');
    }
  }

  async function toggleCue(id) {
    await initAudio();
    const deck = state.decks[id];
    deck.cue = !deck.cue;
    deck.cueGain.gain.setTargetAtTime(deck.cue ? 1 : 0, state.ctx.currentTime, 0.01);
    const btn = document.querySelector(`[data-action="cue"][data-deck="${id}"]`);
    btn.classList.toggle('active', deck.cue);
    if (!state.splitCue) $('cueHelp').textContent = 'Aktifkan SPLIT CUE agar cue keluar di kanal RIGHT.';
  }

  function setEq(id, band, value) {
    if (!state.audioReady) return;
    state.decks[id][band].gain.setTargetAtTime(Number(value), state.ctx.currentTime, 0.015);
  }

  function setPitch(id, percent) {
    const deck = state.decks[id];
    if (!deck) return;
    if (deck.syncActive) disableSync(id, true);
    const p = Number(percent);
    deck.audio.playbackRate = 1 + p / 100;
    $(`pitchLabel${id}`).textContent = `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
    updateBpmDisplay(id);
    document.querySelector(`[data-action="sync"][data-deck="${id}"]`)?.classList.remove('synced');
  }

  function drawLoop() {
    if (!state.audioReady) return;
    ['A', 'B'].forEach(id => {
      const deck = state.decks[id];
      maintainSync(id);
      const analyser = deck.analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const canvas = $(`wave${id}`);
      const c = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#080c15'; c.fillRect(0,0,w,h);
      const bars = 72;
      const step = Math.max(1, Math.floor(data.length / bars));
      const barW = w / bars;
      for (let i=0; i<bars; i++) {
        const v = data[i*step] / 255;
        const bh = Math.max(2, v * h * .82);
        const grad = c.createLinearGradient(0, h-bh, 0, h);
        grad.addColorStop(0, id === 'A' ? '#ffffff' : '#bdbdbd');
        grad.addColorStop(1, '#3f3f46');
        c.fillStyle = grad;
        c.fillRect(i*barW+1, h-bh, Math.max(1,barW-2), bh);
      }
      const avg = data.reduce((a,b)=>a+b,0) / (data.length*255 || 1);
      $(`meter${id}`).value = Math.min(1, avg * 2.2);

      const audio = deck.audio;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        $(`seek${id}`).value = Math.floor((audio.currentTime / audio.duration) * 1000);
        $(`time${id}`).textContent = formatTime(audio.currentTime);
        $(`duration${id}`).textContent = formatTime(audio.duration);
      }
    });
    requestAnimationFrame(drawLoop);
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  async function toggleDjMode() {
    const btn = $('djModeBtn');
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
        try { await screen.orientation?.lock?.('landscape'); } catch (_) {}
        document.body.classList.add('focus-mode');
        state.focusMode = true;
        btn.classList.add('active');
        btn.textContent = 'EXIT';
      } else {
        await document.exitFullscreen?.();
        document.body.classList.remove('focus-mode');
        state.focusMode = false;
        btn.classList.remove('active');
        btn.textContent = 'DJ MODE';
      }
    } catch (err) {
      document.body.classList.toggle('focus-mode');
      state.focusMode = document.body.classList.contains('focus-mode');
      btn.classList.toggle('active', state.focusMode);
      btn.textContent = state.focusMode ? 'EXIT' : 'DJ MODE';
    }
  }

  async function installPwa() {
    const prompt = state.deferredInstallPrompt;
    if (prompt) {
      prompt.prompt();
      try { await prompt.userChoice; } catch (_) {}
      state.deferredInstallPrompt = null;
      $('installBtn').hidden = true;
      return;
    }
    alert('Untuk install ACC DJ: buka menu Chrome (⋮) lalu pilih “Install app” atau “Add to Home screen”. Setelah terpasang, buka dari ikon ACC DJ agar browser bar hilang.');
  }

  function bindUi() {
    $('apiKeyInput').value = state.apiKey;
    initSdk();
    $('djModeBtn').addEventListener('click', toggleDjMode);
    $('installBtn').addEventListener('click', installPwa);
    if (!isStandalone()) $('installBtn').hidden = false;

    $('musicBtn').addEventListener('click', () => {
      const drawer = $('musicDrawer');
      if (drawer.classList.contains('open')) closeMusic(); else openMusic();
    });
    $('closeMusicBtn').addEventListener('click', closeMusic);
    $('drawerBackdrop')?.addEventListener('click', closeMusic);
    document.querySelectorAll('[data-genre]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('[data-genre]').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      $('genreSelect').value = btn.dataset.genre;
      searchTracks('', true);
    }));

    $('settingsBtn').addEventListener('click', () => $('settingsDialog').showModal());
    $('saveKeyBtn').addEventListener('click', () => {
      state.apiKey = $('apiKeyInput').value.trim();
      if (state.apiKey) localStorage.setItem('accdj_audius_api_key', state.apiKey);
      else localStorage.removeItem('accdj_audius_api_key');
      initSdk();
      setMessage(state.apiKey ? 'Audius API key aktif. Reload MUSIC/Trending untuk hasil paling stabil.' : 'Public Mode aktif. Sebagian track dapat dibatasi provider.', !state.apiKey);
    });
    $('clearKeyBtn').addEventListener('click', () => {
      state.apiKey = '';
      $('apiKeyInput').value = '';
      localStorage.removeItem('accdj_audius_api_key');
      initSdk();
    });

    $('searchBtn').addEventListener('click', () => {
      const q = $('searchInput').value.trim();
      if (!q) return setMessage('Ketik judul / artist dulu.', true);
      searchTracks(q, false);
    });
    $('searchInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('searchBtn').click();
    });
    $('trendingBtn').addEventListener('click', () => searchTracks('', true));
    $('moreBtn').addEventListener('click', () => searchTracks(state.lastQuery, state.lastTrending, true));

    document.querySelectorAll('[data-action="play"]').forEach(b => b.addEventListener('click', () => togglePlay(b.dataset.deck)));
    document.querySelectorAll('[data-action="sync"]').forEach(b => b.addEventListener('click', () => syncDeck(b.dataset.deck)));
    document.querySelectorAll('[data-action="nudge"]').forEach(b => b.addEventListener('click', () => nudgeDeck(b.dataset.deck, Number(b.dataset.dir))));
    document.querySelectorAll('[data-action="cue"]').forEach(b => b.addEventListener('click', () => toggleCue(b.dataset.deck)));
    document.querySelectorAll('[data-action="restart"]').forEach(b => b.addEventListener('click', async () => {
      await initAudio(); const a = state.decks[b.dataset.deck].audio; a.currentTime = 0;
    }));
    document.querySelectorAll('[data-action="loop"]').forEach(b => b.addEventListener('click', async () => {
      await initAudio(); const d = state.decks[b.dataset.deck]; d.loop = !d.loop; d.audio.loop = d.loop; b.classList.toggle('looping', d.loop);
    }));

    ['A','B'].forEach(id => {
      ['low','mid','high'].forEach(band => $(`${band}${id}`).addEventListener('input', e => setEq(id, band, e.target.value)));
      $(`pitch${id}`).addEventListener('input', e => setPitch(id, e.target.value));
      $(`seek${id}`).addEventListener('input', e => {
        const a = state.decks[id]?.audio;
        if (a && Number.isFinite(a.duration) && a.duration > 0) a.currentTime = (Number(e.target.value)/1000) * a.duration;
      });
      $(`audio${id}`).addEventListener('ended', () => {
        const btn = document.querySelector(`[data-action="play"][data-deck="${id}"]`);
        btn.textContent = '▶'; btn.classList.remove('playing');
      });
      $(`audio${id}`).addEventListener('error', () => {
        const d = state.decks[id];
        if (!d?.track) return;
        const mediaCode = d.audio.error?.code || 0;
        // One automatic fallback for Public Mode / provider edge differences.
        if (d.streamAttempt === 0 && d.fallbackStreamUrl && d.fallbackStreamUrl !== d.audio.src) {
          d.streamAttempt = 1;
          d.audio.src = d.fallbackStreamUrl;
          d.audio.load();
          setMessage(`Deck ${id}: mencoba stream fallback…`);
          return;
        }
        setMessage(`Track ini tidak bisa di-stream ke Deck ${id} (media ${mediaCode || '?'}). Track otomatis dianggap unavailable.`, true);
      });
      $(`audio${id}`).addEventListener('canplay', () => {
        const d = state.decks[id];
        if (d?.track) setMessage(`${d.track.title} → Deck ${id} siap dimainkan${state.apiKey ? ' • API key aktif' : ''}.`);
      });
    });

    $('crossfader').addEventListener('input', updateCrossfader);
    $('masterVol').addEventListener('input', async e => {
      await initAudio(); state.masterGain.gain.setTargetAtTime(Number(e.target.value), state.ctx.currentTime, .01);
    });
    $('splitCueBtn').addEventListener('click', async () => { await initAudio(); setSplitCue(!state.splitCue); });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && state.focusMode) {
        state.focusMode = false;
        document.body.classList.remove('focus-mode');
        $('djModeBtn').classList.remove('active');
        $('djModeBtn').textContent = 'DJ MODE';
      }
    });

    // First gesture prepares audio on mobile.
    document.addEventListener('pointerdown', () => {
      if (state.ctx?.state === 'suspended') state.ctx.resume().catch(()=>{});
    }, { passive:true });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    const btn = $('installBtn');
    if (btn && !isStandalone()) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    const btn = $('installBtn');
    if (btn) btn.hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
  bindUi();
})();
