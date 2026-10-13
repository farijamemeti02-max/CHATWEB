(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('gametik_token') || '';
  let me = null, socket = null;
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
  $('logoutBtn').onclick=()=>{token='';me=null;localStorage.removeItem('gametik_token');if(socket){socket.disconnect();socket=null;}updateAuthUI();loadProfile();showView('feed');$('authModal').classList.remove('hidden');};
  async function loadProfile(){if(!me){$('profileDetails').textContent='Wähle einen Nickname, um dein Gastprofil zu verwenden.';return;}try{const d=await api('/api/me');me=d.user;$('profileDetails').innerHTML=`<div class="row"><div class="avatar">${me.avatar_url?`<img class="avatar" src="${esc(me.avatar_url)}" alt="Profilbild">`:esc(me.username.slice(0,1).toUpperCase())}</div><div><b>@${esc(me.username)}</b><div class="muted tiny">${esc(me.email||'Keine E-Mail hinterlegt')}</div><div class="muted tiny">Mitglied seit ${new Date(me.created_at).toLocaleDateString()}</div></div></div>`;updateAuthUI();}catch(e){$('profileDetails').textContent=e.message;}}
  $('avatarForm').onsubmit=async e=>{e.preventDefault();const f=$('avatarFile').files[0];if(!f)return;if(f.size>3*1024*1024){status('avatarStatus','Das Bild darf höchstens 3 MB groß sein.');return;}const fd=new FormData();fd.append('avatar',f);try{const d=await api('/api/me/avatar',{method:'POST',body:fd});me=d.user;status('avatarStatus','Profilbild gespeichert.',true);loadProfile();}catch(err){status('avatarStatus',err.message);}};
  async function loadFeed(){const el=$('feed');try{const d=await api('/api/videos');if(!d.videos.length){el.innerHTML='<div class="empty">Noch keine Videos. Melde dich an und lade den ersten Clip hoch!</div>';return;}el.innerHTML=d.videos.map(v=>`<article class="video-card" data-video="${v.id}"><div class="video-head"><div class="avatar">${v.avatar_url?`<img class="avatar" src="${esc(v.avatar_url)}" alt="">`:esc(v.username.slice(0,1).toUpperCase())}</div><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div>${me&&me.id!==v.user_id?`<button class="secondary follow-btn" data-user="${v.user_id}">${v.following?'Folge ich':'Folgen'}</button>`:''}</div><video src="${esc(v.video_url)}" controls playsinline preload="metadata" loop></video><div class="video-meta"><div>${esc(v.caption||'')}</div><div class="actions"><button class="secondary like-btn" data-id="${v.id}">♥ ${v.like_count}</button><button class="secondary comments-btn" data-id="${v.id}">💬 ${v.comment_count} Kommentare</button><button class="secondary gift-video" data-id="${v.id}">🎁 Geschenk</button></div><div class="comment-area hidden" id="comments-${v.id}"><div class="comment-list"></div><form class="comment-form row" data-id="${v.id}"><input maxlength="500" placeholder="Kommentar schreiben …" required><button>Senden</button></form></div></div></article>`).join('');}catch(e){el.innerHTML=`<div class="empty">Feed konnte nicht geladen werden: ${esc(e.message)}<br>Prüfe, ob der Server läuft.</div>`;}}
  $('feed').addEventListener('click',async e=>{const like=e.target.closest('.like-btn');const follow=e.target.closest('.follow-btn');const cm=e.target.closest('.comments-btn');const gift=e.target.closest('.gift-video');try{if(like){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');await api(`/api/videos/${like.dataset.id}/like`,{method:'POST'});loadFeed();}if(follow){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api(`/api/users/${follow.dataset.user}/follow`,{method:'POST'});follow.textContent=d.following?'Folge ich':'Folgen';}if(cm){const area=$('comments-'+cm.dataset.id);area.classList.toggle('hidden');if(!area.classList.contains('hidden')){const d=await api(`/api/videos/${cm.dataset.id}/comments`);area.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('')||'<div class="muted tiny">Noch keine Kommentare.</div>';}}if(gift){if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname.');}await api('/api/gifts',{method:'POST',body:JSON.stringify({videoId:Number(gift.dataset.id),gift:'Herz'})});alert('🎁 Demo-Geschenk gespeichert. Es wurde kein Geld abgebucht.');}}catch(err){alert(err.message);}});
  $('feed').addEventListener('submit',async e=>{if(!e.target.matches('.comment-form'))return;e.preventDefault();try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const id=e.target.dataset.id, input=e.target.querySelector('input');await api(`/api/videos/${id}/comments`,{method:'POST',body:JSON.stringify({body:input.value})});input.value='';const d=await api(`/api/videos/${id}/comments`);e.target.parentElement.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('');}catch(err){alert(err.message);}});
  $('uploadForm').onsubmit=async e=>{e.preventDefault();const f=$('videoFile').files[0];if(!f)return;if(f.size>5*1024*1024){status('uploadStatus','Das Video ist größer als 5 MB. Bitte eine kleinere Datei wählen.');return;}const fd=new FormData();fd.append('video',f);fd.append('caption',$('videoCaption').value);try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api('/api/videos',{method:'POST',body:fd});status('uploadStatus','Video erfolgreich hochgeladen!',true);$('uploadForm').reset();showView('feed');}catch(err){status('uploadStatus',err.message);}};
  function connectChat(){if(!token||!window.io)return;socket=io({auth:{token}});socket.on('connect',()=>$('chatStatus').textContent='Verbunden');socket.on('connect_error',e=>$('chatStatus').textContent='Chat-Verbindung fehlgeschlagen: '+e.message);socket.on('chat:history',messages=>{ $('chatMessages').innerHTML='';messages.forEach(addChat); });socket.on('chat:message',addChat);}
  function addChat(m){const el=document.createElement('div');el.className='chat-line';el.innerHTML=`<b>@${esc(m.username)}</b> ${esc(m.body)} <span class="muted tiny">${new Date(m.created_at).toLocaleTimeString()}</span>`;$('chatMessages').appendChild(el);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;}
  $('chatForm').onsubmit=e=>{e.preventDefault();if(!token){$('authModal').classList.remove('hidden');$('chatStatus').textContent='Bitte zuerst Nickname wählen.';return;}const body=$('chatInput').value.trim();if(!body)return;if(!socket||!socket.connected){connectChat();$('chatStatus').textContent='Verbinde Chat – bitte gleich erneut senden.';return;}socket.emit('chat:send',body,ack=>{if(ack&&ack.error)$('chatStatus').textContent=ack.error;else $('chatInput').value='';});};
  document.querySelectorAll('[data-gift]').forEach(b=>b.onclick=async()=>{
    try{
      if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname. Danach kannst du das Geschenk kaufen.');}
      b.disabled=true;
      const videoCard=b.closest('[data-video]');
      const body={gift:b.dataset.gift};
      if(videoCard)body.videoId=Number(videoCard.dataset.video);
      await api('/api/gifts',{method:'POST',body:JSON.stringify(body)});
      $('giftStatus').textContent='🎁 Demo-Geschenk '+b.dataset.gift+' gespeichert. Es wurde kein Geld abgebucht.';
    }catch(e){$('giftStatus').textContent=e.message;}finally{b.disabled=false;}
  });
  async function loadConfig(){
    try{
      const d=await api('/api/config');
      if(d.paypalUrl){$('paypalLink').href=d.paypalUrl;}
      else{$('paypalLink').onclick=e=>{e.preventDefault();alert('Der Betreiber muss den PayPal-Spendenlink auf Render eintragen.');};}
    }catch(e){}
  }

  restoreSession().then(()=>{loadConfig();loadFeed();if(token)connectChat();else $('authModal').classList.remove('hidden');});
})();
