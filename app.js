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
    if(name==='explore') loadExplore();
    if(name==='upload') $('videoCaption')?.focus({preventScroll:true});
  }
  function movePage(direction) {
    const active = pageOrder.findIndex(p=>!$(p.view+'View')?.classList.contains('hidden'));
    const next = Math.max(0,Math.min(pageOrder.length-1,(active<0?0:active)+direction));
    if(next!==active) { showView(pageOrder[next].view,pageOrder[next].nav); window.scrollTo({top:0,behavior:'smooth'}); }
  }
  // Touch navigation: horizontal or vertical swipe switches the five real views.
  let navTouchStart=null;
  const ignoreSwipe = el => !!el.closest('input,textarea,select,button,a,[contenteditable="true"],video,audio,.chat-box,.story-list,.profile-tabs,.story-modal,.modal');
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1 || ignoreSwipe(e.target)) { navTouchStart=null; return; }
    const t=e.touches[0]; navTouchStart={x:t.clientX,y:t.clientY};
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!navTouchStart || !e.changedTouches.length) return;
    const t=e.changedTouches[0], dx=t.clientX-navTouchStart.x, dy=t.clientY-navTouchStart.y;
    navTouchStart=null;
    if(Math.max(Math.abs(dx),Math.abs(dy))<75) return;
    if(Math.abs(dx)>Math.abs(dy)) movePage(dx<0?1:-1);
    else if(Math.abs(dy)>Math.abs(dx)*1.25) movePage(dy<0?1:-1);
  },{passive:true});
  // Desktop wheel navigation on non-scrollable page background; inner lists keep normal scrolling.
  let wheelLock=false;
  document.addEventListener('wheel',e=>{
    if(wheelLock || ignoreSwipe(e.target) || Math.abs(e.deltaY)<55 || Math.abs(e.deltaY)<Math.abs(e.deltaX)) return;
    const main=e.target.closest('.main'); if(!main) return;
    const target=e.target;
    if(target.closest('.panel') && target.closest('.panel').scrollHeight>target.closest('.panel').clientHeight+12) return;
    wheelLock=true; movePage(e.deltaY>0?1:-1); setTimeout(()=>wheelLock=false,650);
  },{passive:true});
  document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view,b.dataset.nav)));
  document.querySelectorAll('[data-feed-mode]').forEach(b=>b.addEventListener('click',()=>{showView('feed',b.dataset.feedMode);document.querySelectorAll('[data-feed-mode]').forEach(x=>x.classList.toggle('active',x===b));}));
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
  $('uploadForm').onsubmit=async e=>{e.preventDefault();const f=$('videoFile').files[0];const documentFile=$('documentFile')?.files?.[0];if(!f&&!documentFile){status('uploadStatus','Bitte ein Foto, Video oder Dokument auswählen.');return;}if(f&&f.size>35*1024*1024){status('uploadStatus','Die Datei ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}if(documentFile&&documentFile.size>35*1024*1024){status('uploadStatus','Das Dokument ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}const music=$('musicFile')?.files?.[0];if(music&&music.size>35*1024*1024){status('uploadStatus','Die Musikdatei ist größer als 35 MB. Bitte eine kleinere Datei wählen.');return;}if(music&&!(music.type==='audio/mpeg'||/\.mp3$/i.test(music.name))){status('uploadStatus','Bitte ausschließlich eine MP3-Musikdatei auswählen.');return;}const fd=new FormData();if(f)fd.append('video',f);if(documentFile)fd.append('document',documentFile);if(music)fd.append('music',music);fd.append('caption',$('videoCaption').value);fd.append('hashtags',$('videoHashtags')?.value||'');fd.append('visibility',$('videoVisibility')?.value||'public');try{if(!token)throw Error('Bitte zuerst einen Nickname wählen.');const d=await api('/api/videos',{method:'POST',body:fd});status('uploadStatus',documentFile&&!f?'Dokument erfolgreich hochgeladen!':documentFile?'Beitrag mit Anhang erfolgreich hochgeladen!':f.type.startsWith('image/')?'Foto erfolgreich hochgeladen!':'Video erfolgreich hochgeladen!',true);$('uploadForm').reset();showView('feed');}catch(err){status('uploadStatus',err.message);}};
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
  function startCall(kind){if(!token){$('authModal').classList.remove('hidden');updateChatToolStatus('Bitte zuerst anmelden.');return;}if(!privateRecipientId){updateChatToolStatus('Bitte zuerst einen privaten Kontakt auswählen.');return;}updateChatToolStatus((kind==='video'?'Videoanruf':'Sprachanruf')+' kann noch nicht verbunden werden: Für echte Anrufe muss die WebRTC-Signalisierung serverseitig ergänzt und beide Nutzer müssen online sein.');}
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

  restoreSession().then(()=>{loadConfig();loadStories();loadFeed();if(token)connectChat();else $('authModal').classList.remove('hidden');return handlePayPalReturn();}).catch(e=>{if($('giftStatus'))$('giftStatus').textContent='Initialisierung fehlgeschlagen: '+e.message;});
})();
