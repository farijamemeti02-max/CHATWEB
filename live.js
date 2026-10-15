(() => {
  const $ = id => document.getElementById(id);
  if (!$('livePanel')) return;
  const host = location.hostname;
  const apiBase = window.GAMETIK_API_BASE || ((host.endsWith('.onrender.com') || ['localhost', '127.0.0.1'].includes(host)) ? '' : 'https://chatweb-iajl.onrender.com');
  const api = async (path, options={}) => {
    const headers = {...(options.headers || {})};
    const token = localStorage.getItem('gametik_token') || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(apiBase + path, {...options, headers});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Fehler ${response.status}`);
    return data;
  };
  let currentStream = null, currentRole = '', room = null, chatSocket = null, countTimer = null, gameUiTimer = null, liveLikeCount = 0, audioMuted = false, hostMicMuted = false, currentGame = null, audioContext = null, micSource = null, micStream = null, micDestination = null, micGain = null, reverbGain = null, dryGain = null, delayNode = null, delayFeedback = null, delayGain = null, micCompressor = null, voiceFilter = null, processedAudioTrack = null, micPublished = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function liveStatus(message) { $('liveStageStatus').textContent = message; }
  function chatLine(username, body, time = new Date().toISOString(), gift = false) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4px 2px;overflow-wrap:anywhere;' + (gift ? 'color:#f9a8d4;font-weight:700' : '');
    el.innerHTML = `<b>${esc(username)}</b> ${esc(body)} <span class="muted tiny">${new Date(time).toLocaleTimeString()}</span>`;
    $('liveChatMessages').appendChild(el); $('liveChatMessages').scrollTop = $('liveChatMessages').scrollHeight;
    const overlay = $('liveOverlayChat');
    if (overlay) {
      const line = document.createElement('div'); line.className = 'live-overlay-line';
      line.innerHTML = `<b>${esc(username)}</b> ${esc(body)}`;
      overlay.appendChild(line);
      while (overlay.children.length > 5) overlay.firstElementChild.remove();
      setTimeout(() => { if (line.isConnected) line.style.opacity = '.82'; }, 9000);
    }
  }
  function showFloatingHeart() {
    const container = $('liveFloatingHearts'); if (!container) return;
    const heart = document.createElement('span'); heart.className = 'gametik-float-heart'; heart.textContent = ['❤️','💖','💗','💕'][Math.floor(Math.random()*4)];
    heart.style.setProperty('--heart-x', `${18 + Math.random()*64}%`);
    container.appendChild(heart); setTimeout(() => heart.remove(), 1700);
  }
  let candyBalanceCache = 0, soundContext = null, lastAnnouncedWinner = null;
  async function refreshCandyBalance() {
    if (!localStorage.getItem('gametik_token')) { candyBalanceCache = 0; if ($('liveCandyBalance')) $('liveCandyBalance').textContent = '🍬 0'; if ($('liveCasinoBalance')) $('liveCasinoBalance').textContent = '0 🍬'; return; }
    try { const d = await api('/api/candy/balance'); candyBalanceCache = Number(d.balance || 0); if ($('liveCandyBalance')) $('liveCandyBalance').textContent = '🍬 ' + candyBalanceCache; if ($('liveCasinoBalance')) $('liveCasinoBalance').textContent = candyBalanceCache + ' 🍬'; } catch {}
  }
  function playGameJingle(kind='gift') {
    try {
      soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'win' ? [523.25,659.25,783.99,1046.5] : kind === 'draw' ? [440,523.25,440] : [659.25,783.99,987.77];
      if (soundContext.state === 'suspended') soundContext.resume().catch(()=>{});
      const now = soundContext.currentTime;
      notes.forEach((hz,i)=>{ const osc=soundContext.createOscillator(), gain=soundContext.createGain(); osc.type='sine'; osc.frequency.value=hz; gain.gain.setValueAtTime(.0001,now+i*.11); gain.gain.exponentialRampToValueAtTime(.07,now+i*.11+.025); gain.gain.exponentialRampToValueAtTime(.0001,now+i*.11+.14); osc.connect(gain); gain.connect(soundContext.destination); osc.start(now+i*.11); osc.stop(now+i*.11+.15); });
    } catch {}
  }
  function applyCameraEffect() {
    const effect = $('liveEffect')?.value || 'none';
    const filters = { none:'', soft:'contrast(.96) saturate(1.04)', glow:'contrast(.98) saturate(1.12)', warm:'sepia(.18) saturate(1.16)', mono:'grayscale(1)', vivid:'saturate(1.45) contrast(1.08)', cinema:'contrast(1.12) saturate(.82) sepia(.08)', cool:'hue-rotate(12deg) saturate(1.12)', retro:'sepia(.3) contrast(1.08) saturate(.85)', dream:'saturate(1.15) contrast(.92)' };
    const beauty = Number($('liveBeauty')?.value || 0) / 100;
    const brightness = Number($('liveBrightness')?.value || 100) / 100;
    const saturation = Number($('liveSaturation')?.value || 100) / 100;
    const localId = room?.localParticipant?.identity;
    document.querySelectorAll('#liveVideoGrid video').forEach(video => {
      const isLocal = video.closest('[id^="participant-"]')?.id === `participant-${String(localId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      if (isLocal) video.style.filter = `${filters[effect] || ''} brightness(${brightness + beauty * 0.05}) saturate(${saturation + beauty * 0.08})`;
    });
  }
  function renderTrack(track, participant) {
    const grid = $('liveVideoGrid');
    const key = `participant-${String(participant.identity).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    let card = document.getElementById(key);
    if (!card) {
      card = document.createElement('div'); card.id = key;
      card.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;min-height:0;background:#03040a;border:0;border-radius:0;overflow:hidden;';
      const label = document.createElement('div'); label.textContent = participant.name || participant.identity; label.style.cssText = 'position:absolute;z-index:2;left:10px;top:58px;max-width:65%;padding:5px 9px;border:1px solid #ffffff30;border-radius:999px;background:#080b18b8;color:#fff;font-size:12px;font-weight:700;backdrop-filter:blur(10px)';
      card.appendChild(label); grid.appendChild(card);
    }
    const element = track.attach();
    if (track.kind === window.LivekitClient.Track.Kind.Audio) element.muted = audioMuted;
    element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;min-width:100%;min-height:100%;object-fit:cover;object-position:center center;background:#03040a;display:block;border:0;border-radius:0';
    if (track.kind === window.LivekitClient.Track.Kind.Audio) element.style.display = 'none';
    card.appendChild(element);
    applyCameraEffect();
  }
  function renderGame(game) {
    currentGame = game || {active:false, endsAt:null, hostPoints:0, communityPoints:0, winner:null};
    $('liveGameHostPoints').textContent = String(Number(currentGame.hostPoints || 0)); if ($('liveDuelHostScore')) $('liveDuelHostScore').textContent = String(Number(currentGame.hostPoints || 0));
    $('liveGameCommunityPoints').textContent = String(Number(currentGame.communityPoints || 0)); if ($('liveDuelCommunityScore')) $('liveDuelCommunityScore').textContent = String(Number(currentGame.communityPoints || 0));
    const hostScore = Math.max(0, Number(currentGame.hostPoints || 0)); const communityScore = Math.max(0, Number(currentGame.communityPoints || 0)); const scoreTotal = hostScore + communityScore; const hostShare = scoreTotal ? (hostScore / scoreTotal) * 100 : 50; const communityShare = scoreTotal ? (communityScore / scoreTotal) * 100 : 50; if ($('liveDuelHostFill')) $('liveDuelHostFill').style.width = `${hostShare}%`; if ($('liveDuelCommunityFill')) $('liveDuelCommunityFill').style.width = `${communityShare}%`; if ($('liveDuelLead')) $('liveDuelLead').textContent = hostScore === communityScore ? '🤝 Gleichstand' : hostScore > communityScore ? '⚡ Streamer-Team führt' : '💗 Community-Team führt'; if ($('liveDuelTimer') && $('liveGameTimer')) $('liveDuelTimer').textContent = $('liveGameTimer').textContent;
    $('liveGameStart').classList.toggle('hidden', currentRole !== 'host' || !!currentGame.active); $('liveGameStart').textContent = currentGame.winner ? '🏆 Ehrenrunde starten' : '▶ Duell starten'; if ($('liveDuelOverlay')) $('liveDuelOverlay').classList.toggle('hidden', !currentGame.active && !currentGame.winner);
    $('liveGameStop').classList.toggle('hidden', currentRole !== 'host' || !currentGame.active);
    if (currentGame.active && currentGame.endsAt) {
      const remaining = Math.max(0, Math.ceil((Number(currentGame.endsAt) - Date.now()) / 1000));
      $('liveGameTimer').textContent = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`; if ($('liveDuelTimer')) $('liveDuelTimer').textContent = $('liveGameTimer').textContent;
      $('liveGameResult').textContent = '🔥 Duell läuft! Süßigkeiten und Geschenke zählen live.'; if ($('liveDuelResult')) $('liveDuelResult').textContent = '🍬 Süßigkeiten zählen live · Runde läuft!';
    } else {
      $('liveGameTimer').textContent = '00:00';
      $('liveGameResult').textContent = currentGame.winner === 'host' ? '🏆 Streamer-Team gewinnt!' : currentGame.winner === 'community' ? '🏆 Community-Team gewinnt!' : currentGame.winner === 'draw' ? '🤝 Unentschieden!' : 'Das Spiel ist aus. Nur der Gastgeber kann es starten.'; if ($('liveDuelResult')) $('liveDuelResult').textContent = currentGame.winner ? (currentGame.winner === 'draw' ? '🤝 Ehrenrunde: Unentschieden!' : '🏆 ' + (currentGame.winner === 'host' ? 'Gastgeber' : 'Community') + ' gewinnt! 🎉') : '3-Minuten-Runde · kostenlose 🍬 zählen!'; if (currentGame.active) lastAnnouncedWinner = null; else if (currentGame.winner && currentGame.winner !== lastAnnouncedWinner) { lastAnnouncedWinner = currentGame.winner; playGameJingle(currentGame.winner === 'draw' ? 'draw' : 'win'); }
    }
  }
  function updateAudioMixer() {
    if (!micGain || !audioContext) return;
    const volume = Number($('liveMicVolume')?.value ?? 100) / 100;
    const reverb = Number($('liveReverb')?.value ?? 20) / 100;
    const delay = Number($('liveDelay')?.value ?? 0) / 100;
    micGain.gain.setTargetAtTime(volume, audioContext.currentTime, .025);
    if (reverbGain) reverbGain.gain.setTargetAtTime(reverb * .65, audioContext.currentTime, .03);
    if (dryGain) dryGain.gain.setTargetAtTime(1 - reverb * .25, audioContext.currentTime, .03);
    if (delayGain) delayGain.gain.setTargetAtTime(delay * .45, audioContext.currentTime, .03);
    if (delayFeedback) delayFeedback.gain.setTargetAtTime(Math.min(.42, delay * .42), audioContext.currentTime, .03);
    $('liveMicVolumeLabel').textContent = `${Math.round(volume * 100)}%`;
    $('liveReverbLabel').textContent = `${Math.round(reverb * 100)}%`;
    $('liveDelayLabel').textContent = `${Math.round(delay * 100)}%`;
  }
  function makeImpulse(context, seconds = 1.8, decay = 2.4) {
    const length = Math.floor(context.sampleRate * seconds), impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) { const data = impulse.getChannelData(channel); for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay); }
    return impulse;
  }
  async function enableAudioMixer() {
    if (currentRole !== 'host' || !room) { $('liveAudioStatus').textContent = 'Der Studio-Mixer ist nur für den Gastgeber verfügbar.'; return; }
    const button = $('liveAudioEnable'); button.disabled = true;
    try {
      if (micPublished) { $('liveAudioStatus').textContent = 'Studio-Mixer ist aktiv. Änderungen wirken sofort.'; return; }
      audioContext = new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume();
      micStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}, video:false});
      micSource = audioContext.createMediaStreamSource(micStream);
      micGain = audioContext.createGain(); micCompressor = audioContext.createDynamicsCompressor();
      micCompressor.threshold.value = -20; micCompressor.knee.value = 18; micCompressor.ratio.value = 3; micCompressor.attack.value = .004; micCompressor.release.value = .22;
      voiceFilter = audioContext.createBiquadFilter(); voiceFilter.type = 'peaking'; voiceFilter.frequency.value = 2500; voiceFilter.Q.value = 1;
      const convolver = audioContext.createConvolver(); convolver.buffer = makeImpulse(audioContext);
      reverbGain = audioContext.createGain(); dryGain = audioContext.createGain();
      delayNode = audioContext.createDelay(1.5); delayNode.delayTime.value = .28; delayFeedback = audioContext.createGain(); delayGain = audioContext.createGain();
      micDestination = audioContext.createMediaStreamDestination();
      micSource.connect(micGain); micGain.connect(micCompressor); micCompressor.connect(voiceFilter);
      voiceFilter.connect(dryGain); dryGain.connect(micDestination);
      voiceFilter.connect(convolver); convolver.connect(reverbGain); reverbGain.connect(micDestination);
      voiceFilter.connect(delayNode); delayNode.connect(delayGain); delayGain.connect(micDestination); delayNode.connect(delayFeedback); delayFeedback.connect(delayNode);
      const mode = $('liveVoiceEffect')?.value || 'normal';
      if (mode === 'radio') { voiceFilter.type = 'bandpass'; voiceFilter.frequency.value = 1600; voiceFilter.Q.value = .7; }
      else if (mode === 'robot') { voiceFilter.type = 'bandpass'; voiceFilter.frequency.value = 900; voiceFilter.Q.value = 1.4; }
      else if (mode === 'autotune') { voiceFilter.type = 'peaking'; voiceFilter.frequency.value = 1200; voiceFilter.Q.value = 1.2; voiceFilter.gain.value = 5; }
      const rawTrack = micDestination.stream.getAudioTracks()[0];
      const LocalAudioTrack = window.LivekitClient.LocalAudioTrack;
      if (!LocalAudioTrack) throw new Error('Diese LiveKit-SDK-Version unterstützt den Audio-Mixer nicht.');
      const localTrack = new LocalAudioTrack(rawTrack, undefined, false);
      await room.localParticipant.publishTrack(localTrack, {name:'gametik-studio-mic', source:window.LivekitClient.Track.Source.Microphone});
      processedAudioTrack = localTrack; micPublished = true; hostMicMuted = false;
      $('liveMuteBtn').textContent = '🎙️ Mikrofon aktiv'; $('liveMuteBtn').setAttribute('aria-pressed','false');
      $('liveAudioStatus').textContent = mode === 'autotune' ? 'Mixer aktiv. AutoTune-Stil nutzt eine Klangfärbung, keine vollwertige Tonhöhenkorrektur.' : 'Studio-Mixer aktiv: Lautstärke, Hall und Delay werden live auf deinen Ton angewendet.';
      button.textContent = '⏻ Mixer ausschalten'; button.dataset.active = 'true'; updateAudioMixer();
    } catch (error) {
      $('liveAudioStatus').textContent = 'Mixer konnte nicht aktiviert werden: ' + error.message;
      if (micStream) micStream.getTracks().forEach(track => track.stop());
      if (audioContext) { try { await audioContext.close(); } catch {} }
      audioContext = null; micStream = null; micPublished = false;
    } finally { button.disabled = false; }
  }
  async function stopAudioMixer() {
    try { if (processedAudioTrack && room?.localParticipant) await room.localParticipant.unpublishTrack(processedAudioTrack); } catch {}
    try { processedAudioTrack?.stop?.(); } catch {}
    if (micStream) micStream.getTracks().forEach(track => track.stop());
    if (audioContext) { try { await audioContext.close(); } catch {} }
    audioContext = null; micSource = null; micStream = null; micDestination = null; micGain = null; reverbGain = null; dryGain = null; delayNode = null; delayFeedback = null; delayGain = null; micCompressor = null; voiceFilter = null; processedAudioTrack = null; micPublished = false;
    if ($('liveAudioEnable')) { $('liveAudioEnable').textContent = '🎙️ Mixer aktivieren'; $('liveAudioEnable').dataset.active = 'false'; }
  }
  function changeVoiceEffect() {
    if (!voiceFilter || !audioContext) return;
    const mode = $('liveVoiceEffect')?.value || 'normal';
    voiceFilter.type = mode === 'radio' || mode === 'robot' ? 'bandpass' : 'peaking';
    voiceFilter.frequency.setTargetAtTime(mode === 'radio' ? 1600 : mode === 'robot' ? 900 : mode === 'autotune' ? 1200 : 2500, audioContext.currentTime, .04);
    voiceFilter.Q.setTargetAtTime(mode === 'robot' ? 1.4 : mode === 'autotune' ? 1.2 : .7, audioContext.currentTime, .04);
    voiceFilter.gain.setTargetAtTime(mode === 'autotune' ? 5 : 0, audioContext.currentTime, .04);
    $('liveAudioStatus').textContent = mode === 'autotune' ? 'AutoTune-Stil aktiviert: Klangfärbung, keine echte Tonhöhenkorrektur.' : `Stimmeffekt „${$('liveVoiceEffect').selectedOptions[0].textContent}“ aktiv.`;
  }
  async function connectStream(data, role) {
    if (!window.LivekitClient || !window.LivekitClient.Room) throw new Error('LiveKit-Browser-SDK konnte nicht geladen werden. Bitte Internetverbindung/CDN prüfen.');
    await leaveStream(false);
    currentStream = data.stream; currentRole = role; audioMuted = false; hostMicMuted = false; $('liveAudioMixer')?.classList.add('hidden'); $('liveAudioToggle')?.setAttribute('aria-expanded','false'); if ($('liveAudioToggleIcon')) $('liveAudioToggleIcon').textContent = '＋'; $('liveAudioToggle')?.closest('#liveAudioMixerLauncher')?.classList.toggle('hidden', role !== 'host'); await stopAudioMixer();
    $('liveMuteBtn').textContent = role === 'host' ? '🎙️ Mikrofon aktiv' : '🔊 Ton aktiv'; $('liveMuteBtn').setAttribute('aria-pressed', 'false');
    $('liveStage').classList.remove('hidden'); $('liveStageTitle').textContent = currentStream.title;
    $('liveEndBtn').classList.toggle('hidden', role !== 'host'); $('liveEndBtn').disabled = role !== 'host'; if ($('liveEndTopBtn')) { $('liveEndTopBtn').classList.toggle('hidden', role !== 'host'); $('liveEndTopBtn').disabled = role !== 'host'; } $('liveStartBtn').classList.toggle('hidden', role === 'host');
    $('liveGiftStatus').textContent = ''; if ($('liveOverlayChat')) $('liveOverlayChat').innerHTML = ''; if ($('liveFloatingHearts')) $('liveFloatingHearts').innerHTML = '';
    refreshCandyBalance(); liveLikeCount = Number(data.stream.likes || data.likes || 0); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`; renderGame(data.stream.game); clearInterval(gameUiTimer); gameUiTimer = setInterval(() => { if (currentGame) renderGame(currentGame); }, 1000);
    room = new window.LivekitClient.Room({adaptiveStream: true, dynacast: true});
    room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => renderTrack(track, participant));
    room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => { try { track.detach().forEach(el => el.remove()); } catch {} });
    room.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, participant => document.getElementById(`participant-${String(participant.identity).replace(/[^a-zA-Z0-9_-]/g, '-')}`)?.remove());
    room.on(window.LivekitClient.RoomEvent.Disconnected, () => liveStatus('Verbindung getrennt.'));
    await room.connect(data.serverUrl, data.token);
    if (role === 'host') {
      const quality = $('liveQuality')?.value || '1080';
      if (quality === '2160' && window.LivekitClient.VideoPresets?.h2160 && room.localParticipant.setCameraEnabled) {
        try { await room.localParticipant.setCameraEnabled(true, { resolution: window.LivekitClient.VideoPresets.h2160 }); await room.localParticipant.setMicrophoneEnabled(true); }
        catch (qualityError) { console.warn('4K nicht verfügbar; wechsle auf Standardqualität.', qualityError); await room.localParticipant.enableCameraAndMicrophone(); liveStatus('4K wird von diesem Gerät/Browser nicht unterstützt; Standardqualität aktiv.'); }
      } else { await room.localParticipant.enableCameraAndMicrophone(); if (quality === '2160') liveStatus('Dieses Gerät/SDK meldet kein 4K-Profil; Standardqualität aktiv.'); }
      for (const publication of room.localParticipant.trackPublications.values()) if (publication.track) renderTrack(publication.track, room.localParticipant);
      liveStatus('Du bist live. Kamera und Mikrofon sind aktiv.');
    } else {
      liveStatus('Du siehst ' + currentStream.hostUsername + ' live.');
    }
    if (window.io) {
      chatSocket = window.io(apiBase || undefined, {auth: localStorage.getItem('gametik_token') ? {token: localStorage.getItem('gametik_token')} : {guestLiveRoomId: currentStream.id}});
      chatSocket.on('connect', () => chatSocket.emit('live:join-chat', {roomId: currentStream.id}, result => { if (result?.error) liveStatus(result.error); }));
      chatSocket.on('live:chat-message', message => { if (message.roomId === currentStream?.id) chatLine('@'+message.username, message.body, message.created_at); });
      chatSocket.on('live:gift', gift => { if (gift.roomId === currentStream?.id) chatLine('🎁 @'+gift.username, 'hat '+gift.gift+' gesendet!'+(gift.points ? ` (+${gift.points} Punkte)` : ''), gift.created_at, true); playGameJingle('gift'); });
      chatSocket.on('live:game-state', event => { if (event.roomId === currentStream?.id) renderGame(event.game); });
      chatSocket.on('live:like-count', data => { if (data.roomId === currentStream?.id) { liveLikeCount = Number(data.likes || 0); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`; } });
      chatSocket.on('live:ended', event => { if (event.id === currentStream?.id) { liveStatus('Der Stream wurde beendet.'); leaveStream(false); refreshStreams(); } });
    }
    clearInterval(countTimer); updateCount(); countTimer = setInterval(updateCount, 5000);
  }
  async function updateCount() {
    if (!currentStream) return;
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/count`); $('liveViewerCount').textContent = `👁 ${data.count ?? 0} Zuschauer`; liveLikeCount = Number(data.likes ?? liveLikeCount); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`; }
    catch { $('liveViewerCount').textContent = '👁 Zuschauerzahl nicht verfügbar'; }
  }
  async function leaveStream(hide = true) {
    clearInterval(countTimer); countTimer = null; clearInterval(gameUiTimer); gameUiTimer = null;
    if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
    if (room) { try { await stopAudioMixer(); room.disconnect(); } catch {} room = null; }
    $('liveVideoGrid').innerHTML = '';
    if (hide) $('liveStage').classList.add('hidden');
    currentStream = null; currentRole = ''; audioMuted = false; hostMicMuted = false;
  }
  async function refreshStreams() {
    try {
      const data = await api('/api/live');
      $('liveConfigStatus').textContent = data.enabled ? 'Live-Dienst konfiguriert' : 'LiveKit-Zugangsdaten fehlen';
      $('liveStreams').innerHTML = data.streams.length ? data.streams.map(stream => `<div class="item" style="background:#11111c;border:1px solid #38384e;border-radius:12px;padding:12px"><b>🔴 ${esc(stream.title)}</b><div class="muted tiny">@${esc(stream.hostUsername)}</div><button type="button" class="secondary live-join" data-id="${esc(stream.id)}" style="margin-top:8px">Live ansehen</button></div>`).join('') : '<div class="muted tiny">Aktuell ist niemand live. Starte den ersten Stream!</div>';
    } catch (error) { $('liveConfigStatus').textContent = error.message; $('liveStreams').innerHTML = '<div class="muted tiny">Streams konnten nicht geladen werden.</div>'; }
  }
  $('liveStartBtn').addEventListener('click', async () => {
    if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; }
    const button = $('liveStartBtn'); button.disabled = true;
    try { const data = await api('/api/live/create', {method:'POST', body:JSON.stringify({title:$('liveTitle').value})}); await connectStream(data, 'host'); await refreshStreams(); }
    catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  });
  $('liveRefreshBtn').addEventListener('click', refreshStreams);
  $('liveStreams').addEventListener('click', async event => {
    const button = event.target.closest('.live-join'); if (!button) return;
    if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; }
    button.disabled = true;
    try { const loggedIn = !!localStorage.getItem('gametik_token'); const data = await api(loggedIn ? `/api/live/${encodeURIComponent(button.dataset.id)}/join` : `/api/live/${encodeURIComponent(button.dataset.id)}/guest-join`, {method:'POST', body:'{}'}); await connectStream(data, loggedIn ? 'viewer' : 'guest'); }
    catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  });
  $('liveAudioToggle')?.addEventListener('click', () => {
    const panel = $('liveAudioMixer');
    const open = panel?.classList.contains('hidden');
    if (!panel) return;
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('mixer-open', !!open);
    $('liveAudioToggle')?.setAttribute('aria-expanded', String(!!open));
    if ($('liveAudioToggleIcon')) $('liveAudioToggleIcon').textContent = open ? '−' : '＋';
    if (open) panel.scrollIntoView({behavior:'smooth', block:'nearest'});
  });
  $('liveAudioEnable')?.addEventListener('click', async () => {
    if (!room || currentRole !== 'host') return;
    const button = $('liveAudioEnable');
    try {
      if (micPublished) {
        await stopAudioMixer();
        try { await room.localParticipant.setMicrophoneEnabled(true); } catch {}
        hostMicMuted = false;
        if ($('liveMuteBtn')) { $('liveMuteBtn').textContent = '🎙️ Mikrofon aktiv'; $('liveMuteBtn').setAttribute('aria-pressed','false'); }
        $('liveAudioStatus').textContent = 'Mixer ausgeschaltet. Dein normales Mikrofon ist wieder aktiv. Du kannst den Mixer jederzeit erneut einschalten.';
      } else {
        await room.localParticipant.setMicrophoneEnabled(false);
        await enableAudioMixer();
      }
    } catch (error) { $('liveAudioStatus').textContent = error.message; if (!micPublished) { try { await room.localParticipant.setMicrophoneEnabled(true); } catch {} } }
  });
  ['liveMicVolume','liveReverb','liveDelay'].forEach(id => $(id)?.addEventListener('input', updateAudioMixer));
  $('liveVoiceEffect')?.addEventListener('change', changeVoiceEffect);
  $('liveAudioReset')?.addEventListener('click', () => {
    $('liveMicVolume').value = '100'; $('liveReverb').value = '20'; $('liveDelay').value = '0'; $('liveVoiceEffect').value = 'normal';
    if (voiceFilter) { voiceFilter.type = 'peaking'; voiceFilter.frequency.value = 2500; voiceFilter.Q.value = 1; voiceFilter.gain.value = 0; }
    updateAudioMixer(); $('liveAudioStatus').textContent = 'Mixer-Einstellungen zurückgesetzt.';
  });
  $('liveMuteBtn').addEventListener('click', async () => {
    if (!room || !currentStream) return;
    const button = $('liveMuteBtn');
    button.disabled = true;
    try {
      if (currentRole === 'host') {
        hostMicMuted = !hostMicMuted;
        if (micPublished && processedAudioTrack?.mediaStreamTrack) processedAudioTrack.mediaStreamTrack.enabled = !hostMicMuted;
        else await room.localParticipant.setMicrophoneEnabled(!hostMicMuted);
        button.textContent = hostMicMuted ? '🔇 Mikrofon stumm' : '🎙️ Mikrofon aktiv';
        button.setAttribute('aria-pressed', String(hostMicMuted));
        liveStatus(hostMicMuted ? 'Du bist live. Dein Mikrofon ist stummgeschaltet.' : 'Du bist live. Dein Mikrofon ist aktiv.');
      } else {
        audioMuted = !audioMuted;
        document.querySelectorAll('#liveVideoGrid audio').forEach(element => { element.muted = audioMuted; });
        button.textContent = audioMuted ? '🔇 Ton stumm' : '🔊 Ton aktiv';
        button.setAttribute('aria-pressed', String(audioMuted));
        liveStatus(audioMuted ? 'Der Stream läuft weiter, der Ton ist bei dir stumm.' : 'Du hörst jetzt den Live-Streamer.');
      }
    } catch (error) {
      alert('Stummschaltung konnte nicht geändert werden: ' + error.message);
    } finally { button.disabled = false; }
  });
  $('liveGameStart')?.addEventListener('click', async () => {
    if (!currentStream || currentRole !== 'host') return;
    const button = $('liveGameStart'); button.disabled = true;
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/game/start`, {method:'POST', body:JSON.stringify({seconds:Number($('liveGameDuration').value || 180)})}); renderGame(data.game); }
    catch (error) { $('liveGiftStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('liveGameStop')?.addEventListener('click', async () => {
    if (!currentStream || currentRole !== 'host') return;
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/game/stop`, {method:'POST', body:'{}'}); renderGame(data.game); }
    catch (error) { $('liveGiftStatus').textContent = error.message; }
  });
  async function endCurrentLive() {
    if (!currentStream || currentRole !== 'host') return;
    const streamId = currentStream.id;
    const buttons = [$('liveEndBtn'), $('liveEndTopBtn')].filter(Boolean);
    buttons.forEach(button => { button.disabled = true; button.textContent = '⏳ LIVE wird beendet …'; });
    try {
      await api(`/api/live/${encodeURIComponent(streamId)}/end`, {method:'POST', body:'{}'});
      liveStatus('LIVE wurde beendet.'); await leaveStream(); await refreshStreams();
    } catch (error) {
      $('liveGiftStatus').textContent = 'Stream konnte nicht beendet werden: ' + error.message;
      buttons.forEach(button => { button.disabled = false; button.textContent = '⏹ LIVE BEENDEN'; });
    }
  }
  $('liveEndBtn')?.addEventListener('click', endCurrentLive);
  $('liveEndTopBtn')?.addEventListener('click', endCurrentLive);
  $('liveLeaveBtn').addEventListener('click', async () => { await leaveStream(); await refreshStreams(); });
  $('liveChatForm').addEventListener('submit', event => {
    event.preventDefault(); const body = $('liveChatInput').value.trim();
    if (!currentStream || !chatSocket || !body) return;
    chatSocket.emit('live:chat', {roomId:currentStream.id, body}, result => { if (result?.error) $('liveGiftStatus').textContent = result.error; else $('liveChatInput').value = ''; });
  });
  document.querySelectorAll('.live-gift').forEach(button => button.addEventListener('click', async () => {
    if (!currentStream) return;
    if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; }
    try {
      $('liveGiftStatus').textContent = 'PayPal-Bestellung wird vorbereitet …';
      const data = await api('/api/payments/paypal/create-order', {method:'POST', body:JSON.stringify({gift:button.dataset.gift, liveRoomId:currentStream.id})});
      if (!data.approvalUrl || !/^https:\/\/(www\.)?paypal\.com\//i.test(data.approvalUrl) && !/^https:\/\/www\.sandbox\.paypal\.com\//i.test(data.approvalUrl)) throw new Error('PayPal hat keinen gültigen Freigabe-Link geliefert.');
      location.href = data.approvalUrl;
    } catch (error) { $('liveGiftStatus').textContent = error.message; }
  }));
  document.querySelectorAll('.live-smiley').forEach(button => button.addEventListener('click', () => { const input=$('liveChatInput'); if (!input) return; input.value=(input.value ? input.value+' ' : '')+button.dataset.smiley; input.focus(); }));
  $('liveCandyClaim')?.addEventListener('click', async () => { if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; } try { const d=await api('/api/candy/claim',{method:'POST',body:'{}'}); candyBalanceCache=Number(d.balance||0); $('liveGiftStatus').textContent=`🎉 ${d.awarded} kostenlose Süßigkeiten erhalten!`; await refreshCandyBalance(); playGameJingle('gift'); } catch(e) { $('liveGiftStatus').textContent=e.message; await refreshCandyBalance(); } });
  $('liveCandyGift')?.addEventListener('click', async () => { if (!currentStream) { $('liveGiftStatus').textContent='Öffne zuerst einen LIVE-Stream.'; return; } if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; } const amount=Number(prompt('Wie viele kostenlose Süßigkeiten möchtest du verschenken? (1–20)', '1')); if (!Number.isInteger(amount)||amount<1||amount>20) return; try { const d=await api('/api/candy/gift',{method:'POST',body:JSON.stringify({liveRoomId:currentStream.id,amount})}); $('liveGiftStatus').textContent=`🍬 ${d.spent} Süßigkeiten verschenkt. Dein Guthaben: ${d.balance}`; await refreshCandyBalance(); } catch(e) { $('liveGiftStatus').textContent=e.message; } });
  $('liveCasinoOpen')?.addEventListener('click', async () => { if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; } $('liveCasinoModal')?.classList.remove('hidden'); await refreshCandyBalance(); });
  $('liveCasinoClose')?.addEventListener('click', () => $('liveCasinoModal')?.classList.add('hidden'));
  $('liveCasinoSpin')?.addEventListener('click', async () => {
    const button=$('liveCasinoSpin'), reels=$('liveCasinoReels');
    if (button.disabled) return;
    button.disabled=true; button.textContent='🎰 AUTOMAT DREHT …';
    const symbols=['🍒','🍋','🍇','🍉','🍬','🍭','🍫','🧁','⭐'];
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    try {
      // Visual reel spin first; the server remains the source of truth for the reward.
      for(let i=0;i<24;i++) {
        reels.textContent=[0,1,2].map(()=>symbols[Math.floor(Math.random()*symbols.length)]).join('　');
        reels.style.transform=`translateY(${i%2 ? 3 : -3}px)`;
        reels.style.filter=`blur(${i<18 ? 1.4 : 0}px)`;
        await wait(65 + Math.min(i,18)*5);
      }
      reels.style.transform='translateY(0)'; reels.style.filter='none';
      const d=await api('/api/candy/spin',{method:'POST',body:'{}'});
      const finalSymbols=d.symbols||['🍬','🍭','🍬'];
      reels.textContent=finalSymbols.join('　'); reels.classList.remove('gametik-reel-win');
      if(d.reward) { void reels.offsetWidth; reels.classList.add('gametik-reel-win'); }
      $('liveCasinoResult').textContent=d.reward ? `🎉 GEWONNEN! +${d.reward} kostenlose Süßigkeit(en)!` : 'Diesmal kein Gewinn. Probiere es später erneut.';
      candyBalanceCache=Number(d.balance||0); await refreshCandyBalance(); if(d.reward) playGameJingle('win');
    } catch(e) { $('liveCasinoResult').textContent=e.message; }
    finally { reels.style.transform='translateY(0)'; reels.style.filter='none'; setTimeout(()=>{button.disabled=false;button.textContent='🎰 DREHEN';},1600); }
  });
  document.querySelectorAll('.live-candy-send').forEach(button => button.addEventListener('click', async () => {
    if (!currentStream) { $('liveGiftStatus').textContent='Öffne zuerst einen LIVE-Stream.'; return; }
    if (!localStorage.getItem('gametik_token')) { $('authModal')?.classList.remove('hidden'); return; }
    const amount=Math.max(1,Math.min(20,Number(button.dataset.amount)||1));
    button.disabled=true;
    try { const d=await api('/api/candy/gift',{method:'POST',body:JSON.stringify({liveRoomId:currentStream.id,amount})}); $('liveGiftStatus').textContent=`🍬 ${d.spent} Süßigkeit(en) gesendet! Guthaben: ${d.balance} 🍬`; await refreshCandyBalance(); playGameJingle('gift'); }
    catch(e) { $('liveGiftStatus').textContent=e.message; await refreshCandyBalance(); }
    finally { setTimeout(()=>{button.disabled=false;},500); }
  }));
  refreshCandyBalance();
  async function sendLiveLike() {
    if (!currentStream) return;
    showFloatingHeart();
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/like`, {method:'POST', body:'{}'}); liveLikeCount = Number(data.likes || liveLikeCount); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`; }
    catch (error) { $('liveGiftStatus').textContent = error.message; }
  }
  $('liveLikeBtn')?.addEventListener('click', sendLiveLike);
  $('liveVideoStage')?.addEventListener('click', event => {
    if (event.target.closest('button, input, select, a, form')) return;
    sendLiveLike();
  });
  ['liveBeauty','liveBrightness','liveSaturation'].forEach(id => $(id)?.addEventListener('input', applyCameraEffect));
  async function shareLive() {
    if (!currentStream) return;
    const url = new URL(location.href); url.searchParams.set('live', currentStream.id); url.hash = 'feedView';
    const shareData = {title: 'GameTik LIVE: ' + currentStream.title, text: `Schau @${currentStream.hostUsername} live auf GameTik!`, url: url.toString()};
    try { if (navigator.share) await navigator.share(shareData); else { await navigator.clipboard.writeText(shareData.url); $('liveGiftStatus').textContent = 'Live-Link kopiert. Du kannst ihn jetzt teilen.'; } }
    catch (error) { if (error.name !== 'AbortError') { try { await navigator.clipboard.writeText(shareData.url); $('liveGiftStatus').textContent = 'Live-Link kopiert.'; } catch { prompt('Diesen Live-Link kopieren:', shareData.url); } } }
  }
  $('liveShareBtn')?.addEventListener('click', shareLive);
  $('liveInviteBtn')?.addEventListener('click', async () => {
    if (!currentStream) return;
    const url = new URL(location.href); url.searchParams.set('live', currentStream.id);
    const text = `Schau meinen GameTik-Livestream: ${url.toString()}`;
    const encoded = encodeURIComponent(text); const options = [
      ['WhatsApp', `https://wa.me/?text=${encoded}`], ['TikTok', 'https://www.tiktok.com/'], ['Instagram', 'https://www.instagram.com/']
    ];
    const status = $('liveGiftStatus');
    if (navigator.share) { try { await navigator.share({title:'GameTik LIVE',text,url:url.toString()}); return; } catch(e) { if(e.name==='AbortError')return; } }
    status.innerHTML = options.map(([label,href]) => `<a href="${href}" target="_blank" rel="noopener noreferrer" style="margin-right:12px">${label}</a>`).join('') + `<button type="button" class="secondary" id="copyLiveInvite">Link kopieren</button>`;
    $('copyLiveInvite')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url.toString()); status.textContent = 'Live-Link kopiert.'; } catch { prompt('Live-Link kopieren:',url.toString()); } });
  });
  $('liveEffect')?.addEventListener('change', applyCameraEffect);
  $('liveQuality')?.addEventListener('change', () => { if (currentRole === 'host') $('liveGiftStatus').textContent = 'Die Qualitätsänderung gilt beim nächsten Start des Streams. 4K hängt von Kamera, Browser, Upload und LiveKit ab.'; });
  // Shared live links can open as a guest without requiring a GameTik account.
  const sharedLiveId = new URLSearchParams(location.search).get('live');
  refreshStreams().then(async () => {
    if (!sharedLiveId) return;
    try { const data = await api(localStorage.getItem('gametik_token') ? `/api/live/${encodeURIComponent(sharedLiveId)}/join` : `/api/live/${encodeURIComponent(sharedLiveId)}/guest-join`, {method:'POST', body:'{}'}); await connectStream(data, localStorage.getItem('gametik_token') ? 'viewer' : 'guest'); }
    catch (error) { $('liveConfigStatus').textContent = error.message; }
  });
  function endHostLiveOnExit() {
    if (currentRole !== 'host' || !currentStream?.id) return;
    const token = localStorage.getItem('gametik_token') || '';
    try { fetch(apiBase + '/api/live/' + encodeURIComponent(currentStream.id) + '/end', {method:'POST', keepalive:true, headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})}, body:'{}'}).catch(()=>{}); } catch {}
  }
  window.addEventListener('pagehide', endHostLiveOnExit);
  window.addEventListener('beforeunload', () => { endHostLiveOnExit(); try { micStream?.getTracks().forEach(track => track.stop()); audioContext?.close(); room?.disconnect(); chatSocket?.disconnect(); } catch {} });
})();
