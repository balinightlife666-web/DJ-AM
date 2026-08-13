(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const decks = {
    A: { bpm: NaN, confidence: 0, anchor: NaN, beatConfidence: 0, onsets: [], prev: null, fluxAvg: 0, energyAvg: 0, lastOnset: -99 },
    B: { bpm: NaN, confidence: 0, anchor: NaN, beatConfidence: 0, onsets: [], prev: null, fluxAvg: 0, energyAvg: 0, lastOnset: -99 }
  };

  function normalizeTempo(value) {
    let bpm = Number(value);
    if (!Number.isFinite(bpm) || bpm <= 0) return null;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return bpm;
  }

  function metaBpm(id) {
    const text = byId(`bpm${id}`)?.textContent || '';
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
    return normalizeTempo(match ? Number(match[1]) : NaN);
  }

  function sourceBpm(id) {
    const d = decks[id];
    return d.confidence >= 3 && Number.isFinite(d.bpm) ? d.bpm : metaBpm(id);
  }

  function estimateTempo(d) {
    const times = d.onsets;
    if (times.length < 6) return;
    const hist = new Map();
    const from = Math.max(0, times.length - 28);
    for (let i = from + 1; i < times.length; i++) {
      for (let j = Math.max(from, i - 8); j < i; j++) {
        const dt = times[i] - times[j];
        if (dt < .24 || dt > 2.4) continue;
        const bpm = normalizeTempo(60 / dt);
        if (!bpm) continue;
        const key = Math.round(bpm * 2) / 2;
        hist.set(key, (hist.get(key) || 0) + 1 / Math.sqrt(i - j));
      }
    }
    if (!hist.size) return;
    const ranked = [...hist.entries()].sort((a,b) => b[1] - a[1]);
    const [peak, score] = ranked[0];
    const second = ranked[1]?.[1] || score * .55;
    d.bpm = Number.isFinite(d.bpm) ? d.bpm * .82 + peak * .18 : peak;
    d.confidence = Math.min(10, d.confidence + (score / Math.max(.001, second) > 1.15 ? 1 : .35));
  }

  function attachAnalysers() {
    const list = window.__accDjAnalysers || [];
    if (!decks.A.analyser && list[0]) { decks.A.analyser = list[0].node; decks.A.context = list[0].context; }
    if (!decks.B.analyser && list[1]) { decks.B.analyser = list[1].node; decks.B.context = list[1].context; }
  }

  function analyze(id) {
    attachAnalysers();
    const d = decks[id];
    const audio = byId(`audio${id}`);
    if (!d.analyser || !audio || audio.paused) return;
    const data = new Uint8Array(d.analyser.frequencyBinCount);
    d.analyser.getByteFrequencyData(data);
    if (!d.prev || d.prev.length !== data.length) d.prev = new Uint8Array(data.length);
    const binHz = d.context.sampleRate / d.analyser.fftSize;
    const lo = Math.max(1, Math.floor(42 / binHz));
    const hi = Math.min(data.length - 1, Math.ceil(230 / binHz));
    let flux = 0, energy = 0, bins = 0;
    for (let i = lo; i <= hi; i++) {
      flux += Math.max(0, data[i] - (d.prev[i] || 0));
      energy += data[i];
      d.prev[i] = data[i];
      bins++;
    }
    flux /= Math.max(1, bins);
    energy /= Math.max(1, bins);
    d.fluxAvg = d.fluxAvg ? d.fluxAvg * .965 + flux * .035 : flux;
    d.energyAvg = d.energyAvg ? d.energyAvg * .97 + energy * .03 : energy;
    const now = audio.currentTime;
    const bpm = sourceBpm(id) || 120;
    const beat = 60 / bpm;
    const threshold = Math.max(3.2, d.fluxAvg * 1.85);
    const enough = energy > Math.max(22, d.energyAvg * .78);
    if (flux < threshold || !enough || now - d.lastOnset < Math.max(.20, beat * .34)) return;
    d.lastOnset = now;
    d.onsets.push(now);
    if (d.onsets.length > 40) d.onsets.shift();
    estimateTempo(d);
    const realBeat = 60 / (sourceBpm(id) || bpm);
    if (!Number.isFinite(d.anchor)) { d.anchor = now; d.beatConfidence = 1; }
    else {
      const n = Math.round((now - d.anchor) / realBeat);
      const error = now - (d.anchor + n * realBeat);
      if (Math.abs(error) <= realBeat * .20) {
        d.anchor += error * (d.beatConfidence >= 6 ? .055 : .16);
        d.beatConfidence = Math.min(12, d.beatConfidence + 1);
      }
    }
    if (d.confidence >= 3 && Number.isFinite(d.bpm)) {
      const bpmEl = byId(`bpm${id}`);
      if (bpmEl) bpmEl.textContent = `BPM ${d.bpm.toFixed(1)} AUTO`;
      const grid = byId(`grid${id}`);
      if (grid && d.beatConfidence >= 4) { grid.textContent = 'GRID ✓'; grid.classList.add('grid-ready'); }
    }
  }

  function loop() {
    analyze('A');
    analyze('B');
    requestAnimationFrame(loop);
  }

  window.ACCDJ9 = { decks, sourceBpm };
  requestAnimationFrame(loop);
})();
