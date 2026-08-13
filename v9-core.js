'use strict';

const $ = (id) => document.getElementById(id);
const APP_NAME = 'ACC_DJ_PWA';
const PUBLIC_API = 'https://api.audius.co/v1';
const LEGACY_PUBLIC_API = 'https://discoveryprovider.audius.co/v1';

const state = {
  sdk: null,
  apiKey: localStorage.getItem('accdj_audius_api_key') || '',
  ctx: null, splitCue: false, crossfader: 0, decks: {}, merger: null,
  masterBus: null, cueBus: null, masterGain: null, normalOut: null,
  audioReady: false, musicLoaded: false, lastQuery: '', lastTrending: true,
  searchOffset: 0, pageSize: 28, renderedTrackIds: new Set(),
  deferredInstallPrompt: null, focusMode: false, masterDeck: 'A'
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function setMessage(text, error=false) {
  const el=$('libraryMessage'); el.textContent=text; el.style.color=error?'#fb7185':'';
}
function openMusic(){
  const d=$('musicDrawer'), b=$('drawerBackdrop'); d.classList.add('open'); d.setAttribute('aria-hidden','false'); if(b)b.hidden=false;
  if(!state.musicLoaded){state.musicLoaded=true;searchTracks('',true);}
}
function closeMusic(){const d=$('musicDrawer'),b=$('drawerBackdrop');d.classList.remove('open');d.setAttribute('aria-hidden','true');if(b)b.hidden=true;}

function sourceBpm(id){
  const d=state.decks[id], detected=Number(d?.detectedBpm);
  if(detected>=70&&detected<=180&&(d?.tempoConfidence||0)>=3)return detected;
  const meta=Number(d?.track?.bpm); if(!meta||!Number.isFinite(meta))return null;
  let bpm=meta; while(bpm<70)bpm*=2; while(bpm>180)bpm/=2; return bpm;
}
function effectiveBpm(id){const d=state.decks[id],bpm=sourceBpm(id);return bpm&&Number.isFinite(bpm)?bpm*(Number(d.audio.playbackRate)||1):null;}
function updateBpmDisplay(id){
  const d=state.decks[id],base=sourceBpm(id); if(!base||!Number.isFinite(base)){$(`bpm${id}`).textContent='BPM —';return;}
  const eff=effectiveBpm(id),changed=Math.abs((d.audio.playbackRate||1)-1)>.0005,auto=(d?.tempoConfidence||0)>=3?' AUTO':'';
  $(`bpm${id}`).textContent=changed?`BPM ${eff.toFixed(1)}*${auto}`:`BPM ${base.toFixed(1)}${auto}`;
}
function beatLengthMedia(id){const bpm=sourceBpm(id);return bpm>0?60/bpm:null;}
function phaseFromAnchor(id){const d=state.decks[id],beat=beatLengthMedia(id);if(!d||!beat)return null;const a=Number.isFinite(d.beatAnchor)?d.beatAnchor:0;return ((((d.audio.currentTime-a)/beat)%1)+1)%1;}
function normalizedPhaseError(targetId,masterId){const a=phaseFromAnchor(targetId),b=phaseFromAnchor(masterId);if(a===null||b===null)return null;let e=a-b;if(e>.5)e-=1;if(e<-.5)e+=1;return e;}
function updateGridUi(id){const d=state.decks[id],el=$(`grid${id}`);if(!el)return;const ready=(d?.beatConfidence||0)>=4&&(d?.tempoConfidence||0)>=3;el.textContent=ready?'GRID ✓':(d?.track?((d?.tempoConfidence||0)>=2?'BPM…':'ANALYZE'):'GRID —');el.classList.toggle('grid-ready',ready);}
function normalizeTempo(bpm){if(!Number.isFinite(bpm)||bpm<=0)return null;while(bpm<70)bpm*=2;while(bpm>180)bpm/=2;return bpm;}

function estimateTempoFromOnsets(d){
  const times=d.onsetTimes||[];if(times.length<6)return;const hist=new Map(),n=times.length,from=Math.max(0,n-28);
  for(let i=from+1;i<n;i++)for(let j=Math.max(from,i-8);j<i;j++){
    const dt=times[i]-times[j];if(dt<.24||dt>2.4)continue;const bpm=normalizeTempo(60/dt);if(!bpm)continue;
    const key=Math.round(bpm*2)/2,recency=.55+.45*((i-from)/Math.max(1,n-from-1)),dw=1/Math.sqrt(i-j);hist.set(key,(hist.get(key)||0)+recency*dw);
  }
  if(!hist.size)return;const ranked=[...hist.entries()].sort((a,b)=>b[1]-a[1]),[peak,peakScore]=ranked[0];let weighted=0,weight=0;
  for(const [bpm,score] of ranked)if(Math.abs(bpm-peak)<=1.5){weighted+=bpm*score;weight+=score;}
  let candidate=weight?weighted/weight:peak;const prev=Number(d.detectedBpm);
  if(prev>=70&&prev<=180){const opts=[candidate,normalizeTempo(candidate*2),normalizeTempo(candidate/2)].filter(Boolean);candidate=opts.sort((a,b)=>Math.abs(a-prev)-Math.abs(b-prev))[0];}
  else {const meta=normalizeTempo(Number(d.track?.bpm));if(meta){const opts=[candidate,normalizeTempo(candidate*2),normalizeTempo(candidate/2)].filter(Boolean),close=opts.sort((a,b)=>Math.abs(a-meta)-Math.abs(b-meta))[0];if(Math.abs(close-meta)<Math.abs(candidate-meta)*.65)candidate=close;}}
  const second=ranked[1]?.[1]||0,dominance=peakScore/Math.max(.001,second||peakScore*.55),gain=dominance>1.18?1:.35;
  d.detectedBpm=Number.isFinite(d.detectedBpm)?d.detectedBpm*.84+candidate*.16:candidate;d.tempoConfidence=Math.min(10,(d.tempoConfidence||0)+gain);
}

function observeBeat(id,spectrum){
  const d=state.decks[id];if(!d?.track||d.audio.paused)return;const ctx=state.ctx,binHz=ctx.sampleRate/d.analyser.fftSize;
  const lo=Math.max(1,Math.floor(42/binHz)),hi=Math.min(spectrum.length-1,Math.ceil(230/binHz));
  if(!d.prevSpectrum||d.prevSpectrum.length!==spectrum.length)d.prevSpectrum=new Uint8Array(spectrum.length);
  let flux=0,energy=0,bins=0;for(let i=lo;i<=hi;i++){const cur=spectrum[i],prev=d.prevSpectrum[i]||0;flux+=Math.max(0,cur-prev);energy+=cur;d.prevSpectrum[i]=cur;bins++;}
  flux/=Math.max(1,bins);energy/=Math.max(1,bins);d.fluxAvg=d.fluxAvg?d.fluxAvg*.965+flux*.035:flux;d.energyAvg=d.energyAvg?d.energyAvg*.97+energy*.03:energy;
  const now=d.audio.currentTime,currentBeat=beatLengthMedia(id)||.5,refractory=Math.max(.20,currentBeat*.34),threshold=Math.max(3.2,(d.fluxAvg||0)*1.85),strong=energy>Math.max(22,(d.energyAvg||0)*.78);
  if(flux<threshold||!strong||now-(d.lastOnsetMedia??-99)<refractory)return;
  d.lastOnsetMedia=now;d.onsetTimes=d.onsetTimes||[];d.onsetTimes.push(now);if(d.onsetTimes.length>40)d.onsetTimes.shift();estimateTempoFromOnsets(d);
  const beat=beatLengthMedia(id);if(!beat)return;
  if(!Number.isFinite(d.beatAnchor)){d.beatAnchor=now;d.beatConfidence=1;}
  else {const n=Math.round((now-d.beatAnchor)/beat),pred=d.beatAnchor+n*beat,err=now-pred;
    if(Math.abs(err)<=beat*.20){const w=d.beatConfidence>=6?.055:.16;d.beatAnchor+=err*w;d.beatConfidence=Math.min(12,(d.beatConfidence||0)+1);}
    else if((d.tempoConfidence||0)>=4&&now-(d.lastAnchorResetMedia||0)>beat*6){d.beatAnchor=now;d.beatConfidence=Math.max(2,(d.beatConfidence||0)-1);d.lastAnchorResetMedia=now;}
  }
  updateGridUi(id);updateBpmDisplay(id);
}
