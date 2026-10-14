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
  let currentStream = null, currentRole = '', room = null, chatSocket = null, countTimer = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function liveStatus(message) { $('liveStageStatus').textContent = message; }
  function chatLine(username, body, time = new Date().toISOString(), gift = false) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4px 2px;overflow-wrap:anywhere;' + (gift ? 'color:#f9a8d4;font-weight:700' : '');
    el.innerHTML = `<b>${esc(username)}</b> ${esc(body)} <span class="muted tiny">${new Date(time).toLocaleTimeString()}</span>`;
    $('liveChatMessages').appendChild(el); $('liveChatMessages').scrollTop = $('liveChatMessages').scrollHeight;
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
    element.style.cssText = 'width:100%;max-height:52vh;min-height:130px;object-fit:contain;background:#05050a;display:block';
    if (track.kind === window.LivekitClient.Track.Kind.Audio) element.style.display = 'none';
    card.appendChild(element);
  }
  async function connectStream(data, role) {
    if (!window.LivekitClient || !window.LivekitClient.Room) throw new Error('LiveKit-Browser-SDK konnte nicht geladen werden. Bitte Internetverbindung/CDN prüfen.');
    await leaveStream(false);
    currentStream = data.stream; currentRole = role;
    $('liveStage').classList.remove('hidden'); $('liveStageTitle').textContent = currentStream.title;
    $('liveEndBtn').classList.toggle('hidden', role !== 'host'); $('liveStartBtn').classList.toggle('hidden', role === 'host');
    $('liveGiftStatus').textContent = '';
    room = new window.LivekitClient.Room({adaptiveStream: true, dynacast: true});
    room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => renderTrack(track, participant));
    room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => { try { track.detach().forEach(el => el.remove()); } catch {} });
    room.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, participant => document.getElementById(`participant-${String(participant.identity).replace(/[^a-zA-Z0-9_-]/g, '-')}`)?.remove());
    room.on(window.LivekitClient.RoomEvent.Disconnected, () => liveStatus('Verbindung getrennt.'));
    await room.connect(data.serverUrl, data.token);
    if (role === 'host') {
      await room.localParticipant.enableCameraAndMicrophone();
      for (const publication of room.localParticipant.trackPublications.values()) if (publication.track) renderTrack(publication.track, room.localParticipant);
      liveStatus('Du bist live. Kamera und Mikrofon sind aktiv.');
    } else {
      liveStatus('Du siehst ' + currentStream.hostUsername + ' live.');
    }
    if (window.io) {
      chatSocket = window.io(apiBase || undefined, {auth:{token: localStorage.getItem('gametik_token') || ''}});
      chatSocket.on('connect', () => chatSocket.emit('live:join-chat', {roomId: currentStream.id}, result => { if (result?.error) liveStatus(result.error); }));
      chatSocket.on('live:chat-message', message => { if (message.roomId === currentStream?.id) chatLine('@'+message.username, message.body, message.created_at); });
      chatSocket.on('live:gift', gift => { if (gift.roomId === currentStream?.id) chatLine('🎁 @'+gift.username, 'hat '+gift.gift+' gesendet!', gift.created_at, true); });
      chatSocket.on('live:ended', event => { if (event.id === currentStream?.id) { liveStatus('Der Stream wurde beendet.'); leaveStream(false); refreshStreams(); } });
    }
    clearInterval(countTimer); updateCount(); countTimer = setInterval(updateCount, 5000);
  }
  async function updateCount() {
    if (!currentStream) return;
    try { const data = await api(`/api/live/${encodeURIComponent(currentStream.id)}/count`); $('liveViewerCount').textContent = `👁 ${data.count ?? 0} Zuschauer`; }
    catch { $('liveViewerCount').textContent = '👁 Zuschauerzahl nicht verfügbar'; }
  }
  async function leaveStream(hide = true) {
    clearInterval(countTimer); countTimer = null;
    if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
    if (room) { try { room.disconnect(); } catch {} room = null; }
    $('liveVideoGrid').innerHTML = '';
    if (hide) $('liveStage').classList.add('hidden');
    currentStream = null; currentRole = '';
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
    try { const data = await api(`/api/live/${encodeURIComponent(button.dataset.id)}/join`, {method:'POST', body:'{}'}); await connectStream(data, 'viewer'); }
    catch (error) { alert(error.message); }
    finally { button.disabled = false; }
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
  refreshStreams();
  window.addEventListener('beforeunload', () => { try { room?.disconnect(); chatSocket?.disconnect(); } catch {} });
})();
