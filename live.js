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
  let currentStream = null, currentRole = '', room = null, chatSocket = null, countTimer = null, liveLikeCount = 0, audioMuted = false, hostMicMuted = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function liveStatus(message) { $('liveStageStatus').textContent = message; }
  function chatLine(username, body, time = new Date().toISOString(), gift = false) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4px 2px;overflow-wrap:anywhere;' + (gift ? 'color:#f9a8d4;font-weight:700' : '');
    el.innerHTML = `<b>${esc(username)}</b> ${esc(body)} <span class="muted tiny">${new Date(time).toLocaleTimeString()}</span>`;
    $('liveChatMessages').appendChild(el); $('liveChatMessages').scrollTop = $('liveChatMessages').scrollHeight;
  }
  function applyCameraEffect() {
    const effect = $('liveEffect')?.value || 'none';
    const filters = { none:'none', soft:'brightness(1.04) contrast(.96) saturate(1.04)', glow:'brightness(1.12) contrast(.98) saturate(1.12)', warm:'sepia(.18) saturate(1.16) brightness(1.04)', mono:'grayscale(1)', vivid:'saturate(1.45) contrast(1.08)' };
    const localId = room?.localParticipant?.identity;
    document.querySelectorAll('#liveVideoGrid video').forEach(video => {
      const isLocal = video.closest('[id^="participant-"]')?.id === `participant-${String(localId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      if (isLocal) video.style.filter = filters[effect] || 'none';
    });
  }
  function renderTrack(track, participant) {
    const grid = $('liveVideoGrid');
    const key = `participant-${String(participant.identity).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    let card = document.getElementById(key);
    if (!card) {
      card = document.createElement('div'); card.id = key;
      card.style.cssText = 'min-height:150px;background:#07070d;border:1px solid #38384e;border-radius:12px;overflow:hidden;position:relative';
      const label = document.createElement('div'); label.textContent = participant.name || participant.identity; label.style.cssText = 'padding:6px 9px;background:#141421;font-size:12px';
      card.appendChild(label); grid.appendChild(card);
    }
    const element = track.attach();
    if (track.kind === window.LivekitClient.Track.Kind.Audio) element.muted = audioMuted;
    element.style.cssText = 'width:100%;max-height:52vh;min-height:130px;object-fit:contain;background:#05050a;display:block';
    if (track.kind === window.LivekitClient.Track.Kind.Audio) element.style.display = 'none';
    card.appendChild(element);
    applyCameraEffect();
  }
  async function connectStream(data, role) {
    if (!window.LivekitClient || !window.LivekitClient.Room) throw new Error('LiveKit-Browser-SDK konnte nicht geladen werden. Bitte Internetverbindung/CDN prüfen.');
    await leaveStream(false);
    currentStream = data.stream; currentRole = role; audioMuted = false; hostMicMuted = false;
    $('liveMuteBtn').textContent = role === 'host' ? '🎙️ Mikrofon aktiv' : '🔊 Ton aktiv'; $('liveMuteBtn').setAttribute('aria-pressed', 'false');
    $('liveStage').classList.remove('hidden'); $('liveStageTitle').textContent = currentStream.title;
    $('liveEndBtn').classList.toggle('hidden', role !== 'host'); $('liveStartBtn').classList.toggle('hidden', role === 'host');
    $('liveGiftStatus').textContent = '';
    liveLikeCount = Number(data.stream.likes || data.likes || 0); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`;
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
      chatSocket.on('live:gift', gift => { if (gift.roomId === currentStream?.id) chatLine('🎁 @'+gift.username, 'hat '+gift.gift+' gesendet!', gift.created_at, true); });
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
    clearInterval(countTimer); countTimer = null;
    if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
    if (room) { try { room.disconnect(); } catch {} room = null; }
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
  $('liveMuteBtn').addEventListener('click', async () => {
    if (!room || !currentStream) return;
    const button = $('liveMuteBtn');
    button.disabled = true;
    try {
      if (currentRole === 'host') {
        hostMicMuted = !hostMicMuted;
        await room.localParticipant.setMicrophoneEnabled(!hostMicMuted);
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
  $('liveEndBtn').addEventListener('click', async () => {
    if (!currentStream || currentRole !== 'host') return;
    try { await api(`/api/live/${encodeURIComponent(currentStream.id)}/end`, {method:'POST', body:'{}'}); await leaveStream(); await refreshStreams(); }
    catch (error) { alert(error.message); }
  });
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
  $('liveLikeBtn')?.addEventListener('click', async () => {
    if (!currentStream) return;
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/like`, {method:'POST', body:'{}'}); liveLikeCount = Number(data.likes || liveLikeCount); $('liveLikeCount').textContent = `❤️ ${liveLikeCount} Likes`; }
    catch (error) { $('liveGiftStatus').textContent = error.message; }
  });
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
  window.addEventListener('beforeunload', () => { try { room?.disconnect(); chatSocket?.disconnect(); } catch {} });
})();
