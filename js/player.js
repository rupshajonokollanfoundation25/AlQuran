// ---------- Audio playback engine ----------
const audioEl = document.getElementById('audioEl');
const playerBar = document.getElementById('playerBar');
audioEl.preload = 'auto';
// playsInline helps background/lock-screen playback behave and lets the
// browser fully own buffering while the screen is locked.
audioEl.setAttribute('playsinline', '');

const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];

// ---------- শব্দ-অনুযায়ী (word-by-word) অডিও হাইলাইট ----------
// প্রতিটি আয়াতের অডিও ফাইল সম্পূর্ণ আয়াতের একটি একক mp3 (কোনো word-level
// টাইমস্ট্যাম্প মেটাডেটা এখানে নেই)। তাই যথাযথ karaoke-style সিঙ্ক সম্ভব নয়,
// কিন্তু একটা smart approximation করা যায়: প্রতিটি শব্দের অক্ষরসংখ্যাকে তার
// আনুমানিক উচ্চারণ-সময়ের ওজন (weight) হিসেবে ধরে, audio এর currentTime/duration
// অনুপাত অনুযায়ী কোন শব্দটি এখন "চলছে" তা হিসাব করে হাইলাইট করা হয়। ছোট শব্দ কম
// সময়ে, বড় শব্দ বেশি সময়ে হাইলাইট হবে — ফলে বাস্তব তিলাওয়াতের সাথে মোটামুটি
// স্বাভাবিকভাবেই মিলে যায়, যদিও এটি প্রকৃত timestamp-ভিত্তিক নয়।
let wordHighlightData = null; // { spans, cumFractions }

function clearWordHighlight(){
  if(wordHighlightData){
    wordHighlightData.spans.forEach(s => s.classList.remove('qw-active'));
  }
  wordHighlightData = null;
}

function prepareWordHighlight(item){
  clearWordHighlight();
  const card = document.getElementById(`ayah-${item.key.replace(':','-')}`);
  if(!card) return;
  const arText = card.querySelector('.ar-text');
  if(!arText) return;
  const spans = arText.querySelectorAll('.qw');
  if(!spans.length) return;
  const weights = Array.from(spans).map(s => Math.max(1, s.textContent.trim().length));
  const total = weights.reduce((a,b) => a+b, 0);
  let acc = 0;
  const cumFractions = weights.map(w => { acc += w; return acc/total; });
  wordHighlightData = { spans, cumFractions };
}

function updateWordHighlight(){
  if(!wordHighlightData || !state.isPlaying) return;
  const dur = audioEl.duration;
  if(!isFinite(dur) || dur <= 0) return;
  const frac = audioEl.currentTime / dur;
  const { spans, cumFractions } = wordHighlightData;
  let idx = cumFractions.findIndex(c => frac <= c);
  if(idx === -1) idx = spans.length - 1;
  spans.forEach((s, i) => s.classList.toggle('qw-active', i === idx));
}

