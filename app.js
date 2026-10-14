(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('gametik_token') || '';
  let me = null, socket = null, chatMode = 'public', privateRecipientId = '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path, options={}) {
    const headers = {...(options.headers||{})};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {...options, headers});
    const data = await res.json().catch(()=>({error:'Ungültige Serverantwort'}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }
  function status(id, msg, ok=false) { const el=$(id); el.className='status '+(ok?'ok':'error'); el.textContent=msg; }
  function showView(name) {
    ['feed','upload','chat','profile'].forEach(v => $(v+'View').classList.toggle('hidden',v!==name));
    document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    if(name==='chat' && !socket && token) connectChat();
    if(name==='profile') loadProfile();
    if(name==='feed') loadFeed();
  }
  document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('refreshFeed').onclick=loadFeed;
  function updateAuthUI() {
    $('userLabel').textContent = me ? '@'+me.username : 'Nicht angemeldet';
    $('authOpen').textContent = me ? 'Profil' : 'Nickname wählen';
    $('logoutBtn').classList.toggle('hidden',!me);
    $('avatarForm').classList.toggle('hidden',!me);
  }
  async function restoreSession() {
    if(!token){updateAuthUI();return;}
    try { const d=await api('/api/me'); me=d.user; } catch(e) { token=''; localStorage.removeItem('gametik_token'); me=null; }
    updateAuthUI();
  }
  $('authOpen').onclick=()=>{ if(me){showView('profile');return;} $('authModal').classList.remove('hidden'); };
  $('authClose').onclick=()=> $('authModal').classList.add('hidden');
  $('authForm').onsubmit=async e=>{e.preventDefault();$('authSubmit').disabled=true;try{const d=await api('/api/guest',{method:'POST',body:JSON.stringify({nickname:$('authUsername').value.trim()})});token=d.token;localStorage.setItem('gametik_token',token);me=d.user;updateAuthUI();$('authModal').classList.add('hidden');if(socket){socket.disconnect();socket=null;}connectChat();showView('feed');}catch(err){status('authStatus',err.message);}finally{$('authSubmit').disabled=false;}};
  $('logoutBtn').onclick=async()=>{try{if(token)await api('/api/auth/logout',{method:'POST'});}catch(e){}finally{token='';me=null;localStorage.removeItem('gametik_token');if(socket){socket.disconnect();socket=null;}privateRecipientId='';updateAuthUI();loadProfile();showView('feed');$('authModal').classList.remove('hidden');}};
  async function loadProfile(){if(!me){$('profileDetails').textContent='Wähle einen Nickname, um dein Gastprofil zu verwenden.';return;}try{const d=await api('/api/me');me=d.user;$('profileDetails').innerHTML=`<div class="row"><div class="avatar">${me.avatar_url?`<img class="avatar" src="${esc(me.avatar_url)}" alt="Profilbild">`:esc(me.username.slice(0,1).toUpperCase())}</div><div><b>@${esc(me.username)}</b><div class="muted tiny">${esc(me.email||'Keine E-Mail hinterlegt')}</div><div class="muted tiny">Mitglied seit ${new Date(me.created_at).toLocaleDateString()}</div></div></div>`;updateAuthUI();}catch(e){$('profileDetails').textContent=e.message;}}
  $('avatarForm').onsubmit=async e=>{e.preventDefault();const f=$('avatarFile').files[0];if(!f)return;if(f.size>3*1024*1024){status('avatarStatus','Das Bild darf höchstens 3 MB groß sein.');return;}const fd=new FormData();fd.append('avatar',f);try{const d=await api('/api/me/avatar',{method:'POST',body:fd});me=d.user;status('avatarStatus','Profilbild gespeichert.',true);loadProfile();}catch(err){status('avatarStatus',err.message);}};
  async function loadFeed(){const el=$('feed');try{const d=await api('/api/videos');if(!d.videos.length){el.innerHTML='<div class="empty">Noch keine Videos. Melde dich an und lade den ersten Clip hoch!</div>';return;}el.innerHTML=d.videos.map(v=>`<article class="video-card" data-video="${v.id}"><div class="video-head"><div class="avatar">${v.avatar_url?`<img class="avatar" src="${esc(v.avatar_url)}" alt="">`:esc(v.username.slice(0,1).toUpperCase())}</div><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div>${me&&me.id!==v.user_id?`<button class="secondary follow-btn" data-user="${v.user_id}">${v.following?'Folge ich':'Folgen'}</button>`:''}</div><video src="${esc(v.video_url)}" controls playsinline preload="metadata" loop></video><div class="video-meta"><div>${esc(v.caption||'')}</div><div class="actions"><button class="secondary like-btn" data-id="${v.id}">♥ ${v.like_count}</button><button class="secondary comments-btn" data-id="${v.id}">💬 ${v.comment_count} Kommentare</button><button class="secondary gift-video" data-id="${v.id}">🎁 Geschenk</button></div><div class="comment-area hidden" id="comments-${v.id}"><div class="comment-list"></div><form class="comment-form row" data-id="${v.id}"><input maxlength="500" placeholder="Kommentar schreiben …" required><button>Senden</button></form></div></div></article>`).join('');}catch(e){el.innerHTML=`<div class="empty">Feed konnte nicht geladen werden: ${esc(e.message)}<br>Prüfe, ob der Server läuft.</div>`;}}
  $('feed').addEventListener('click',async e=>{const like=e.target.closest('.like-btn');const follow=e.target.closest('.follow-btn');const cm=e.target.closest('.comments-btn');const gift=e.target.closest('.gift-video');try{if(like){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');await api(`/api/videos/${like.dataset.id}/like`,{method:'POST'});loadFeed();}if(follow){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api(`/api/users/${follow.dataset.user}/follow`,{method:'POST'});follow.textContent=d.following?'Folge ich':'Folgen';}if(cm){const area=$('comments-'+cm.dataset.id);area.classList.toggle('hidden');if(!area.classList.contains('hidden')){const d=await api(`/api/videos/${cm.dataset.id}/comments`);area.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('')||'<div class="muted tiny">Noch keine Kommentare.</div>';}}if(gift){if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname.');}await startPayPalCheckout('Herz', Number(gift.dataset.id));}}catch(err){alert(err.message);}});
  $('feed').addEventListener('submit',async e=>{if(!e.target.matches('.comment-form'))return;e.preventDefault();try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const id=e.target.dataset.id, input=e.target.querySelector('input');await api(`/api/videos/${id}/comments`,{method:'POST',body:JSON.stringify({body:input.value})});input.value='';const d=await api(`/api/videos/${id}/comments`);e.target.parentElement.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('');}catch(err){alert(err.message);}});
  $('uploadForm').onsubmit=async e=>{e.preventDefault();const f=$('videoFile').files[0];if(!f)return;if(f.size>35*1024*1024){status('uploadStatus','Das Video ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}const fd=new FormData();fd.append('video',f);fd.append('caption',$('videoCaption').value);try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api('/api/videos',{method:'POST',body:fd});status('uploadStatus','Video erfolgreich hochgeladen!',true);$('uploadForm').reset();showView('feed');}catch(err){status('uploadStatus',err.message);}};
  function connectChat(){
    if(!token||!window.io)return;
    if(socket){if(socket.connected)return;socket.disconnect();}
    socket=io({auth:{token}});
    socket.on('connect',()=>$('chatStatus').textContent='Live verbunden');
    socket.on('connect_error',e=>$('chatStatus').textContent='Chat-Verbindung fehlgeschlagen: '+e.message);
    socket.on('disconnect',()=>$('chatStatus').textContent='Verbindung unterbrochen');
    socket.on('chat:history',messages=>{if(chatMode==='public'){$('chatMessages').innerHTML='';messages.forEach(addChat);}});
    socket.on('chat:message',m=>{if(chatMode==='public')addChat(m);});
    socket.on('private:message',m=>{
      if(chatMode!=='private'||!privateRecipientId)return;
      if((m.fromId===privateRecipientId&&m.toId===me.id)||(m.fromId===me.id&&m.toId===privateRecipientId))addPrivateMessage(m);
    });
  }
  function addChat(m){
    const el=document.createElement('div');el.className='chat-line';
    el.innerHTML=`<b>@${esc(m.username)}</b> ${esc(m.body)} <span class="muted tiny">${new Date(m.created_at).toLocaleTimeString()}</span>`;
    $('chatMessages').appendChild(el);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;
  }
  function addPrivateMessage(m){
    if(m.id && $('chatMessages').querySelector('[data-message-id="'+CSS.escape(m.id)+'"]'))return;
    const el=document.createElement('div');el.className='chat-line';el.dataset.messageId=m.id||'';
    const mine=m.fromId===me.id, sender=mine?'Du':'@'+(m.fromUsername||'Mitglied');
    el.innerHTML=`<b>${esc(sender)}</b> ${esc(m.body)} <span class="muted tiny">${new Date(m.created_at).toLocaleTimeString()}</span>`;
    $('chatMessages').appendChild(el);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;
  }
  async function loadMembers(){
    if(!token){$('privateRecipient').innerHTML='<option value="">Bitte zuerst Nickname wählen</option>';return;}
    try{
      const d=await api('/api/members');
      const select=$('privateRecipient');
      select.innerHTML='<option value="">Mitglied auswählen …</option>';
      d.members.forEach(u=>{const opt=document.createElement('option');opt.value=u.id;opt.textContent='@'+u.username;select.appendChild(opt);});
      if(privateRecipientId&&d.members.some(u=>u.id===privateRecipientId))select.value=privateRecipientId;
      if(!d.members.length)select.innerHTML='<option value="">Noch keine anderen Mitglieder online</option>';
    }catch(e){$('chatStatus').textContent=e.message;}
  }
  async function loadPrivateHistory(){
    $('chatMessages').innerHTML='';
    if(!privateRecipientId){$('privateChatHint').textContent='Wähle einen Nutzer, um die private Unterhaltung zu öffnen.';return;}
    const opt=$('privateRecipient').selectedOptions[0];
    $('privateChatHint').textContent='Private Unterhaltung mit '+(opt?opt.textContent:'ausgewähltem Mitglied')+'.';
    try{const d=await api('/api/messages/'+encodeURIComponent(privateRecipientId));d.messages.forEach(addPrivateMessage);}
    catch(e){$('chatStatus').textContent=e.message;}
  }
  function setChatMode(mode){
    chatMode=mode;
    $('privateChatLayout').classList.toggle('hidden',mode!=='private');
    $('publicChatTab').classList.toggle('active',mode==='public');
    $('privateChatTab').classList.toggle('active',mode==='private');
    $('chatMessages').innerHTML='';
    if(mode==='private'){loadMembers().then(loadPrivateHistory);}
    else $('chatStatus').textContent='Öffentlicher Chat – alle angemeldeten Nutzer können mitlesen.';
  }
  $('publicChatTab').onclick=()=>setChatMode('public');
  $('privateChatTab').onclick=()=>{if(!token){$('authModal').classList.remove('hidden');$('chatStatus').textContent='Bitte zuerst einen Nickname wählen.';return;}setChatMode('private');if(!socket||!socket.connected)connectChat();};
  $('refreshMembers').onclick=()=>loadMembers();
  $('privateRecipient').onchange=()=>{privateRecipientId=$('privateRecipient').value;loadPrivateHistory();};
  $('chatForm').onsubmit=e=>{
    e.preventDefault();
    if(!token){$('authModal').classList.remove('hidden');$('chatStatus').textContent='Bitte zuerst Nickname wählen.';return;}
    const body=$('chatInput').value.trim();if(!body)return;
    if(chatMode==='private'&&!privateRecipientId){$('chatStatus').textContent='Bitte zuerst ein Mitglied auswählen.';return;}
    if(!socket||!socket.connected){connectChat();$('chatStatus').textContent='Chat verbindet sich. Bitte gleich erneut senden.';return;}
    if(chatMode==='private'){
      socket.emit('private:send',{toId:privateRecipientId,body},ack=>{
        if(ack&&ack.error){$('chatStatus').textContent=ack.error;return;}
        $('chatInput').value='';
        if(ack&&ack.message)addPrivateMessage(ack.message);
        $('chatStatus').textContent='Private Nachricht gesendet.';
      });
    }else{
      socket.emit('chat:send',body,ack=>{if(ack&&ack.error)$('chatStatus').textContent=ack.error;else $('chatInput').value='';});
    }
  };
  async function startPayPalCheckout(giftName, videoId=null){
    const statusEl=$('giftStatus');
    if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname.');}
    if(statusEl)statusEl.textContent='PayPal-Bestellung wird vorbereitet …';
    const payload={gift:giftName};
    if(videoId!==null && Number.isFinite(videoId))payload.videoId=videoId;
    const result=await api('/api/payments/paypal/create-order',{method:'POST',body:JSON.stringify(payload)});
    if(!result.approvalUrl || !/^https:\/\/(www\.)?paypal\.com\//i.test(result.approvalUrl) && !/^https:\/\/www\.sandbox\.paypal\.com\//i.test(result.approvalUrl)){
      throw Error('PayPal hat keinen gültigen Zahlungslink geliefert.');
    }
    window.location.assign(result.approvalUrl);
  }
  document.querySelectorAll('[data-gift]').forEach(b=>b.onclick=async()=>{
    try{
      b.disabled=true;
      const videoCard=b.closest('[data-video]');
      await startPayPalCheckout(b.dataset.gift,videoCard?Number(videoCard.dataset.video):null);
    }catch(e){if($('giftStatus'))$('giftStatus').textContent=e.message;else alert(e.message);}finally{b.disabled=false;}
  });
  async function handlePayPalReturn(){
    const params=new URLSearchParams(window.location.search);
    const outcome=params.get('paypal');
    if(outcome==='cancel'){
      if($('giftStatus'))$('giftStatus').textContent='PayPal-Zahlung wurde abgebrochen. Es wurde kein Geschenk verbucht.';
      history.replaceState({},'',window.location.pathname+window.location.hash);
      return;
    }
    if(outcome!=='success')return;
    const orderID=params.get('token');
    if(!orderID){if($('giftStatus'))$('giftStatus').textContent='PayPal-Rückkehr ohne Bestellnummer. Bitte Support kontaktieren.';return;}
    if(!token){if($('giftStatus'))$('giftStatus').textContent='Bitte melde dich mit demselben Gastprofil erneut an, um die Zahlung zu bestätigen.';return;}
    try{
      if($('giftStatus'))$('giftStatus').textContent='PayPal-Zahlung wird bestätigt …';
      const result=await api('/api/payments/paypal/capture-order',{method:'POST',body:JSON.stringify({orderID})});
      if($('giftStatus'))$('giftStatus').textContent='✅ Zahlung bestätigt. Geschenk '+result.gift+' wurde verbucht.';
    }catch(e){if($('giftStatus'))$('giftStatus').textContent='Zahlung konnte nicht bestätigt werden: '+e.message;}
    finally{history.replaceState({},'',window.location.pathname+window.location.hash);}
  }
  async function loadConfig(){
    try{
      const d=await api('/api/config');
      if(d.paypalUrl){
        try { const url=new URL(d.paypalUrl); if(url.protocol==='https:' && (url.hostname==='paypal.com' || url.hostname.endsWith('.paypal.com') || url.hostname==='paypal.me')) $('paypalLink').href=url.href; else throw new Error('Ungültiger PayPal-Link'); }
        catch { $('paypalLink').removeAttribute('href'); $('paypalLink').onclick=e=>{e.preventDefault();alert('Der Betreiber muss einen gültigen HTTPS-PayPal-Link auf Render eintragen.');}; }
      } else {$('paypalLink').removeAttribute('href');$('paypalLink').onclick=e=>{e.preventDefault();alert('Der Betreiber muss den PayPal-Spendenlink auf Render eintragen.');};}
    }catch(e){}
  }

  restoreSession().then(()=>{loadConfig();loadFeed();if(token)connectChat();else $('authModal').classList.remove('hidden');return handlePayPalReturn();}).catch(e=>{if($('giftStatus'))$('giftStatus').textContent='Initialisierung fehlgeschlagen: '+e.message;});
})();
