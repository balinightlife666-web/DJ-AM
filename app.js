(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const APP_NAME = 'ACC_DJ_PWA';
  const PUBLIC_API = 'https://discoveryprovider.audius.co/v1';

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
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (!state.musicLoaded) {
      state.musicLoaded = true;
      searchTracks('', true);
    }
  }

  function closeMusic() {
    const drawer = $('musicDrawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
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

  async function syncDeck(targetId) {
    await initAudio();
    const masterId = targetId === 'A' ? 'B' : 'A';
    const target = state.decks[targetId];
    const master = state.decks[masterId];
    if (!target?.track || !master?.track) {
      return setMessage(`Load lagu ke Deck A dan B dulu untuk SYNC.`, true);
    }
    const targetBase = Number(target.track.bpm);
    const masterNow = effectiveBpm(masterId);
    if (!targetBase || !masterNow) {
      return setMessage(`BPM metadata salah satu track tidak tersedia. Pilih track lain untuk SYNC.`, true);
    }
    const rate = masterNow / targetBase;
    const percent = (rate - 1) * 100;
    if (Math.abs(percent) > 8) {
      return setMessage(`Beda tempo terlalu jauh (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%). SYNC v2 dibatasi ±8%.`, true);
    }
    target.audio.playbackRate = rate;
    $(`pitch${targetId}`).value = percent.toFixed(1);
    $(`pitchLabel${targetId}`).textContent = `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
    updateBpmDisplay(targetId);
    const btn = document.querySelector(`[data-action="sync"][data-deck="${targetId}"]`);
    btn.classList.add('synced');
    setMessage(`Deck ${targetId} tempo sync → Deck ${masterId} (${masterNow.toFixed(1)} BPM).`);
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

  async function searchTracks(query, trending = false) {
    const genre = $('genreSelect').value;
    setMessage('Mengambil track dari Audius…');
    $('results').innerHTML = '';

    try {
      let tracks = [];
      if (state.sdk) {
        const response = trending
          ? await state.sdk.tracks.getTrendingTracks({ limit: 16, ...(genre ? { genre } : {}) })
          : await state.sdk.tracks.searchTracks({ query, limit: 16, sortMethod: 'relevant', ...(genre ? { genre: [genre] } : {}) });
        tracks = response?.data || [];
      } else {
        const params = new URLSearchParams({ app_name: APP_NAME, limit: '16' });
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

      tracks = tracks.filter(t => t && t.id && t.isStreamable !== false && t.is_streamable !== false);
      renderResults(tracks);
      setMessage(tracks.length ? `${tracks.length} track ditemukan.` : 'Tidak ada track yang cocok.');
    } catch (err) {
      console.error(err);
      setMessage('Gagal terhubung ke Audius. Buka tombol API dan masukkan Audius API key gratis.', true);
    }
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
    };
  }

  function renderResults(tracks) {
    const root = $('results');
    root.innerHTML = '';
    tracks.map(normalizeTrack).forEach(track => {
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
    deck.audio.playbackRate = 1;
    $(`pitch${id}`).value = 0;
    $(`pitchLabel${id}`).textContent = '0.0%';
    deck.track = track;

    // Audius track stream endpoint. Browser follows the audio redirect.
    deck.audio.src = `${PUBLIC_API}/tracks/${encodeURIComponent(track.id)}/stream?app_name=${encodeURIComponent(APP_NAME)}`;
    deck.audio.load();

    $(`title${id}`).textContent = track.title;
    $(`artist${id}`).textContent = track.artist;
    $(`cover${id}`).src = track.artwork || 'icons/placeholder.svg';
    updateBpmDisplay(id);
    $(`key${id}`).textContent = `KEY ${track.key || '—'}`;
    $(`duration${id}`).textContent = formatTime(track.duration);
    $(`seek${id}`).value = 0;
    $(`time${id}`).textContent = '00:00';
    document.querySelector(`[data-action="sync"][data-deck="${id}"]`)?.classList.remove('synced');
    setMessage(`${track.title} → Deck ${id} loaded.`);
  }

  async function togglePlay(id) {
    await initAudio();
    const deck = state.decks[id];
    if (!deck.track) return setMessage(`Load track ke Deck ${id} dulu.`, true);
    const btn = document.querySelector(`[data-action="play"][data-deck="${id}"]`);
    if (deck.audio.paused) {
      try {
        await deck.audio.play();
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
        grad.addColorStop(0, id === 'A' ? '#22d3ee' : '#a78bfa');
        grad.addColorStop(1, '#334155');
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

  function bindUi() {
    $('apiKeyInput').value = state.apiKey;
    initSdk();

    $('musicBtn').addEventListener('click', openMusic);
    $('closeMusicBtn').addEventListener('click', closeMusic);
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

    document.querySelectorAll('[data-action="play"]').forEach(b => b.addEventListener('click', () => togglePlay(b.dataset.deck)));
    document.querySelectorAll('[data-action="sync"]').forEach(b => b.addEventListener('click', () => syncDeck(b.dataset.deck)));
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
        if (state.decks[id]?.track) setMessage(`Stream Deck ${id} error. Coba track lain.`, true);
      });
    });

    $('crossfader').addEventListener('input', updateCrossfader);
    $('masterVol').addEventListener('input', async e => {
      await initAudio(); state.masterGain.gain.setTargetAtTime(Number(e.target.value), state.ctx.currentTime, .01);
    });
    $('splitCueBtn').addEventListener('click', async () => { await initAudio(); setSplitCue(!state.splitCue); });

    // First gesture prepares audio on mobile.
    document.addEventListener('pointerdown', () => {
      if (state.ctx?.state === 'suspended') state.ctx.resume().catch(()=>{});
    }, { passive:true });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  }
  bindUi();
})();