function fmtTime(sec){
  if(!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return toBn(m) + ':' + toBn(String(s).padStart(2,'0'));
}

function currentAudioUrl(item){
  return `${AUDIO_CDN}/${state.reciter}/${item.globalNumber}.mp3`;
}

function playAtIndex(idx, userInitiated){
  if(idx < 0 || idx >= state.playlist.length) return;
  const item = state.playlist[idx];
  state.fullSurahMode = false;
  state.fullSurahNumber = null;
  state.playIndex = idx;
  playerBar.classList.add('buffering');
  audioEl.src = currentAudioUrl(item);
  audioEl.playbackRate = state.playbackRate;
  audioEl.play().then(()=>{ state.isPlaying = true; syncPlayingUI(); }).catch(()=>{ handlePlaybackFailure(idx); });
  document.getElementById('playerRef').textContent = `আয়াত ${toBn(item.numberInSurah)}`;
  document.getElementById('playerTitle').textContent = item.title;
  playerBar.classList.add('visible');
  state.lastRead = { surah: item.surah, ayah: item.numberInSurah };
  saveLastRead();
  addHistoryEntry({ surah: item.surah, title: item.title, ayah: item.numberInSurah, reciter: state.reciter, ts: Date.now() });
  trackAudioSurahPlayed(item.surah);
  const libList = document.getElementById('libraryListContainer');
  if(libList && document.getElementById('libTabHistory') && document.getElementById('libTabHistory').classList.contains('active')) renderHistoryList(libList);
  recordActivityToday();
  const card = document.getElementById(`ayah-${item.key.replace(':','-')}`);
  if(card && userInitiated) card.scrollIntoView({behavior:'smooth', block:'center'});
  updateMediaSessionMetadata(item);
  prepareWordHighlight(item);
}

// ---------- হাফেজ মোডে "সম্পূর্ণ সূরা একটানা" প্লে ----------
// প্রতি-আয়াত mp3 একের পর এক চেইন করলে প্রতিবার নতুন ফাইল fetch/buffer করতে
// হয় বলে সামান্য গ্যাপ থেকে যায় — মুখস্থ/শোনার সময় এটা বিরক্তিকর লাগতে পারে।
// এড়াতে cdn.islamic.network এর audio-surah এন্ডপয়েন্ট থেকে গোটা সূরার
// একটাই ফাইল আনা হয়, ফলে পুরোপুরি গ্যাপলেস চলে। এই মোডে কোনো নির্দিষ্ট
// আয়াতের সাথে playIndex বাঁধা থাকে না (state.fullSurahMode = true দিয়ে
// বাকি প্লেয়ার-লজিক এটা চিনে নেয়), তাই ওয়ার্ড/আয়াত-লেভেল হাইলাইট এখানে হয় না।
function fullSurahAudioUrl(surahNum){
  return `${AUDIO_SURAH_CDN}/${state.reciter}/${surahNum}.mp3`;
}

function playFullSurah(surahNum, userInitiated){
  state.fullSurahMode = true;
  state.fullSurahNumber = surahNum;
  state.playIndex = -1;
  clearWordHighlight();
  playerBar.classList.add('buffering');
  audioEl.src = fullSurahAudioUrl(surahNum);
  audioEl.playbackRate = state.playbackRate;
  audioEl.play().then(()=>{ state.isPlaying = true; syncPlayingUI(); }).catch(()=>{ handlePlaybackFailure(-1); });
  const title = surahNamesBn[surahNum-1] || ('সূরা ' + surahNum);
  document.getElementById('playerRef').textContent = 'সম্পূর্ণ সূরা — একটানা';
  document.getElementById('playerTitle').textContent = title;
  playerBar.classList.add('visible');
  state.lastRead = { surah: surahNum, ayah: 1 };
  saveLastRead();
  addHistoryEntry({ surah: surahNum, title, ayah: 1, reciter: state.reciter, ts: Date.now() });
  trackAudioSurahPlayed(surahNum);
  const libList = document.getElementById('libraryListContainer');
  if(libList && document.getElementById('libTabHistory') && document.getElementById('libTabHistory').classList.contains('active')) renderHistoryList(libList);
  recordActivityToday();
  if('mediaSession' in navigator){
    const reciterName = (reciters.find(r => r.id === state.reciter) || {}).name || '';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${title} — সম্পূর্ণ সূরা`,
      artist: reciterName,
      album: 'কুরআন বাংলা',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
  }
}

// Called whenever the current track fails to load/play (404 from the CDN,
// no network, unsupported file, etc). Without this the spinner in the
// player bar would spin forever with no feedback, which looks exactly like
// "it just keeps loading and never plays".
let playbackRetryCount = 0;
function handlePlaybackFailure(idx){
  playerBar.classList.remove('buffering');
  state.isPlaying = false;
  clearWordHighlight();
  syncPlayingUI();
  if(state.fullSurahMode){
    state.fullSurahMode = false;
    state.fullSurahNumber = null;
    document.getElementById('playerRef').textContent = 'এই তিলাওয়াতটি লোড করা যায়নি';
    showPlaybackError();
    return;
  }
  const autoplayChk = document.getElementById('autoplayChk');
  // If we're auto-advancing through a surah, skip the broken ayah instead of
  // getting stuck, but stop after a couple of consecutive failures so we
  // don't silently loop through an entire offline/broken surah.
  if(autoplayChk && autoplayChk.checked && playbackRetryCount < 2 && idx < state.playlist.length - 1){
    playbackRetryCount++;
    playAtIndex(idx + 1, false);
    return;
  }
  playbackRetryCount = 0;
  document.getElementById('playerRef').textContent = 'এই তিলাওয়াতটি লোড করা যায়নি';
  showPlaybackError();
}

let playbackErrorTimer = null;
function showPlaybackError(){
  const ref = document.getElementById('playerRef');
  if(!ref) return;
  const original = ref.textContent;
  ref.textContent = navigator.onLine === false
    ? 'No internet connection — audio for this verse could not be loaded.'
    : 'The audio could not be loaded, please try again later or change the reciter.';
  clearTimeout(playbackErrorTimer);
  playbackErrorTimer = setTimeout(() => { if(ref.textContent.includes('Could not load.')) ref.textContent = original; }, 4000);
}

function pausePlayback(){
  audioEl.pause();
  state.isPlaying = false;
  syncPlayingUI();
}

function resumePlayback(){
  if(state.fullSurahMode && audioEl.src){
    audioEl.play().then(()=>{ state.isPlaying = true; syncPlayingUI(); }).catch(()=>{});
    return;
  }
  if(state.playIndex === -1){ if(state.playlist.length){ playAtIndex(0, false); } return; }
  audioEl.play().then(()=>{ state.isPlaying = true; syncPlayingUI(); }).catch(()=>{});
}

function syncPlayingUI(){
  document.querySelectorAll('.ayah-card').forEach(c => c.classList.remove('playing'));
  document.querySelectorAll('.play-toggle').forEach(b => { b.classList.remove('is-playing'); b.textContent = '▶ Listen.'; });
  playerBar.classList.toggle('full-surah-mode', !!state.fullSurahMode);
  if(state.fullSurahMode){
    // নির্দিষ্ট কোনো আয়াতের সাথে বাঁধা নয় — পুরো সূরা একটানা চলছে, তাই
    // পুরো সূরার সব আয়াত কার্ডকেই "চলছে" হিসেবে হালকা হাইলাইট দেখানো হয়।
    if(state.isPlaying) document.querySelectorAll('.ayah-card').forEach(c => c.classList.add('playing'));
  } else if(state.playIndex >= 0){
    const item = state.playlist[state.playIndex];
    const card = document.querySelector(`.ayah-card[data-key="${item.key}"]`);
    if(card){
      const btn = card.querySelector('.play-toggle');
      if(state.isPlaying){
        card.classList.add('playing');
        if(btn){ btn.classList.add('is-playing'); btn.textContent = '❚❚ Ongoing'; }
      }
    }
  }
  const ppBtn = document.getElementById('playPauseBtn');
  if(ppBtn){
    ppBtn.classList.toggle('is-playing', state.isPlaying);
    ppBtn.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Turn on');
  }
  if('mediaSession' in navigator){
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
  }
}

// ---------- Media Session: lock-screen / notification controls so playback
// keeps going and stays controllable when the phone is locked or the app is
// backgrounded. ----------
function updateMediaSessionMetadata(item){
  if(!('mediaSession' in navigator)) return;
  const reciterName = (reciters.find(r => r.id === state.reciter) || {}).name || '';
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `আয়াত ${toBn(item.numberInSurah)} — ${item.title}`,
    artist: reciterName,
    album: 'কুরআন বাংলা',
    artwork: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
}

function initMediaSessionHandlers(){
  if(!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => resumePlayback());
  navigator.mediaSession.setActionHandler('pause', () => pausePlayback());
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    if(state.playIndex > 0) playAtIndex(state.playIndex - 1, false);
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if(state.playIndex < state.playlist.length - 1) playAtIndex(state.playIndex + 1, false);
  });
  try{
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      audioEl.currentTime = Math.max(0, audioEl.currentTime - (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      if(audioEl.duration) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if(details.seekTime != null && audioEl.duration) audioEl.currentTime = details.seekTime;
    });
    navigator.mediaSession.setActionHandler('stop', () => { pausePlayback(); });
  }catch(e){ /* older browsers may not support every action */ }
}

function updatePositionState(){
  if(!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  if(!audioEl.duration || !isFinite(audioEl.duration)) return;
  try{
    navigator.mediaSession.setPositionState({
      duration: audioEl.duration,
      playbackRate: audioEl.playbackRate,
      position: Math.min(audioEl.currentTime, audioEl.duration)
    });
  }catch(e){}
}

// ---------- Playback speed ----------
function applySpeedLabel(){
  const btn = document.getElementById('speedBtn');
  if(btn) btn.textContent = `${toBn(state.playbackRate)}x`;
}
function cycleSpeed(){
  const idx = SPEED_STEPS.indexOf(state.playbackRate);
  const next = SPEED_STEPS[(idx + 1 + SPEED_STEPS.length) % SPEED_STEPS.length];
  state.playbackRate = next;
  audioEl.playbackRate = next;
  savePlaybackRate();
  applySpeedLabel();
}

// ---------- Offline download of a whole surah/juz's audio ----------
function offlineButtonLabel(done, total){
  if(done == null) return '⬇ Save offline';
  if(done >= total) return '✓ Saved offline';
  return `Downloading (${toBn(done)}/${toBn(total)})`;
}

async function downloadCurrentAudioForOffline(btn){
  if(!state.playlist.length) return;
  const surahNum = state.playlist[0].surah;
  const isSingleSurah = state.playlist.every(item => item.surah === surahNum);
  const urls = state.playlist.map(item => currentAudioUrl(item));
  const reciterAtDownload = state.reciter;
  btn.disabled = true;
  btn.textContent = offlineButtonLabel(0, urls.length);

  // Prefer handing the batch to the service worker so it keeps downloading
  // even if the user navigates to another surah mid-download.
  if('serviceWorker' in navigator && navigator.serviceWorker.controller){
    const requestId = `${surahNum}-${Date.now()}`;
    const onMsg = (event) => {
      const msg = event.data || {};
      if(msg.requestId !== requestId) return;
      if(msg.type === 'CACHE_AUDIO_PROGRESS'){
        btn.textContent = offlineButtonLabel(msg.done, msg.total);
      } else if(msg.type === 'CACHE_AUDIO_DONE'){
        btn.textContent = offlineButtonLabel(msg.total, msg.total);
        btn.classList.add('downloaded');
        if(isSingleSurah) markSurahOffline(surahNum, reciterAtDownload, urls, urls.length);
        navigator.serviceWorker.removeEventListener('message', onMsg);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_AUDIO', urls, requestId });
    return;
  }

  // Fallback: cache directly from the page if there's no active service worker.
  if(!('caches' in window)){ btn.textContent = '⬇ Offline mode is not supported.'; return; }
  const cache = await caches.open(AUDIO_CACHE_NAME);
  let done = 0;
  for(const url of urls){
    try{
      const existing = await cache.match(url);
      if(!existing){
        const res = await fetch(url, { mode: 'no-cors' });
        if(res) await cache.put(url, res.clone());
      }
    }catch(e){ /* skip and continue */ }
    done++;
    btn.textContent = offlineButtonLabel(done, urls.length);
  }
  btn.textContent = offlineButtonLabel(urls.length, urls.length);
  btn.classList.add('downloaded');
  if(isSingleSurah) markSurahOffline(surahNum, reciterAtDownload, urls, urls.length);
}

// ---------- হাফেজ মোডে অডিও শোনার ধরন বেছে নেওয়ার মোডাল ----------
// হাফেজ মোডে থাকা অবস্থায় প্রথমবার প্লে চাপলে জিজ্ঞেস করে নেওয়া হয়:
// "একটা একটা করে আয়াত" (আগের মতো চেইন করে) নাকি "সম্পূর্ণ সূরা একটানা"
// (গ্যাপলেস, audio-surah API)। এই পছন্দ js/reader.js এর hafezPlayChoice
// ভেরিয়েবলে মনে রাখা হয়, যাতে প্রতিটা ক্লিকে বার বার জিজ্ঞেস করে বিরক্ত
// না করে — নতুন সূরা/পৃষ্ঠায় গেলে বা হাফেজ মোড বন্ধ করলে আবার জিজ্ঞেস করবে।
function openHafezPlayChoiceModal({ onChooseSingle, onChooseFull }){
  let modal = document.getElementById('hafezPlayChoiceModal');
  if(!modal){
    modal = document.createElement('div');
    modal.className = 'app-modal';
    modal.id = 'hafezPlayChoiceModal';
    modal.innerHTML = `
      <div class="app-modal-box">
        <div class="app-modal-head">
          <h3><i class="fa-solid fa-headphones-simple"></i> কীভাবে শুনতে চান?</h3>
          <button class="app-modal-close" id="hafezPlayChoiceClose">✕</button>
        </div>
        <div class="app-modal-body">
          <div class="lang-picker-list">
            <button class="lang-picker-item" id="hafezChoiceSingle" type="button">
              <span class="lp-avatar"><i class="fa-solid fa-list-ol"></i></span>
              <span class="lp-text">
                <span class="lp-label">একটা একটা করে আয়াত</span>
                <span class="lp-sub">থেমে থেমে, মুখস্থ করার জন্য উপযোগী</span>
              </span>
            </button>
            <button class="lang-picker-item" id="hafezChoiceFull" type="button">
              <span class="lp-avatar"><i class="fa-solid fa-infinity"></i></span>
              <span class="lp-text">
                <span class="lp-label">সম্পূর্ণ সূরা একটানা</span>
                <span class="lp-sub">কোনো গ্যাপ ছাড়া গোটা সূরা একটানা চলবে</span>
              </span>
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    wireModalBackdrop('hafezPlayChoiceModal');
    document.getElementById('hafezPlayChoiceClose').onclick = () => closeModal('hafezPlayChoiceModal');
  }
  document.getElementById('hafezChoiceSingle').onclick = () => { closeModal('hafezPlayChoiceModal'); onChooseSingle(); };
  document.getElementById('hafezChoiceFull').onclick = () => { closeModal('hafezPlayChoiceModal'); onChooseFull(); };
  openModal('hafezPlayChoiceModal');
}

let stallTimer = null;
function initPlayer(){
  updateReciterLabels();
  const reciterFieldBtn = document.getElementById('reciterFieldBtn');
  if(reciterFieldBtn) reciterFieldBtn.onclick = openReciterPicker;

  document.getElementById('playPauseBtn').onclick = () => { state.isPlaying ? pausePlayback() : resumePlayback(); };
  document.getElementById('prevBtn').onclick = () => { if(state.playIndex > 0) playAtIndex(state.playIndex - 1, true); };
  document.getElementById('nextBtn').onclick = () => { if(state.playIndex < state.playlist.length - 1) playAtIndex(state.playIndex + 1, true); };
  document.getElementById('playerClose').onclick = () => {
    audioEl.pause(); audioEl.removeAttribute('src');
    state.isPlaying=false; state.playIndex=-1;
    state.fullSurahMode=false; state.fullSurahNumber=null;
    playerBar.classList.remove('visible');
    clearWordHighlight();
    syncPlayingUI();
  };
  const speedBtn = document.getElementById('speedBtn');
  if(speedBtn){ speedBtn.onclick = cycleSpeed; applySpeedLabel(); }

  audioEl.addEventListener('ended', () => {
    if(state.fullSurahMode){
      state.isPlaying = false;
      state.fullSurahMode = false;
      state.fullSurahNumber = null;
      clearWordHighlight();
      syncPlayingUI();
      return;
    }
    const autoplayChk = document.getElementById('autoplayChk');
    if(autoplayChk.checked && state.playIndex < state.playlist.length - 1){
      playAtIndex(state.playIndex + 1, false);
    } else {
      state.isPlaying = false;
      clearWordHighlight();
      syncPlayingUI();
    }
  });
  audioEl.addEventListener('timeupdate', () => {
    document.getElementById('curTime').textContent = fmtTime(audioEl.currentTime);
    if(audioEl.duration){
      document.getElementById('seekBar').value = (audioEl.currentTime / audioEl.duration) * 100;
      document.getElementById('durTime').textContent = fmtTime(audioEl.duration);
    }
    updatePositionState();
    updateWordHighlight();
  });
  audioEl.addEventListener('pause', () => { if(state.isPlaying){ state.isPlaying=false; syncPlayingUI(); } });
  audioEl.addEventListener('play', () => { if(!state.isPlaying){ state.isPlaying=true; syncPlayingUI(); } });
  audioEl.addEventListener('waiting', () => {
    playerBar.classList.add('buffering');
    // Safety net: if we're still "buffering" 15s later (dead link, CDN
    // outage, stalled connection) treat it as a failure instead of leaving
    // the spinner running indefinitely.
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if(playerBar.classList.contains('buffering')) handlePlaybackFailure(state.playIndex);
    }, 15000);
  });
  audioEl.addEventListener('playing', () => { playerBar.classList.remove('buffering'); clearTimeout(stallTimer); playbackRetryCount = 0; });
  audioEl.addEventListener('canplay', () => { playerBar.classList.remove('buffering'); clearTimeout(stallTimer); });
  audioEl.addEventListener('error', () => { clearTimeout(stallTimer); handlePlaybackFailure(state.playIndex); });
  audioEl.addEventListener('loadedmetadata', () => updatePositionState());

  document.getElementById('seekBar').addEventListener('input', (e) => {
    if(audioEl.duration) audioEl.currentTime = (e.target.value/100) * audioEl.duration;
  });

  initMediaSessionHandlers();
}
