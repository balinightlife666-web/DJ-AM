function initSdk() {
  if (!state.apiKey || typeof window.audiusSdk !== 'function') { state.sdk = null; return; }
  try { state.sdk = window.audiusSdk({ apiKey: state.apiKey }); }
  catch (err) { console.warn('Audius SDK init failed', err); state.sdk = null; }
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
  ['A','B'].forEach(createDeckGraph);
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
  low.type='lowshelf'; low.frequency.value=250;
  mid.type='peaking'; mid.frequency.value=1200; mid.Q.value=.8;
  high.type='highshelf'; high.frequency.value=5000;
  cueGain.gain.value=0;
  analyser.fftSize=2048;
  analyser.smoothingTimeConstant=.18;
  source.connect(low).connect(mid).connect(high).connect(postEq);
  postEq.connect(crossGain).connect(state.masterBus);
  postEq.connect(cueGain).connect(state.cueBus);
  postEq.connect(analyser);
  state.decks[id] = {
    audio, source, low, mid, high, postEq, crossGain, cueGain, analyser,
    cue:false, loop:false, track:null,
    syncActive:false, syncMasterId:null, syncNominalRate:1, syncMode:'FREE', syncStableCount:0, lastSyncAt:0,
    beatAnchor:NaN, beatConfidence:0, detectedBpm:NaN, tempoConfidence:0,
    onsetTimes:[], prevSpectrum:null, fluxAvg:0, energyAvg:0, lastOnsetMedia:-99, lastAnchorResetMedia:0
  };
}

function updateCrossfader() {
  if (!state.audioReady) return;
  const x = Number($('crossfader').value);
  state.crossfader = x;
  const t = (x + 1) * Math.PI / 4;
  state.decks.A.crossGain.gain.setTargetAtTime(Math.cos(t), state.ctx.currentTime, .01);
  state.decks.B.crossGain.gain.setTargetAtTime(Math.sin(t), state.ctx.currentTime, .01);
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
    state.masterGain.connect(state.merger,0,0);
    state.cueBus.connect(state.merger,0,1);
    state.merger.connect(state.ctx.destination);
    btn.textContent='SPLIT CUE: ON'; btn.classList.add('active');
    $('cueHelp').textContent='LEFT = master mono • RIGHT = cue mono';
  } else {
    state.masterGain.connect(state.normalOut);
    state.normalOut.connect(state.ctx.destination);
    btn.textContent='SPLIT CUE: OFF'; btn.classList.remove('active');
    $('cueHelp').textContent='Normal: master stereo.';
  }
}
