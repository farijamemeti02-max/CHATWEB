(() => {
  const $ = id => document.getElementById(id);
  // Netlify-Frontend -> Render-API. On Render itself, same-origin paths are used.
  const host = location.hostname;
  const onRender = host.endsWith('.onrender.com');
  const localWebServer = ['localhost', '127.0.0.1'].includes(host) && /^https?:$/.test(location.protocol);
  const API_BASE = window.GAMETIK_API_BASE || ((onRender || localWebServer) ? '' : 'https://chatweb-iajl.onrender.com');
  const apiUrl = path => /^https?:\/\//i.test(path) ? path : API_BASE + path;
  const mediaUrl = path => path && path.startsWith('/uploads/') ? API_BASE + path : (path || '');
  let token = localStorage.getItem('gametik_token') || '';
  let me = null, socket = null, chatMode = 'public', privateRecipientId = '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path, options={}) {
    const headers = {...(options.headers||{})};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(apiUrl(path), {...options, headers});
    const data = await res.json().catch(()=>({error:'Ungültige Serverantwort'}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }
  function status(id, msg, ok=false) { const el=$(id); el.className='status '+(ok?'ok':'error'); el.textContent=msg; }
  function showView(name, navKey) {
    ['feed','upload','chat','profile','explore'].forEach(v => { const el=$(v+'View'); if(el) el.classList.toggle('hidden',v!==name); });
    document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.nav ? b.dataset.nav===navKey : b.dataset.view===name));
    const heading = $('feedHeading');
    if (heading && name==='feed') {
      heading.textContent = navKey==='friends' ? 'Freunde · Community ✦' : navKey==='foryou' ? 'Für dich · Entdecke Neues ✦' : 'Deine Welt. Dein Feed. ✦';
    }
    if(name==='chat' && !socket && token) connectChat();
    if(name==='profile') loadProfile();
    if(name==='feed') loadFeed();
    if(name==='explore') loadExplore();
  }
  document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view,b.dataset.nav)));
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

  let activeStories = [], activeStoryIndex = 0;
  const storyTypeEl = $('storyType');
  function storyStatus(message, error=false){['storyStatus','feedStoryStatus'].forEach(id=>{const el=$(id);if(el){el.textContent=message;el.style.color=error?'#ff8aa5':'';}})}
  function syncStoryType(){
    const textMode = storyTypeEl.value === 'text';
    $('storyMedia').disabled = textMode;
    $('storyMedia').required = !textMode;
    $('storyMedia').accept = storyTypeEl.value === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp';
    $('storyMedia').previousElementSibling.textContent = storyTypeEl.value === 'video' ? 'Video (max. 35 MB)' : 'Foto (max. 35 MB)';
    $('storyMedia').closest('label');
  }
  function renderStories(stories){
    activeStories = stories || [];
    const renderList = (list, includeCreate=false) => {
      if(!list)return;
      const createButton = includeCreate ? '<button id="feedStoryLaunch" class="story-item" type="button"><span class="story-ring"><span class="story-ring-inner"><span class="story-plus">＋</span></span></span><span class="tiny">Deine Story</span></button>' : '';
      if(!activeStories.length){list.innerHTML=createButton + (includeCreate ? '' : '<span class="muted tiny">Noch keine aktiven Storys. Veröffentliche die erste!</span>');return;}
      list.innerHTML = createButton + activeStories.map((st,i)=>{
        const preview = st.media_url
          ? (st.type==='video' ? `<video src="${esc(mediaUrl(st.media_url))}" muted playsinline preload="metadata"></video>` : `<img src="${esc(mediaUrl(st.media_url))}" alt="">`)
          : '<span style="font-size:1.5rem;color:#fff;text-shadow:0 0 8px #ff28d2,0 0 12px #24dfff">Aa</span>';
        return `<button class="story-item" type="button" data-story-index="${i}"><span class="story-ring"><span class="story-ring-inner">${preview}</span></span><span class="tiny">${esc(st.username||'Mitglied')}</span></button>`;
      }).join('');
    };
    renderList($('storyList'));
    renderList($('feedStoryList'), true);
  }
  async function loadStories(){
    try{const d=await api('/api/stories');renderStories(d.stories||[]);}
    catch(e){storyStatus('Storys konnten nicht geladen werden: '+e.message,true);}
  }
  function closeStoryViewer(){$('storyModal').classList.add('hidden');$('storyViewerMedia').innerHTML='';}
  function showStory(index){
    if(!activeStories.length)return;
    activeStoryIndex=(index+activeStories.length)%activeStories.length;
    const st=activeStories[activeStoryIndex], media=$('storyViewerMedia');
    $('storyViewerTitle').textContent='@'+st.username+' · '+Math.max(0,Math.ceil((Date.parse(st.expires_at)-Date.now())/3600000))+' Std.';
    media.innerHTML='';
    if(st.type==='text'){
      const text=document.createElement('div');text.className='story-viewer-text';text.textContent=st.caption||'';media.appendChild(text);
    }else if(st.media_url){
      const el=document.createElement(st.type==='video'?'video':'img');el.src=mediaUrl(st.media_url);el.alt=st.type==='photo'?'Story-Foto':'';if(st.type==='video'){el.controls=true;el.autoplay=true;el.playsInline=true;}media.appendChild(el);
    }
    const foot=$('storyViewerFoot');foot.textContent=st.caption||'';
    if(me&&String(st.user_id)===String(me.id)){
      const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Story löschen';del.onclick=async()=>{try{await api('/api/stories/'+encodeURIComponent(st.id),{method:'DELETE'});storyStatus('Story gelöscht.');closeStoryViewer();await loadStories();}catch(e){storyStatus(e.message,true);}};foot.appendChild(document.createTextNode(' '));foot.appendChild(del);
    }
    $('storyModal').classList.remove('hidden');
  }
  function openStoryComposer(){
    if(!token){$('authModal').classList.remove('hidden');storyStatus('Bitte zuerst einen Nickname wählen.',true);const fs=$('feedStoryStatus');if(fs)fs.textContent='Bitte zuerst einen Nickname wählen.';return;}
    $('storyForm').classList.toggle('hidden');
    if(!$('storyForm').classList.contains('hidden')){syncStoryType();$('storyType').focus();$('storyForm').scrollIntoView({behavior:'smooth',block:'nearest'});}
  }
  ['storyLaunch','storyLaunchProfile','feedStoryLaunch'].forEach(id=>{const btn=$(id);if(btn)btn.onclick=openStoryComposer;});
  $('storyType').onchange=syncStoryType;
  $('storyCancel').onclick=()=>{$('storyForm').classList.add('hidden');$('storyForm').reset();syncStoryType();};
  $('storyList').addEventListener('click',e=>{const b=e.target.closest('[data-story-index]');if(b)showStory(Number(b.dataset.storyIndex));});
  $('feedStoryList')?.addEventListener('click',e=>{const b=e.target.closest('[data-story-index]');if(b)showStory(Number(b.dataset.storyIndex));else if(e.target.closest('#feedStoryLaunch'))openStoryComposer();});
  $('storyViewerClose').onclick=closeStoryViewer;
  $('storyModal').addEventListener('click',e=>{if(e.target===$('storyModal'))closeStoryViewer();});
  $('storyPrev').onclick=()=>showStory(activeStoryIndex-1);
  $('storyNext').onclick=()=>showStory(activeStoryIndex+1);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeStoryViewer();if(!$('storyModal').classList.contains('hidden')&&e.key==='ArrowRight')showStory(activeStoryIndex+1);if(!$('storyModal').classList.contains('hidden')&&e.key==='ArrowLeft')showStory(activeStoryIndex-1);});
  $('storyForm').onsubmit=async e=>{
    e.preventDefault();
    if(!token){$('authModal').classList.remove('hidden');storyStatus('Bitte zuerst anmelden.',true);return;}
    const type=$('storyType').value, file=$('storyMedia').files[0], caption=$('storyCaption').value.trim();
    if(type!=='text'&&!file){storyStatus('Bitte eine Datei auswählen.',true);return;}
    if(type==='text'&&!caption){storyStatus('Bitte Story-Text eingeben.',true);return;}
    if(file&&file.size>35*1024*1024){storyStatus('Datei ist größer als 35 MB.',true);return;}
    const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;storyStatus('Story wird hochgeladen …');
    try{
      const fd=new FormData();fd.append('type',type);fd.append('caption',caption);if(file)fd.append('media',file);
      await api('/api/stories',{method:'POST',body:fd});
      e.currentTarget.reset();e.currentTarget.classList.add('hidden');syncStoryType();storyStatus('Story veröffentlicht – 24 Stunden sichtbar.');await loadStories();
    }catch(err){storyStatus('Story konnte nicht veröffentlicht werden: '+err.message,true);}
    finally{btn.disabled=false;}
  };
  function renderAvatar(user){
    const preview = $('profileAvatarPreview');
    if (!preview) return;
    if (user && user.avatar_url) {
      const img = document.createElement('img');
      img.src = mediaUrl(user.avatar_url);
      img.alt = 'Profilbild von ' + (user.username || 'Mitglied');
      img.onerror = () => { preview.textContent = '●'; };
      preview.replaceChildren(img);
    } else {
      preview.textContent = '●';
    }
  }
  async function loadProfile(){
    loadStories();
    if(!me){
      renderAvatar(null);
      $('profileDetails').textContent='Wähle einen Nickname, um dein persönliches Profil zu erstellen.';
      $('profileBioDisplay').textContent='Deine Biografie, Interessen und dein persönlicher Stil. 💜';
      ['statPosts','statFollowers','statFollowing','statLikes'].forEach(id=>$(id).textContent='0');
      return;
    }
    try{
      const d=await api('/api/me'); me=d.user; renderAvatar(me);
      $('profileDetails').innerHTML=`<div class="row"><div><b>@${esc(me.username)}</b><div class="muted tiny">Mitglied seit ${new Date(me.created_at).toLocaleDateString()}</div></div></div>`;
      $('profileBioDisplay').textContent=me.bio||'Noch keine Biografie hinterlegt. Klicke auf „Profil bearbeiten“. 💜';
      $('profileMeta').innerHTML=[me.gender?`<span>⚧ ${esc(me.gender)}</span>`:'',me.relationship_status?`<span>♡ ${esc(me.relationship_status)}</span>`:'',me.location?`<span>⌖ ${esc(me.location)}</span>`:''].filter(Boolean).join('');
      $('statPosts').textContent=me.posts_count||0; $('statFollowers').textContent=me.followers_count||0; $('statFollowing').textContent=me.following_count||0; $('statLikes').textContent=me.likes_count||0;
      $('profileGender').value=me.gender||''; $('profileRelationship').value=me.relationship_status||''; $('profileLocation').value=me.location||''; $('profileBioInput').value=me.bio||''; updateAuthUI();
    }catch(e){$('profileDetails').textContent=e.message;}
  }
  $('profileEdit').addEventListener('click',()=>{$('profileEditForm').classList.toggle('hidden');if(!$('profileEditForm').classList.contains('hidden'))$('profileEditForm').scrollIntoView({behavior:'smooth',block:'center'});});
  $('profileEditCancel').addEventListener('click',()=>{$('profileEditForm').classList.add('hidden');});
  $('profileEditForm').addEventListener('submit',async e=>{e.preventDefault();const out=$('profileEditStatus');out.textContent='Profil wird gespeichert …';try{const d=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify({gender:$('profileGender').value,relationship_status:$('profileRelationship').value,location:$('profileLocation').value,bio:$('profileBioInput').value})});me=d.user;out.textContent='Profil erfolgreich gespeichert.';await loadProfile();$('profileEditForm').classList.add('hidden');}catch(err){out.textContent='Fehler: '+err.message;}});
  $('avatarForm').onsubmit=async e=>{e.preventDefault();const f=$('avatarFile').files[0];if(!f)return;if(f.size>3*1024*1024){status('avatarStatus','Das Bild darf höchstens 3 MB groß sein.');return;}const fd=new FormData();fd.append('avatar',f);try{const d=await api('/api/me/avatar',{method:'POST',body:fd});me=d.user;status('avatarStatus','Profilbild gespeichert.',true);renderAvatar(me);loadProfile();}catch(err){status('avatarStatus',err.message);}};
  async function loadExplore(){
    const out=$('exploreResults'); if(!out)return;
    try{
      const d=await api('/api/videos');
      const q=($('exploreSearch')?.value||'').trim().toLowerCase();
      const list=(d.videos||[]).filter(v=>String(v.visibility||'public')!=='private' || (me&&String(v.user_id)===String(me.id)))
        .filter(v=>!q || (`${v.username} ${v.caption||''} ${(v.hashtags||[]).join(' ')}`).toLowerCase().includes(q));
      if(!list.length){out.innerHTML='<div class="empty">Keine passenden Videos gefunden.</div>';return;}
      out.innerHTML=list.map(v=>`<article class="video-card"><div class="video-head"><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div></div><video src="${esc(mediaUrl(v.video_url))}" controls playsinline preload="metadata"></video><div class="video-meta">${esc(v.caption||'')}<div class="muted tiny">${esc((v.hashtags||[]).join(' '))}</div><div class="actions"><button class="secondary" type="button" onclick="navigator.clipboard?.writeText(location.origin)">Link kopieren</button></div></div></article>`).join('');
    }catch(e){out.innerHTML=`<div class="empty">Suche nicht verfügbar: ${esc(e.message)}</div>`;}
  }
  $('exploreSearch')?.addEventListener('input',loadExplore);
  document.querySelectorAll('.explore-tag').forEach(b=>b.addEventListener('click',()=>{ $('exploreSearch').value=b.dataset.query||''; loadExplore(); }));
  async function loadFeed(){const el=$('feed');try{const d=await api('/api/videos');if(!d.videos.length){el.innerHTML='<div class="empty">Noch keine Videos. Melde dich an und lade den ersten Clip hoch!</div>';return;}el.innerHTML=d.videos.map(v=>`<article class="video-card" data-video="${v.id}"><div class="video-head"><div class="avatar">${v.avatar_url?`<img class="avatar" src="${esc(mediaUrl(v.avatar_url))}" alt="">`:esc(v.username.slice(0,1).toUpperCase())}</div><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div>${me&&me.id!==v.user_id?`<button class="secondary follow-btn" data-user="${v.user_id}">${v.following?'Folge ich':'Folgen'}</button>`:''}</div><video src="${esc(mediaUrl(v.video_url))}" controls playsinline preload="metadata" loop></video><div class="video-meta"><div>${esc(v.caption||'')}<div class="muted tiny">${esc((v.hashtags||[]).join(' '))}</div></div><div class="actions"><button class="secondary like-btn" data-id="${v.id}">♥ ${v.like_count}</button><button class="secondary comments-btn" data-id="${v.id}">💬 ${v.comment_count} Kommentare</button><button class="secondary gift-video" data-id="${v.id}">🎁 Geschenk</button></div><div class="comment-area hidden" id="comments-${v.id}"><div class="comment-list"></div><form class="comment-form row" data-id="${v.id}"><input maxlength="500" placeholder="Kommentar schreiben …" required><button>Senden</button></form></div></div></article>`).join('');}catch(e){el.innerHTML=`<div class="empty">Feed konnte nicht geladen werden: ${esc(e.message)}<br>Prüfe, ob der Server läuft.</div>`;}}
  $('feed').addEventListener('click',async e=>{const like=e.target.closest('.like-btn');const follow=e.target.closest('.follow-btn');const cm=e.target.closest('.comments-btn');const gift=e.target.closest('.gift-video');try{if(like){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');await api(`/api/videos/${like.dataset.id}/like`,{method:'POST'});loadFeed();}if(follow){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api(`/api/users/${follow.dataset.user}/follow`,{method:'POST'});follow.textContent=d.following?'Folge ich':'Folgen';}if(cm){const area=$('comments-'+cm.dataset.id);area.classList.toggle('hidden');if(!area.classList.contains('hidden')){const d=await api(`/api/videos/${cm.dataset.id}/comments`);area.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('')||'<div class="muted tiny">Noch keine Kommentare.</div>';}}if(gift){if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname.');}await startPayPalCheckout('Herz', Number(gift.dataset.id));}}catch(err){alert(err.message);}});
  $('feed').addEventListener('submit',async e=>{if(!e.target.matches('.comment-form'))return;e.preventDefault();try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const id=e.target.dataset.id, input=e.target.querySelector('input');await api(`/api/videos/${id}/comments`,{method:'POST',body:JSON.stringify({body:input.value})});input.value='';const d=await api(`/api/videos/${id}/comments`);e.target.parentElement.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('');}catch(err){alert(err.message);}});
  $('uploadForm').onsubmit=async e=>{e.preventDefault();const f=$('videoFile').files[0];if(!f)return;if(f.size>35*1024*1024){status('uploadStatus','Das Video ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}const fd=new FormData();fd.append('video',f);fd.append('caption',$('videoCaption').value);fd.append('hashtags',$('videoHashtags')?.value||'');fd.append('visibility',$('videoVisibility')?.value||'public');try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api('/api/videos',{method:'POST',body:fd});status('uploadStatus','Video erfolgreich hochgeladen!',true);$('uploadForm').reset();showView('feed');}catch(err){status('uploadStatus',err.message);}};
  function connectChat(){
    if(!token||!window.io)return;
    if(socket){if(socket.connected)return;socket.disconnect();}
    socket=io(API_BASE || undefined,{auth:{token}});
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
    if(statusEl)statusEl.textContent='PayPal wird vorbereitet …';

    // Donations can use the operator's verified PayPal donation URL if API credentials
    // have not been configured yet. Paid gifts always use server-side order/capture.
    if(giftName==='Spende'){
      try{
        const config=await api('/api/config');
        const donationUrl=String(config.paypalUrl||'').trim();
        if(!config.paypalEnabled && donationUrl){
          const url=new URL(donationUrl);
          const allowed=url.protocol==='https:' && (url.hostname==='paypal.com' || url.hostname.endsWith('.paypal.com') || url.hostname==='paypal.me');
          if(!allowed)throw Error('Der konfigurierte PayPal-Spendenlink ist ungültig.');
          window.location.assign(url.href);
          return;
        }
      }catch(error){
        if(error.message==='Der konfigurierte PayPal-Spendenlink ist ungültig.')throw error;
        // Continue to integrated checkout; it will show a useful setup error if unavailable.
      }
    }

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
      if(d.paypalUrl && $('paypalLink')){
        try { const url=new URL(d.paypalUrl); if(url.protocol==='https:' && (url.hostname==='paypal.com' || url.hostname.endsWith('.paypal.com') || url.hostname==='paypal.me')) $('paypalLink').href=url.href; else throw new Error('Ungültiger PayPal-Link'); }
        catch { $('paypalLink').removeAttribute('href'); $('paypalLink').onclick=e=>{e.preventDefault();alert('Der Betreiber muss einen gültigen HTTPS-PayPal-Link auf Render eintragen.');}; }
      } else if($('paypalLink')) {$('paypalLink').removeAttribute('href');$('paypalLink').onclick=e=>{e.preventDefault();alert('Der Betreiber muss den PayPal-Spendenlink auf Render eintragen.');};}
    }catch(e){}
  }

  restoreSession().then(()=>{loadConfig();loadStories();loadFeed();if(token)connectChat();else $('authModal').classList.remove('hidden');return handlePayPalReturn();}).catch(e=>{if($('giftStatus'))$('giftStatus').textContent='Initialisierung fehlgeschlagen: '+e.message;});
})();
