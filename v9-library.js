async function searchTracks(query, trending=false, append=false) {
  const genre = $('genreSelect').value;
  const offset = append ? state.searchOffset + state.pageSize : 0;
  if (!append) {
    state.lastQuery=query; state.lastTrending=trending; state.searchOffset=0;
    state.renderedTrackIds=new Set(); $('results').innerHTML='';
  }
  setMessage(append ? 'Mengambil track berikutnya…' : 'Mengambil track dari Audius…');
  try {
    let tracks=[];
    if (state.sdk) {
      const response = trending
        ? await state.sdk.tracks.getTrendingTracks({limit:state.pageSize,offset,...(genre?{genre}:{})})
        : await state.sdk.tracks.searchTracks({query,limit:state.pageSize,offset,sortMethod:'relevant',...(genre?{genre:[genre]}:{})});
      tracks=response?.data||[];
    } else {
      const params=new URLSearchParams({app_name:APP_NAME,limit:String(state.pageSize),offset:String(offset)});
      if(genre)params.set('genre',genre);
      let url;
      if(trending)url=`${PUBLIC_API}/tracks/trending?${params}`;
      else{params.set('query',query);url=`${PUBLIC_API}/tracks/search?${params}`;}
      const r=await fetch(url);if(!r.ok)throw new Error(`Audius HTTP ${r.status}`);tracks=(await r.json())?.data||[];
    }
    state.searchOffset=offset;
    const rawCount=tracks.length,beforeFilter=tracks.length;
    tracks=tracks.filter(isPlayableTrack);
    renderResults(tracks,append);
    const hidden=Math.max(0,beforeFilter-tracks.length),totalShown=state.renderedTrackIds.size;
    $('moreBtn').hidden=rawCount<state.pageSize;
    if(tracks.length||append)setMessage(`${totalShown} track tersedia${hidden?` • ${hidden} non-streamable dilewati`:''}${state.apiKey?' • API key aktif':' • Public Mode'}.`);
    else setMessage('Tidak ada track streamable yang cocok. Coba genre/search lain.',true);
  } catch(err) {
    console.error(err);setMessage('Gagal terhubung ke Audius. Buka API dan periksa Audius API key.',true);
  }
}

function boolish(value){
  if(value===true||value===false)return value;
  if(typeof value==='string'){const v=value.trim().toLowerCase();if(v==='true'||v==='1'||v==='yes')return true;if(v==='false'||v==='0'||v==='no')return false;}
  return null;
}
function isPlayableTrack(t){
  if(!t||!t.id)return false;
  if(boolish(t.isStreamable??t.is_streamable)===false)return false;
  if(boolish(t.isStreamGated??t.is_stream_gated)===true)return false;
  const allowed=t.allowedApiKeys??t.allowed_api_keys;
  if(Array.isArray(allowed)&&allowed.length&&(!state.apiKey||!allowed.map(String).includes(String(state.apiKey))))return false;
  return true;
}
async function getStreamUrl(track){
  if(state.sdk&&state.apiKey&&typeof state.sdk.tracks?.getTrackStreamUrl==='function')return await state.sdk.tracks.getTrackStreamUrl({trackId:track.id,apiKey:state.apiKey});
  const url=new URL(`${PUBLIC_API}/tracks/${encodeURIComponent(track.id)}/stream`);if(state.apiKey)url.searchParams.set('api_key',state.apiKey);return url.toString();
}
function legacyStreamUrl(track){const url=new URL(`${LEGACY_PUBLIC_API}/tracks/${encodeURIComponent(track.id)}/stream`);url.searchParams.set('app_name',APP_NAME);if(state.apiKey)url.searchParams.set('api_key',state.apiKey);return url.toString();}
function normalizeTrack(t){
  const artwork=t.artwork||{},user=t.user||{};
  return {id:String(t.id),title:t.title||'Untitled',artist:user.name||user.handle||t.user?.name||'Audius Artist',artwork:artwork._480x480||artwork['480x480']||artwork._150x150||artwork['150x150']||'icons/placeholder.svg',genre:t.genre||'—',bpm:t.bpm||t.tempo||null,key:t.musicalKey||t.musical_key||null,duration:Number(t.duration)||0,isStreamable:t.isStreamable??t.is_streamable??null,isStreamGated:t.isStreamGated??t.is_stream_gated??null,allowedApiKeys:t.allowedApiKeys??t.allowed_api_keys??null};
}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function renderResults(tracks,append=false){
  const root=$('results');if(!append)root.innerHTML='';
  tracks.map(normalizeTrack).forEach(track=>{
    if(state.renderedTrackIds.has(track.id))return;state.renderedTrackIds.add(track.id);
    const card=document.createElement('div');card.className='result-card';
    card.innerHTML=`<img src="${escapeHtml(track.artwork)}" alt="" loading="lazy"/><div><h3 title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3><p>${escapeHtml(track.artist)}</p><div class="result-meta">${escapeHtml(track.genre)}${track.bpm?` • ${track.bpm} BPM`:''}${track.key?` • ${escapeHtml(track.key)}`:''}</div></div><div class="load-actions"><button data-load="A">LOAD A</button><button data-load="B">LOAD B</button></div>`;
    card.querySelector('[data-load="A"]').addEventListener('click',()=>loadTrack('A',track));
    card.querySelector('[data-load="B"]').addEventListener('click',()=>loadTrack('B',track));
    root.appendChild(card);
  });
}

async function loadTrack(id,track){
  await initAudio();const deck=state.decks[id];deck.audio.pause();deck.audio.currentTime=0;releaseBeatLink(id,true);deck.audio.playbackRate=1;
  $(`pitch${id}`).value=0;$(`pitchLabel${id}`).textContent='0.0%';deck.track=track;
  deck.beatAnchor=NaN;deck.beatConfidence=0;deck.detectedBpm=NaN;deck.tempoConfidence=0;deck.onsetTimes=[];deck.prevSpectrum=null;deck.fluxAvg=0;deck.energyAvg=0;deck.lastOnsetMedia=-99;updateGridUi(id);
  deck.streamAttempt=0;deck.primaryStreamUrl=await getStreamUrl(track);deck.fallbackStreamUrl=legacyStreamUrl(track);deck.audio.src=deck.primaryStreamUrl;deck.audio.load();
  $(`title${id}`).textContent=track.title;$(`artist${id}`).textContent=track.artist;$(`cover${id}`).src=track.artwork||'icons/placeholder.svg';updateBpmDisplay(id);$(`key${id}`).textContent=`KEY ${track.key||'—'}`;$(`duration${id}`).textContent=formatTime(track.duration);$(`seek${id}`).value=0;$(`time${id}`).textContent='00:00';setSyncUi(id,false);setMessage(`${track.title} → Deck ${id} loaded.`);closeMusic();
}
