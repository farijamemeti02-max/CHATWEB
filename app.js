(() => {
  const $ = id => document.getElementById(id);
  // Netlify-Frontend -> Render-API. On Render itself, same-origin paths are used.
  const host = location.hostname;
  const onRender = host.endsWith('.onrender.com');
  const localWebServer = ['localhost', '127.0.0.1'].includes(host) && /^https?:$/.test(location.protocol);
  const API_BASE = window.GAMETIK_API_BASE || ((onRender || localWebServer) ? '' : 'https://chatweb-iajl.onrender.com');
  const apiUrl = path => /^https?:\/\//i.test(path) ? path : API_BASE + path;
  const mediaUrl = path => path && (path.startsWith('/uploads/') || path.startsWith('/media/')) ? API_BASE + path : (path || '');
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
  const pageOrder = [
    {view:'feed', nav:'home', label:'Home'},
    {view:'explore', nav:'explore', label:'Entdecken'},
    {view:'upload', nav:'upload', label:'Erstellen'},
    {view:'chat', nav:'inbox', label:'Nachrichten'},
    {view:'profile', nav:'profile', label:'Profil'}
  ];
  function showView(name, navKey) {
    ['feed','upload','chat','profile','explore'].forEach(v => { const el=$(v+'View'); if(el) el.classList.toggle('hidden',v!==name); });
    const resolvedNav = navKey || (pageOrder.find(p=>p.view===name)?.nav) || name;
    document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.nav ? b.dataset.nav===resolvedNav : b.dataset.view===name));
    const heading = $('feedHeading');
    if (heading && name==='feed') {
      heading.textContent = navKey==='friends' ? 'Freunde · Community ✦' : navKey==='foryou' ? 'Für dich · Entdecke Neues ✦' : 'Deine Welt. Dein Feed. ✦';
    }
    const current = pageOrder.findIndex(p=>p.view===name);
    document.querySelectorAll('[data-page-step]').forEach((el,i)=>el.classList.toggle('active',i===current));
    const pageLabel = $('pageNavStatus');
    if(pageLabel && current>=0) pageLabel.textContent = `${current+1} / ${pageOrder.length} · ${pageOrder[current].label} — wische nach links/rechts oder nutze die Navigation`;
    if(name==='chat' && !socket && token) connectChat();
    if(name==='profile') loadProfile();
    if(name==='feed') loadFeed();
    if(name==='explore'){ loadExplore(); loadSocialList(); }
    if(name==='upload') $('videoCaption')?.focus({preventScroll:true});
  }
  // Click-only navigation: no swipe or wheel gesture switches pages.
  document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view,b.dataset.nav)));
  document.querySelectorAll('[data-feed-mode]').forEach(b=>b.addEventListener('click',()=>{showView('feed',b.dataset.feedMode);document.querySelectorAll('[data-feed-mode]').forEach(x=>x.classList.toggle('active',x===b));}));
  $('refreshFeed').onclick=loadFeed;

  // GameTik social discovery, following, followers and friend requests.
  let socialTab = 'friends';
  const socialTabs = { friends: 'friends', followers: 'followers', following: 'following', requests: 'requests' };
  const socialUserCache = new Map();
  function socialAvatar(user){
    const src=mediaUrl(user.avatar_url||'');
    return src ? `<img class="social-user-avatar" src="${esc(src)}" alt="Profilbild von @${esc(user.username)}" loading="lazy">` : `<span class="social-user-avatar" aria-hidden="true">${esc((user.username||'?').slice(0,1).toUpperCase())}</span>`;
  }
  function socialUserCard(user, mode='search', requestId=''){
    socialUserCache.set(String(user.id), user);
    const id=esc(user.id), username=esc(user.username);
    let actions='';
    if(mode==='search'){
      actions += `<button type="button" class="secondary" data-social-action="follow" data-user-id="${id}">${user.following?'✓ Folge ich':'＋ Folgen'}</button>`;
      actions += `<button type="button" class="secondary" data-social-action="request" data-user-id="${id}">${user.friend?'✓ Freunde':'＋ Freundschaft'}</button>`;
      actions += `<button type="button" class="secondary" data-social-action="message" data-user-id="${id}">✉ Nachricht</button>`;
    } else if(mode==='requests'){
      actions += `<button type="button" data-social-action="accept" data-request-id="${esc(requestId)}">✓ Annehmen</button><button type="button" class="secondary" data-social-action="reject" data-request-id="${esc(requestId)}">Ablehnen</button>`;
    } else if(mode==='followers'){
      actions += `<button type="button" class="secondary" data-social-action="follow" data-user-id="${id}">${user.following?'✓ Folge ich':'＋ Zurückfolgen'}</button>`;
    } else if(mode==='following'){
      actions += `<button type="button" class="secondary" data-social-action="follow" data-user-id="${id}">Nicht mehr folgen</button>`;
    }
    return `<article class="social-user-card"><button type="button" class="social-profile-open" data-open-user-profile="${id}" aria-label="Profil von @${username} öffnen">${socialAvatar(user)}<span class="social-user-info"><b>@${username}</b><small>${user.followers_count||0} Follower · ${user.following_count||0} folgt</small>${user.bio?`<small>${esc(user.bio)}</small>`:''}<small class="social-profile-hint">Profil ansehen ›</small></span></button><div class="social-user-actions">${actions}</div></article>`;
  }
  function openSocialProfile(userId){
    const user=socialUserCache.get(String(userId));
    if(!user)return;
    let modal=document.getElementById('socialProfileModal');
    if(!modal){
      modal=document.createElement('div');modal.id='socialProfileModal';modal.className='social-profile-modal';modal.innerHTML='<div class="social-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="socialProfileTitle"><button type="button" class="social-profile-close" aria-label="Profil schließen">×</button><div id="socialProfileContent"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.social-profile-close'))modal.classList.remove('open');});
      document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.classList.remove('open');});
    }
    const avatar=socialAvatar(user);
    const following=!!user.following, friend=!!user.friend;
    $('socialProfileContent').innerHTML=`<div class="social-profile-hero">${avatar}<div><span class="muted tiny">GAMETIK COMMUNITY</span><h2 id="socialProfileTitle">@${esc(user.username)}</h2><p>${esc(user.bio||'Noch keine Biografie hinterlegt.')}</p></div></div><div class="social-profile-stats"><div><b>${Number(user.followers_count)||0}</b><span>Follower</span></div><div><b>${Number(user.following_count)||0}</b><span>Folgt</span></div></div><div class="social-profile-actions"><button type="button" data-social-action="follow" data-user-id="${esc(user.id)}">${following?'✓ Folge ich':'＋ Folgen'}</button><button type="button" class="secondary" data-social-action="request" data-user-id="${esc(user.id)}">${friend?'✓ Freunde':'＋ Freundschaft'}</button><button type="button" class="secondary" data-social-action="message" data-user-id="${esc(user.id)}">✉ Nachricht</button></div>`;
    modal.classList.add('open');
  }
  document.addEventListener('click',e=>{const trigger=e.target.closest('[data-open-user-profile]');if(trigger){e.preventDefault();openSocialProfile(trigger.dataset.openUserProfile);}});

  async function searchSocialUsers(){
    const q=$('userSearchInput')?.value.trim()||'';
    if(!token){$('userSearchStatus').textContent='Bitte zuerst anmelden, um Nutzer zu suchen.';$('authModal').classList.remove('hidden');return;}
    if(!q){$('userSearchStatus').textContent='Gib einen Namen ein, zum Beispiel @ninax.';$('userSearchResults').innerHTML='<div class="empty">Noch kein Suchbegriff.</div>';return;}
    $('userSearchStatus').textContent='Suche läuft …';$('userSearchResults').innerHTML='<div class="empty">Nutzer werden gesucht …</div>';
    try{const d=await api('/api/users/search?q='+encodeURIComponent(q));$('userSearchStatus').textContent=d.users.length?`${d.users.length} Nutzer gefunden.`:'Keine passenden Nutzer gefunden.';$('userSearchResults').innerHTML=d.users.length?d.users.map(u=>socialUserCard(u,'search')).join(''):'<div class="empty">Kein aktiver Nutzer mit diesem Namen gefunden.</div>';}
    catch(e){$('userSearchStatus').textContent=e.message;$('userSearchResults').innerHTML='';}
  }
  async function loadSocialList(tab=socialTab){
    socialTab=tab;
    document.querySelectorAll('[data-social-tab]').forEach(b=>b.classList.toggle('active',b.dataset.socialTab===tab));
    if(!token){$('socialListStatus').textContent='Bitte anmelden, um Freundesliste und Anfragen zu sehen.';$('socialListResults').innerHTML='<div class="empty">Nach der Anmeldung werden deine Kontakte hier angezeigt.</div>';return;}
    $('socialListStatus').textContent='Kontakte werden geladen …';
    try{
      const d=await api('/api/me/social');$('friendRequestBadge').textContent=String(d.request_count||0);
      const items=d[socialTabs[tab]]||[];
      $('socialListStatus').textContent=tab==='friends'?`Freunde: ${items.length}`:tab==='followers'?`Follower: ${items.length}`:tab==='following'?`Du folgst ${items.length} Nutzern`:`Offene Freundschaftsanfragen: ${items.length}`;
      $('socialListResults').innerHTML=items.length?items.map(item=>tab==='requests'?socialUserCard(item.user,'requests',item.id):socialUserCard(item,tab==='friends'?'friends':tab)).join(''):`<div class="empty">${tab==='requests'?'Du hast momentan keine neuen Freundschaftsanfragen.':tab==='followers'?'Dir folgt momentan noch niemand.':tab==='following'?'Du folgst noch niemandem.':'Deine Freundesliste ist noch leer. Suche oben nach Nutzern.'}</div>`;
    }catch(e){$('socialListStatus').textContent=e.message;$('socialListResults').innerHTML='';}
  }
  $('userSearchBtn')?.addEventListener('click',searchSocialUsers);
  $('userSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchSocialUsers();}});
  $('socialRefreshBtn')?.addEventListener('click',()=>loadSocialList());
  document.querySelectorAll('[data-social-tab]').forEach(b=>b.addEventListener('click',()=>loadSocialList(b.dataset.socialTab)));
  $('openProfileFollowers')?.addEventListener('click',()=>{showView('explore');loadSocialList('followers');document.querySelector('[data-social-tab=followers]')?.scrollIntoView({behavior:'smooth',block:'center'});});
  $('openProfileFollowing')?.addEventListener('click',()=>{showView('explore');loadSocialList('following');document.querySelector('[data-social-tab=following]')?.scrollIntoView({behavior:'smooth',block:'center'});});
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-social-action]');if(!btn)return;
    if(!token){$('authModal').classList.remove('hidden');return;}
    const action=btn.dataset.socialAction, userId=btn.dataset.userId, requestId=btn.dataset.requestId;
    btn.disabled=true;
    try{
      if(action==='follow'){
        const d=await api('/api/users/'+encodeURIComponent(userId)+'/follow',{method:'POST'});
        btn.textContent=d.following?'✓ Folge ich':'＋ Folgen';
        const cached=socialUserCache.get(String(userId));if(cached)cached.following=!!d.following;
        await loadSocialList();
        if(document.getElementById('socialProfileModal')?.classList.contains('open'))openSocialProfile(userId);
      } else if(action==='request'){
        const d=await api('/api/users/'+encodeURIComponent(userId)+'/friend-request',{method:'POST'});
        btn.textContent='✓ Anfrage gesendet';btn.disabled=true;
        if($('userSearchStatus'))$('userSearchStatus').textContent='Freundschaftsanfrage wurde gesendet.';
        if(document.getElementById('socialProfileModal')?.classList.contains('open')){const c=socialUserCache.get(String(userId));if(c)c.requestPending=true;}
      } else if(action==='accept'){
        await api('/api/friend-requests/'+encodeURIComponent(requestId)+'/accept',{method:'POST'});await loadSocialList('requests');
      } else if(action==='reject'){
        await api('/api/friend-requests/'+encodeURIComponent(requestId),{method:'DELETE'});await loadSocialList('requests');
      } else if(action==='message'){
        privateRecipientId=userId;showView('chat','inbox');setChatMode('private');loadMembers().then(()=>{if($('privateRecipient'))$('privateRecipient').value=userId;loadPrivateHistory();});
      }
    }catch(err){alert(err.message||'Aktion konnte nicht ausgeführt werden.');}
    finally{if(document.body.contains(btn))btn.disabled=false;}
  });

  function updateAuthUI() {
    $('userLabel').textContent = me ? '@'+me.username : 'Nicht angemeldet';
    $('authOpen').textContent = me ? 'Profil' : 'Anmelden / Registrieren';
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
  let authMode='register';
  function setAuthMode(mode){authMode=mode;const registering=mode==='register';$('authEmailWrap').classList.toggle('hidden',!registering);$('authEmail').required=registering;$('authUsername').maxLength=registering?24:254;$('authUsername').placeholder=registering?'z. B. Gamer2026':'Benutzername oder E-Mail';$('authPassword').autocomplete=registering?'new-password':'current-password';$('authPassword').placeholder=registering?'Mindestens 10 Zeichen':'Dein Passwort';$('authSubmit').textContent=registering?'Konto erstellen':'Anmelden';$('authModeRegister').classList.toggle('secondary',!registering);$('authModeLogin').classList.toggle('secondary',registering);$('authStatus').textContent='';}
  $('authModeRegister').onclick=()=>setAuthMode('register');$('authModeLogin').onclick=()=>setAuthMode('login');
  $('forgotPasswordOpen').onclick=()=>{$('authModal').classList.add('hidden');$('forgotPasswordModal').classList.remove('hidden');$('forgotPasswordStatus').textContent='';};
  $('forgotPasswordClose').onclick=()=>{$('forgotPasswordModal').classList.add('hidden');$('authModal').classList.remove('hidden');};
  $('forgotPasswordForm').onsubmit=async e=>{e.preventDefault();$('forgotPasswordSubmit').disabled=true;try{const d=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:$('forgotPasswordEmail').value.trim()})});status('forgotPasswordStatus',d.message||'Falls die Adresse registriert ist, erhältst du eine E-Mail.',true);}catch(err){status('forgotPasswordStatus',err.message);}finally{$('forgotPasswordSubmit').disabled=false;}};
  const resetTokenFromUrl=new URLSearchParams(window.location.search).get('resetToken');
  if(resetTokenFromUrl){$('resetPasswordModal').classList.remove('hidden');}
  $('resetPasswordForm').onsubmit=async e=>{e.preventDefault();const password=$('resetPasswordValue').value;if(password!==$('resetPasswordConfirm').value){status('resetPasswordStatus','Die Passwörter stimmen nicht überein.');return;}$('resetPasswordSubmit').disabled=true;try{const d=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetTokenFromUrl,password})});status('resetPasswordStatus',d.message||'Passwort wurde geändert.',true);window.history.replaceState({},document.title,window.location.pathname);$('resetPasswordForm').reset();window.setTimeout(()=>{$('resetPasswordModal').classList.add('hidden');$('authModal').classList.remove('hidden');setAuthMode('login');},1200);}catch(err){status('resetPasswordStatus',err.message);}finally{$('resetPasswordSubmit').disabled=false;}};

  $('authForm').onsubmit=async e=>{e.preventDefault();$('authSubmit').disabled=true;try{const body=authMode==='register'?{username:$('authUsername').value.trim(),email:$('authEmail').value.trim(),password:$('authPassword').value}:{identity:$('authUsername').value.trim(),password:$('authPassword').value};const d=await api(authMode==='register'?'/api/auth/register':'/api/auth/login',{method:'POST',body:JSON.stringify(body)});token=d.token;localStorage.setItem('gametik_token',token);me=d.user;updateAuthUI();$('authModal').classList.add('hidden');if(socket){socket.disconnect();socket=null;}connectChat();showView('feed');}catch(err){status('authStatus',err.message);}finally{$('authSubmit').disabled=false;}};
  $('logoutBtn').onclick=async()=>{try{if(token)await api('/api/auth/logout',{method:'POST'});}catch(e){}finally{token='';me=null;localStorage.removeItem('gametik_token');if(socket){socket.disconnect();socket=null;}privateRecipientId='';updateAuthUI();loadProfile();showView('feed');$('authModal').classList.remove('hidden');}};

  // Real camera preview and capture using the browser camera API.
  const cameraState={stream:null,mode:'photo',facing:'environment',recorder:null,chunks:[],recordedBlob:null};
  const cameraEl=id=>document.getElementById(id);
  async function stopCamera(){
    if(cameraState.recorder && cameraState.recorder.state!=='inactive'){try{cameraState.recorder.stop();}catch(e){}}
    if(cameraState.stream){cameraState.stream.getTracks().forEach(t=>t.stop());cameraState.stream=null;}
    const preview=cameraEl('cameraPreview'); if(preview)preview.srcObject=null;
  }
  async function openCamera(mode){
    cameraState.mode=mode;cameraState.recordedBlob=null;cameraState.chunks=[];
    cameraEl('cameraModal').classList.remove('hidden');cameraEl('cameraTitle').textContent=mode==='photo'?'Foto aufnehmen':'Video aufnehmen';
    cameraEl('cameraCapture').classList.toggle('hidden',mode!=='photo');cameraEl('cameraRecord').classList.toggle('hidden',mode!=='video');cameraEl('cameraUse').classList.add('hidden');
    cameraEl('cameraStatus').textContent='Bitte Kamerazugriff erlauben …';
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Kamera benötigt HTTPS und einen kompatiblen Browser.');
      cameraState.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:cameraState.facing,width:{ideal:1080},height:{ideal:1920}},audio:mode==='video'});
      const v=cameraEl('cameraPreview');v.srcObject=cameraState.stream;await v.play();cameraEl('cameraStatus').textContent='Kamera bereit. '+(mode==='video'?'Starte die Aufnahme, wenn du bereit bist.':'Tippe auf den Auslöser.');
    }catch(err){cameraEl('cameraStatus').textContent='Kamera nicht verfügbar: '+err.message;}
  }
  function assignCapturedFile(inputId,blob,name){
    const input=cameraEl(inputId);const file=new File([blob],name,{type:blob.type||'application/octet-stream'});const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  cameraEl('cameraPhotoBtn')?.addEventListener('click',()=>openCamera('photo'));
  cameraEl('cameraVideoBtn')?.addEventListener('click',()=>openCamera('video'));
  cameraEl('cameraClose')?.addEventListener('click',async()=>{cameraEl('cameraModal').classList.add('hidden');await stopCamera();});
  cameraEl('cameraSwitch')?.addEventListener('click',async()=>{cameraState.facing=cameraState.facing==='environment'?'user':'environment';await stopCamera();await openCamera(cameraState.mode);});
  cameraEl('cameraCapture')?.addEventListener('click',()=>{
    const v=cameraEl('cameraPreview'),c=cameraEl('cameraCanvas');if(!v.videoWidth){cameraEl('cameraStatus').textContent='Kamera ist noch nicht bereit.';return;}
    c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    c.toBlob(async blob=>{if(!blob)return;assignCapturedFile('videoFile',blob,'gametik-foto-'+Date.now()+'.jpg');cameraEl('cameraStatus').textContent='Foto aufgenommen. Es wurde im Upload-Formular ausgewählt.';await stopCamera();setTimeout(()=>cameraEl('cameraModal').classList.add('hidden'),500);},'image/jpeg',.92);
  });
  cameraEl('cameraRecord')?.addEventListener('click',()=>{
    if(!cameraState.stream)return;
    if(cameraState.recorder && cameraState.recorder.state==='recording'){cameraState.recorder.stop();cameraEl('cameraRecord').textContent='● Aufnahme starten';return;}
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>window.MediaRecorder?.isTypeSupported(t));
    if(!window.MediaRecorder){cameraEl('cameraStatus').textContent='Videoaufnahme wird von diesem Browser nicht unterstützt.';return;}
    cameraState.chunks=[];cameraState.recorder=new MediaRecorder(cameraState.stream,mime?{mimeType:mime}:undefined);
    cameraState.recorder.ondataavailable=e=>{if(e.data?.size)cameraState.chunks.push(e.data);};
    cameraState.recorder.onstop=()=>{cameraState.recordedBlob=new Blob(cameraState.chunks,{type:cameraState.recorder.mimeType||'video/webm'});cameraEl('cameraUse').classList.remove('hidden');cameraEl('cameraStatus').textContent='Aufnahme beendet. Du kannst sie jetzt verwenden.';cameraEl('cameraRecord').textContent='● Erneut aufnehmen';};
    cameraState.recorder.start();cameraEl('cameraRecord').textContent='■ Aufnahme stoppen';cameraEl('cameraStatus').textContent='Aufnahme läuft …';
  });
  cameraEl('cameraUse')?.addEventListener('click',async()=>{if(!cameraState.recordedBlob)return;assignCapturedFile('videoFile',cameraState.recordedBlob,'gametik-video-'+Date.now()+'.webm');cameraEl('cameraStatus').textContent='Video wurde im Upload-Formular ausgewählt.';await stopCamera();cameraEl('cameraModal').classList.add('hidden');});
  cameraEl('cameraModal')?.addEventListener('click',e=>{if(e.target===cameraEl('cameraModal')){cameraEl('cameraModal').classList.add('hidden');stopCamera();}});

  let activeStories = [], activeStoryIndex = 0;
  const storyTypeEl = $('storyType');
  function storyStatus(message, error=false){['storyStatus','feedStoryStatus'].forEach(id=>{const el=$(id);if(el){el.textContent=message;el.style.color=error?'#ff8aa5':'';}})}
  function syncStoryType(){
    const textMode = storyTypeEl.value === 'text';
    $('storyMedia').disabled = textMode;
    $('storyMedia').required = !textMode;
    $('storyMedia').accept = storyTypeEl.value === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp';
    $('storyCameraPhotoBtn')?.classList.toggle('hidden', textMode || storyTypeEl.value === 'video');
    $('storyCameraVideoBtn')?.classList.toggle('hidden', textMode || storyTypeEl.value !== 'video');
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
    if(st.user_id && (!me || String(st.user_id)!==String(me.id))){
      const follow=document.createElement('button');follow.type='button';follow.className='secondary story-follow-btn';follow.dataset.user=st.user_id;follow.textContent=st.following?'Folge ich':'＋ Folgen';
      follow.onclick=async()=>{try{if(!token){$('authModal').classList.remove('hidden');throw Error('Bitte zuerst einen Nickname wählen.');}const d=await api('/api/users/'+encodeURIComponent(st.user_id)+'/follow',{method:'POST'});follow.textContent=d.following?'Folge ich':'＋ Folgen';st.following=d.following;}catch(e){alert(e.message);}};
      foot.appendChild(document.createTextNode(' '));foot.appendChild(follow);
      const block=document.createElement('button');block.type='button';block.className='secondary block-user-btn';block.textContent='🚫 Blockieren';block.onclick=async()=>{try{if(!token){$('authModal').classList.remove('hidden');throw Error('Bitte zuerst einen Nickname wählen.');}if(!confirm('@'+st.username+' blockieren?'))return;await api('/api/users/'+encodeURIComponent(st.user_id)+'/block',{method:'POST'});closeStoryViewer();await loadStories();alert('Nutzer blockiert.');}catch(e){alert(e.message);}};foot.appendChild(document.createTextNode(' '));foot.appendChild(block);
    }
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
  // Story viewer: horizontal touch swipe and mouse drag support.
  let storyTouchX=null;
  $('storyViewerMedia').addEventListener('touchstart',e=>{storyTouchX=e.changedTouches?.[0]?.clientX??null;},{passive:true});
  $('storyViewerMedia').addEventListener('touchend',e=>{if(storyTouchX===null)return;const dx=(e.changedTouches?.[0]?.clientX??storyTouchX)-storyTouchX;storyTouchX=null;if(Math.abs(dx)>45)showStory(activeStoryIndex+(dx<0?1:-1));},{passive:true});
  let storyMouseX=null;
  $('storyViewerMedia').addEventListener('mousedown',e=>{storyMouseX=e.clientX;});
  $('storyViewerMedia').addEventListener('mouseup',e=>{if(storyMouseX===null)return;const dx=e.clientX-storyMouseX;storyMouseX=null;if(Math.abs(dx)>60)showStory(activeStoryIndex+(dx<0?1:-1));});
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
      $('profileGender').value=me.gender||''; $('profileRelationship').value=me.relationship_status||''; $('profileLocation').value=me.location||''; $('profileBioInput').value=me.bio||''; if($('profileSocialVisibility'))$('profileSocialVisibility').value=me.social_visibility||((me.social_private===false)?'public':'private'); updateAuthUI();
    }catch(e){$('profileDetails').textContent=e.message;}
  }
  $('profileEdit').addEventListener('click',()=>{$('profileEditForm').classList.toggle('hidden');if(!$('profileEditForm').classList.contains('hidden'))$('profileEditForm').scrollIntoView({behavior:'smooth',block:'center'});});
  $('profileEditCancel').addEventListener('click',()=>{$('profileEditForm').classList.add('hidden');});
  $('profileEditForm').addEventListener('submit',async e=>{e.preventDefault();const out=$('profileEditStatus');out.textContent='Profil wird gespeichert …';try{const d=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify({gender:$('profileGender').value,relationship_status:$('profileRelationship').value,location:$('profileLocation').value,bio:$('profileBioInput').value,social_visibility:$('profileSocialVisibility')?.value||'private'})});me=d.user;out.textContent='Profil erfolgreich gespeichert.';await loadProfile();$('profileEditForm').classList.add('hidden');}catch(err){out.textContent='Fehler: '+err.message;}});
  $('avatarForm').onsubmit=async e=>{e.preventDefault();const f=$('avatarFile').files[0];if(!f)return;if(f.size>3*1024*1024){status('avatarStatus','Das Bild darf höchstens 3 MB groß sein.');return;}const fd=new FormData();fd.append('avatar',f);try{const d=await api('/api/me/avatar',{method:'POST',body:fd});me=d.user;status('avatarStatus','Profilbild gespeichert.',true);renderAvatar(me);loadProfile();}catch(err){status('avatarStatus',err.message);}};
  async function loadExplore(){
    const out=$('exploreResults'); if(!out)return;
    try{
      const d=await api('/api/videos');
      const q=($('exploreSearch')?.value||'').trim().toLowerCase();
      const list=(d.videos||[]).filter(v=>String(v.visibility||'public')!=='private' || (me&&String(v.user_id)===String(me.id)))
        .filter(v=>!q || (`${v.username} ${v.caption||''} ${(v.hashtags||[]).join(' ')}`).toLowerCase().includes(q));
      if(!list.length){out.innerHTML='<div class="empty">Keine passenden Videos gefunden.</div>';return;}
      out.innerHTML=list.map(v=>`<article class="video-card"><div class="video-head"><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div>${me&&String(me.id)!==String(v.user_id)?`<button class="secondary follow-btn" data-user="${v.user_id}">${v.following?'Folge ich':'＋ Folgen'}</button><button class="secondary block-user-btn" data-user="${v.user_id}">🚫 Blockieren</button>`:''}</div>${v.media_type==='photo'?`<img class="feed-photo" src="${esc(mediaUrl(v.video_url))}" alt="Foto von ${esc(v.username)}" style="display:block;width:100%;max-height:70vh;object-fit:contain;background:#05050a">`:`<video src="${esc(mediaUrl(v.video_url))}" controls playsinline preload="metadata"></video>`}<div class="video-meta">${esc(v.caption||'')}<div class="muted tiny">${esc((v.hashtags||[]).join(' '))}</div><div class="actions"><button class="secondary" type="button" onclick="navigator.clipboard?.writeText(location.origin)">Link kopieren</button></div></div></article>`).join('');
    }catch(e){out.innerHTML=`<div class="empty">Suche nicht verfügbar: ${esc(e.message)}</div>`;}
  }
  $('exploreResults')?.addEventListener('click',async e=>{const block=e.target.closest('.block-user-btn');const b=e.target.closest('.follow-btn');if(!b&&!block)return;try{if(!token){$('authModal').classList.remove('hidden');throw Error('Bitte zuerst einen Nickname wählen.');}if(block){if(confirm('Diesen Nutzer blockieren?')){await api('/api/users/'+encodeURIComponent(block.dataset.user)+'/block',{method:'POST'});loadExplore();loadFeed();loadStories();}return;}const d=await api('/api/users/'+encodeURIComponent(b.dataset.user)+'/follow',{method:'POST'});b.textContent=d.following?'Folge ich':'＋ Folgen';}catch(err){alert(err.message);}});
  $('exploreSearch')?.addEventListener('input',loadExplore);
  document.querySelectorAll('.explore-tag').forEach(b=>b.addEventListener('click',()=>{ $('exploreSearch').value=b.dataset.query||''; loadExplore(); }));
  async function loadFeed(){const el=$('feed');try{const d=await api('/api/videos');if(!d.videos.length){el.innerHTML='<div class="empty">Noch keine Videos. Melde dich an und lade den ersten Clip hoch!</div>';return;}el.innerHTML=d.videos.map(v=>`<article class="video-card" data-video="${v.id}"><div class="video-head"><div class="avatar">${v.avatar_url?`<img class="avatar" src="${esc(mediaUrl(v.avatar_url))}" alt="">`:esc(v.username.slice(0,1).toUpperCase())}</div><div style="flex:1"><b>@${esc(v.username)}</b><div class="muted tiny">${new Date(v.created_at).toLocaleString()}</div></div>${me&&me.id!==v.user_id?`<button class="secondary follow-btn" data-user="${v.user_id}">${v.following?'Folge ich':'＋ Folgen'}</button>`:''}${me&&me.id===v.user_id?`<button class="danger delete-video" data-id="${v.id}">🗑 Löschen</button>`:''}</div>${v.video_url?(v.media_type==='photo'?`<img class="feed-photo" src="${esc(mediaUrl(v.video_url))}" alt="Beitrag von ${esc(v.username)}" style="display:block;width:100%;max-height:70vh;object-fit:contain;background:#05050a">`:`<video src="${esc(mediaUrl(v.video_url))}" controls playsinline preload="metadata" loop></video>`):''}${v.document_url?`<div class="document-attachment" style="padding:14px;margin:10px 0;background:#171729;border-radius:10px">📎 <b>${esc(v.document_name||'Dokument')}</b><div><a href="${esc(mediaUrl(v.document_url))}" target="_blank" rel="noopener noreferrer" download>Dokument öffnen / herunterladen</a></div></div>`:''}${v.music_url?`<div class="attached-music" style="padding:10px 12px;background:#171729"><div class="tiny">🎵 Eigene Musik · ${esc(v.music_original_name||'Audio')}</div><audio controls preload="metadata" src="${esc(mediaUrl(v.music_url))}" style="width:100%;margin-top:6px"></audio></div>`:''}<div class="video-meta"><div>${esc(v.caption||'')}<div class="muted tiny">${esc((v.hashtags||[]).join(' '))}</div></div><div class="actions"><button class="secondary react-btn" data-id="${v.id}" data-type="heart">❤️ Herz ${v.reactions?.heart||0}</button><button class="secondary react-btn" data-id="${v.id}" data-type="like">👍 Gefällt mir</button><button class="secondary react-btn" data-id="${v.id}" data-type="love">💖 I Love You</button><button class="secondary react-btn" data-id="${v.id}" data-type="dislike">👎 Dislike</button><button class="secondary comments-btn" data-id="${v.id}">💬 ${v.comment_count} Kommentare</button><button class="secondary gift-video" data-id="${v.id}">🎁 Geschenk</button></div><div class="rating-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0"><label>Bewertung 1–10</label><select class="rating-select" data-id="${v.id}">${Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select><button class="secondary rate-btn" data-id="${v.id}">Bewerten</button><span class="muted tiny">⭐ ${v.rating_average||0}/10 · ${v.rating_count||0} Bewertungen</span></div><div class="comment-area hidden" id="comments-${v.id}"><div class="comment-list"></div><form class="comment-form row" data-id="${v.id}"><input maxlength="500" placeholder="Kommentar schreiben …" required><button>Senden</button></form></div></div></article>`).join('');}catch(e){el.innerHTML=`<div class="empty">Feed konnte nicht geladen werden: ${esc(e.message)}<br>Prüfe, ob der Server läuft.</div>`;}}
  $('feed').addEventListener('click',async e=>{const like=e.target.closest('.like-btn');const react=e.target.closest('.react-btn');const del=e.target.closest('.delete-video');const rate=e.target.closest('.rate-btn');const follow=e.target.closest('.follow-btn');const block=e.target.closest('.block-user-btn');const cm=e.target.closest('.comments-btn');const gift=e.target.closest('.gift-video');try{if(react){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');await api(`/api/videos/${react.dataset.id}/reaction`,{method:'POST',body:JSON.stringify({type:react.dataset.type})});loadFeed();}if(del){if(!token)throw Error('Bitte zuerst anmelden.');if(confirm('Diesen eigenen Beitrag wirklich löschen?')){await api(`/api/videos/${del.dataset.id}`,{method:'DELETE'});loadFeed();}}if(rate){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const card=rate.closest('[data-video]');const score=Number(card.querySelector('.rating-select').value);await api(`/api/videos/${rate.dataset.id}/rating`,{method:'POST',body:JSON.stringify({score})});loadFeed();}if(like){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');await api(`/api/videos/${like.dataset.id}/like`,{method:'POST'});loadFeed();}if(follow){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api(`/api/users/${follow.dataset.user}/follow`,{method:'POST'});follow.textContent=d.following?'Folge ich':'＋ Folgen';}if(block){if(!token)throw Error('Bitte zuerst einen Nickname wählen.');if(confirm('Diesen Nutzer blockieren? Seine Inhalte werden dir nicht mehr angezeigt.')){await api(`/api/users/${block.dataset.user}/block`,{method:'POST'});loadFeed();loadStories();}}if(cm){const area=$('comments-'+cm.dataset.id);area.classList.toggle('hidden');if(!area.classList.contains('hidden')){const d=await api(`/api/videos/${cm.dataset.id}/comments`);area.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('')||'<div class="muted tiny">Noch keine Kommentare.</div>';}}if(gift){if(!token){$('authModal').classList.remove('hidden');throw Error('Wähle zuerst einen Nickname.');}await startPayPalCheckout('Herz', Number(gift.dataset.id));}}catch(err){alert(err.message);}});
  $('feed').addEventListener('submit',async e=>{if(!e.target.matches('.comment-form'))return;e.preventDefault();try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const id=e.target.dataset.id, input=e.target.querySelector('input');await api(`/api/videos/${id}/comments`,{method:'POST',body:JSON.stringify({body:input.value})});input.value='';const d=await api(`/api/videos/${id}/comments`);e.target.parentElement.querySelector('.comment-list').innerHTML=d.comments.map(c=>`<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.body)}</div>`).join('');}catch(err){alert(err.message);}});
  function assignCapturedFile(sourceId, targetId){const source=$(sourceId),target=$(targetId);source?.addEventListener('change',()=>{const file=source.files?.[0];if(!file)return;try{const transfer=new DataTransfer();transfer.items.add(file);target.files=transfer.files;target.dispatchEvent(new Event('change',{bubbles:true}));target.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){status('uploadStatus','Die Kamera-Datei wurde ausgewählt. Falls sie nicht übernommen wurde, wähle sie bitte direkt über „Foto oder Video auswählen“.');}});}
  $('cameraPhotoBtn')?.addEventListener('click',()=> $('cameraPhotoInput')?.click());
  $('cameraVideoBtn')?.addEventListener('click',()=> $('cameraVideoInput')?.click());
  assignCapturedFile('cameraPhotoInput','videoFile');assignCapturedFile('cameraVideoInput','videoFile');
  $('storyCameraPhotoBtn')?.addEventListener('click',()=> $('storyCameraPhotoInput')?.click());
  $('storyCameraVideoBtn')?.addEventListener('click',()=> $('storyCameraVideoInput')?.click());
  for(const [sourceId,targetId] of [['storyCameraPhotoInput','storyMedia'],['storyCameraVideoInput','storyMedia']]){const source=$(sourceId);source?.addEventListener('change',()=>{const file=source.files?.[0];if(!file)return;const transfer=new DataTransfer();transfer.items.add(file);$(targetId).files=transfer.files;$('storyType').value=file.type.startsWith('video/')?'video':'photo';syncStoryType();});}
  $('uploadForm').onsubmit=async e=>{e.preventDefault();const f=$('videoFile').files[0];const documentFile=$('documentFile')?.files?.[0];if(!f&&!documentFile){status('uploadStatus','Bitte ein Foto, Video oder Dokument auswählen.');return;}if(f&&f.size>35*1024*1024){status('uploadStatus','Die Datei ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}if(documentFile&&documentFile.size>35*1024*1024){status('uploadStatus','Das Dokument ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}const music=$('musicFile')?.files?.[0];if(music&&music.size>35*1024*1024){status('uploadStatus','Die Musikdatei ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}if(music&&!(['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','audio/x-flac'].includes(music.type)||/\.(mp3|m4a|aac|ogg|wav|webm|flac)$/i.test(music.name))){status('uploadStatus','Bitte MP3, M4A, AAC, OGG, WAV, WebM oder FLAC auswählen.');return;}const fd=new FormData();if(f)fd.append('video',f);if(documentFile)fd.append('document',documentFile);if(music)fd.append('music',music);fd.append('caption',$('videoCaption').value);fd.append('hashtags',$('videoHashtags')?.value||'');fd.append('visibility',$('videoVisibility')?.value||'public');try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api('/api/videos',{method:'POST',body:fd});status('uploadStatus',documentFile&&!f?'Dokument erfolgreich hochgeladen!':documentFile?'Beitrag mit Anhang erfolgreich hochgeladen!':f.type.startsWith('image/')?'Foto erfolgreich hochgeladen!':'Video erfolgreich hochgeladen!',true);$('uploadForm').reset();showView('feed');}catch(err){status('uploadStatus',err.message);}};
  function connectChat(){
    if(!token||!window.io)return;
    if(socket){if(socket.connected)return;socket.disconnect();}
    socket=io(API_BASE || undefined,{auth:{token}});
    bindCallEvents();
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
    try{const d=await api('/api/messages/'+encodeURIComponent(privateRecipientId));const clearedAt=Number(readStore(clearedKey)[String(privateRecipientId)]||0);d.messages.filter(m=>Date.parse(m.created_at)>clearedAt).forEach(addPrivateMessage);const archived=readStore(archivedKey)[String(privateRecipientId)];if(archived)updateChatToolStatus('Dieser Chat ist lokal archiviert. Wähle ihn erneut aus, um ihn wieder zu öffnen.');const muted=readStore(mutedKey)[String(privateRecipientId)];if(muted===0||muted>Date.now())updateChatToolStatus('Benachrichtigungen für diesen Chat sind stummgeschaltet.');}
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
  const chatToolStatus=$('chatToolsStatus');
  const archivedKey='gametik_archived_chats', mutedKey='gametik_muted_chats', clearedKey='gametik_cleared_chats';
  const readStore=k=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch(_){return {}}};
  function activeChatKey(){return privateRecipientId?String(privateRecipientId):'';}
  function updateChatToolStatus(message){if(chatToolStatus)chatToolStatus.textContent=message;}
  $('archiveChatBtn')?.addEventListener('click',()=>{const id=activeChatKey();if(!id){updateChatToolStatus('Bitte zuerst einen privaten Kontakt auswählen.');return;}const data=readStore(archivedKey);data[id]=true;localStorage.setItem(archivedKey,JSON.stringify(data));updateChatToolStatus('Chat archiviert (nur auf diesem Gerät ausgeblendet).');});
  $('clearChatBtn')?.addEventListener('click',()=>{const id=activeChatKey();if(!id){updateChatToolStatus('Bitte zuerst einen privaten Kontakt auswählen.');return;}if(!confirm('Diese Unterhaltung aus deiner aktuellen Ansicht entfernen? Der Serververlauf wird nicht gelöscht.'))return;const data=readStore(clearedKey);data[id]=Date.now();localStorage.setItem(clearedKey,JSON.stringify(data));$('chatMessages').innerHTML='';updateChatToolStatus('Ansicht geleert. Gespeicherte Servernachrichten bleiben erhalten.');});
  $('muteChatBtn')?.addEventListener('click',()=>{const id=activeChatKey();if(!id){updateChatToolStatus('Bitte zuerst einen privaten Kontakt auswählen.');return;}const data=readStore(mutedKey);const duration=Number($('muteDuration').value);data[id]=duration===0?0:Date.now()+duration;localStorage.setItem(mutedKey,JSON.stringify(data));updateChatToolStatus(duration===0?'Chat dauerhaft stummgeschaltet.':'Chat stummgeschaltet. Benachrichtigungen werden lokal unterdrückt.');});
  let activeCall=null, pendingCall=null, localCallStream=null, peerCall=null, callMuted=false, callCameraOff=false;
  const callEl=id=>document.getElementById(id);
  function callStatus(text){if(callEl('callStatus'))callEl('callStatus').textContent=text;updateChatToolStatus(text);}
  function sendCallSignal(event,payload={}){if(!socket||!socket.connected)throw Error('Chat-Server ist nicht verbunden.');socket.emit(event,{...payload,toId:activeCall?.peerId||pendingCall?.fromId},ack=>{if(ack?.error)callStatus(ack.error);});}
  async function ensureCallMedia(kind){if(!navigator.mediaDevices?.getUserMedia)throw Error('Dein Browser unterstützt keinen Kamera-/Mikrofonzugriff. Öffne GameTik über HTTPS.');localCallStream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});callEl('localCallVideo').srcObject=localCallStream;}
  function makePeer(){peerCall=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});localCallStream?.getTracks().forEach(t=>peerCall.addTrack(t,localCallStream));peerCall.ontrack=e=>{callEl('remoteCallVideo').srcObject=e.streams[0];};peerCall.onicecandidate=e=>{if(e.candidate&&activeCall&&socket?.connected)socket.emit('call:ice',{toId:activeCall.peerId,candidate:e.candidate});};peerCall.onconnectionstatechange=()=>{if(peerCall&&['failed','disconnected'].includes(peerCall.connectionState))callStatus('Verbindung unterbrochen. Prüfe Netzwerk oder TURN-Konfiguration.');else if(peerCall?.connectionState==='connected')callStatus('Anruf verbunden.');};}
  function showCall(){callEl('callModal')?.classList.remove('hidden');}
  async function startCall(kind){if(!token){$('authModal').classList.remove('hidden');updateChatToolStatus('Bitte zuerst anmelden.');return;}if(!privateRecipientId){updateChatToolStatus('Bitte zuerst einen privaten Kontakt auswählen.');return;}if(!socket||!socket.connected){connectChat();updateChatToolStatus('Chat verbindet sich. Bitte erneut auf Anrufen tippen.');return;}if(activeCall||pendingCall){updateChatToolStatus('Du bist bereits in einem Anruf.');return;}try{const option=$('privateRecipient').selectedOptions[0];activeCall={peerId:String(privateRecipientId),kind,role:'caller',peerName:option?.textContent||'Mitglied'};showCall();callStatus('Rufe '+activeCall.peerName+' an …');socket.emit('call:invite',{toId:activeCall.peerId,kind},ack=>{if(ack?.error){callStatus(ack.error);activeCall=null;return;}callStatus('Anruf wird signalisiert. Warte auf Annahme …');});}catch(e){activeCall=null;callStatus(e.message);}}
  function bindCallEvents(){
  socket.on('call:incoming',data=>{if(activeCall||pendingCall){socket.emit('call:reject',{toId:data.fromId,reason:'busy'});return;}pendingCall=data;activeCall={peerId:String(data.fromId),kind:data.kind==='voice'?'voice':'video',role:'callee',peerName:'@'+data.fromUsername};callEl('callTitle').textContent=(activeCall.kind==='video'?'Videoanruf von ':'Sprachanruf von ')+'@'+data.fromUsername;callEl('callAccept').classList.remove('hidden');callEl('callAccept').textContent='Annehmen';callEl('callHangup').textContent='Ablehnen';showCall();callStatus('Eingehender Anruf von @'+data.fromUsername+'.');});
  socket.on('call:accept',async()=>{if(!activeCall||activeCall.role!=='caller')return;try{callEl('callAccept').classList.add('hidden');await ensureCallMedia(activeCall.kind);makePeer();const offer=await peerCall.createOffer();await peerCall.setLocalDescription(offer);socket.emit('call:offer',{toId:activeCall.peerId,description:peerCall.localDescription});callStatus('Verbindung wird aufgebaut …');}catch(e){callStatus('Kamera/Mikrofon nicht verfügbar: '+e.message);endCall(true);}});
  socket.on('call:offer',async data=>{if(!activeCall||activeCall.peerId!==String(data.fromId))return;try{await ensureCallMedia(activeCall.kind);makePeer();await peerCall.setRemoteDescription(data.description);const answer=await peerCall.createAnswer();await peerCall.setLocalDescription(answer);socket.emit('call:answer',{toId:activeCall.peerId,description:peerCall.localDescription});callEl('callAccept').classList.add('hidden');callStatus('Verbindung wird aufgebaut …');}catch(e){callStatus('Verbindungsfehler: '+e.message);endCall(true);}});
  socket.on('call:answer',async data=>{if(peerCall&&activeCall?.peerId===String(data.fromId)){try{await peerCall.setRemoteDescription(data.description);}catch(e){callStatus('Antwort konnte nicht verarbeitet werden.');}}});
  socket.on('call:ice',async data=>{if(peerCall&&activeCall?.peerId===String(data.fromId)&&data.candidate){try{await peerCall.addIceCandidate(data.candidate);}catch(_){}}});
  socket.on('call:reject',data=>{if(activeCall?.peerId===String(data.fromId)){callStatus('Anruf abgelehnt.');endCall(false);}});
  socket.on('call:hangup',data=>{if(activeCall?.peerId===String(data.fromId)){callStatus('Der andere Nutzer hat aufgelegt.');endCall(false);}});
  }
  function endCall(notify=true){const peerId=activeCall?.peerId||pendingCall?.fromId;if(notify&&peerId&&socket?.connected)socket.emit('call:hangup',{toId:peerId});peerCall?.close();peerCall=null;localCallStream?.getTracks().forEach(t=>t.stop());localCallStream=null;callEl('localCallVideo').srcObject=null;callEl('remoteCallVideo').srcObject=null;activeCall=null;pendingCall=null;callMuted=false;callCameraOff=false;callEl('callModal')?.classList.add('hidden');callEl('callAccept')?.classList.remove('hidden');callEl('callHangup').textContent='Auflegen';}
  callEl('callAccept')?.addEventListener('click',async()=>{if(!pendingCall||!activeCall)return;try{await ensureCallMedia(activeCall.kind);makePeer();socket.emit('call:accept',{toId:activeCall.peerId});callEl('callAccept').classList.add('hidden');callStatus('Anruf angenommen. Warte auf Verbindung …');}catch(e){callStatus('Kamera/Mikrofon nicht verfügbar: '+e.message);endCall(true);}});
  callEl('callHangup')?.addEventListener('click',()=>endCall(true));callEl('callClose')?.addEventListener('click',()=>endCall(true));
  callEl('callMute')?.addEventListener('click',()=>{callMuted=!callMuted;localCallStream?.getAudioTracks().forEach(t=>t.enabled=!callMuted);callEl('callMute').textContent=callMuted?'Mikrofon einschalten':'Mikrofon stummschalten';});
  callEl('callCamera')?.addEventListener('click',()=>{callCameraOff=!callCameraOff;localCallStream?.getVideoTracks().forEach(t=>t.enabled=!callCameraOff);callEl('callCamera').textContent=callCameraOff?'Kamera einschalten':'Kamera aus';});
  $('voiceCallBtn')?.addEventListener('click',()=>startCall('voice'));
  $('videoCallBtn')?.addEventListener('click',()=>startCall('video'));
  // Respect local archive/clear preferences when opening a private chat; this does not delete server data.
  const originalLoadPrivateHistory=loadPrivateHistory;

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

  restoreSession().then(()=>{setAuthMode('register');loadConfig();loadStories();loadFeed();if(token)connectChat();else $('authModal').classList.remove('hidden');return handlePayPalReturn();}).catch(e=>{if($('giftStatus'))$('giftStatus').textContent='Initialisierung fehlgeschlagen: '+e.message;});
})();
