/* GameTik 3D gift renderer v1.9.30.
   Animations are triggered only after the app confirms a gift was sent/received.
   Transparent WebGL overlay; no UI click interception and no payment side effects. */
(function () {
  'use strict';
  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
  let threePromise = null, renderer = null, scene = null, camera = null, stage = null;
  let canvas = null, raf = 0, active = [], resizeObserver = null, studioEnv = null;
  const PALETTE = {
    Herz: 0xff347f, Stern: 0x38dfff, Feuer: 0xff7628, Krone: 0xc18aff,
    Bonbon: 0xff56c7, Lutscher: 0xff4eaa, Gummibär: 0x5affbd, Schokolade: 0xb8754e,
    Rose: 0xff3e8c, Diamant: 0x68e7ff, Kristall: 0x9e8cff, Supercar: 0x38dfff,
    Phönix: 0xff6c38, Galaxy: 0x8e5cff, Thron: 0x64e9ff, Universum: 0xb15cff,
    Süßigkeit: 0xff56c7
  };
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = THREE_CDN; script.async = true;
      script.onload = () => window.THREE ? resolve(window.THREE) : reject(new Error('Three.js wurde geladen, ist aber nicht verfügbar.'));
      script.onerror = () => reject(new Error('Three.js konnte nicht geladen werden. Bitte Internetverbindung prüfen.'));
      document.head.appendChild(script);
    });
    return threePromise;
  }
  function findStage() {
    return document.getElementById('liveVideoStage') ||
      document.getElementById('liveVideoGrid') ||
      document.querySelector('#livePanel video')?.parentElement;
  }
  function setup(T) {
    stage = findStage();
    if (!stage || !stage.isConnected) return false;
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    canvas = document.getElementById('gtGift3DCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.id = 'gtGift3DCanvas';
      canvas.setAttribute('aria-hidden', 'true'); stage.appendChild(canvas);
    }
    Object.assign(canvas.style, { position:'absolute', inset:'0', width:'100%', height:'100%',
      zIndex:'7', pointerEvents:'none', display:'block' });
    scene = new T.Scene();
    /* Procedurale Studio-Reflexionen: metallischer Glanz ohne zusätzliche Bilddateien. */
    if (!studioEnv) {
      const envCanvas = document.createElement('canvas'); envCanvas.width = 512; envCanvas.height = 256;
      const ctx = envCanvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 512, 0);
      grad.addColorStop(0, '#080a13'); grad.addColorStop(.22, '#34384a');
      grad.addColorStop(.32, '#f5f8ff'); grad.addColorStop(.38, '#68758d');
      grad.addColorStop(.52, '#171c2a'); grad.addColorStop(.69, '#dce8ff');
      grad.addColorStop(.76, '#24283a'); grad.addColorStop(1, '#080a13');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 256);
      const top = ctx.createLinearGradient(0, 0, 0, 256);
      top.addColorStop(0, '#ffffff'); top.addColorStop(.18, '#30384a'); top.addColorStop(.5, '#090b13'); top.addColorStop(.82, '#5b2c63'); top.addColorStop(1, '#101728');
      ctx.globalAlpha = .42; ctx.fillStyle = top; ctx.fillRect(0, 0, 512, 256); ctx.globalAlpha = 1;
      studioEnv = new T.CanvasTexture(envCanvas); studioEnv.mapping = T.EquirectangularReflectionMapping;
      if ('colorSpace' in studioEnv && T.SRGBColorSpace) studioEnv.colorSpace = T.SRGBColorSpace;
    }
    scene.environment = studioEnv;
    camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    renderer = new T.WebGLRenderer({ canvas, alpha:true, antialias:true, powerPreference:'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    scene.add(new T.AmbientLight(0xffffff, 1.7));
    const key = new T.DirectionalLight(0xffffff, 2.5); key.position.set(3, 4, 7); scene.add(key);
    const rim = new T.PointLight(0x25dfff, 12); rim.position.set(-3, 1, 4); scene.add(rim);
    const pink = new T.PointLight(0xff28bd, 8); pink.position.set(3, -1, 3); scene.add(pink);
    resize();
    window.addEventListener('resize', resize, { passive:true });
    if ('ResizeObserver' in window) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); }
    return true;
  }
  function resize() {
    if (!renderer || !stage || !camera) return;
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function material(T, color, metalness=.82, roughness=.13) {
    return new T.MeshStandardMaterial({ color, metalness, roughness, envMap:studioEnv || null, envMapIntensity:1.55, emissive:color, emissiveIntensity:.045 });
  }
  function extrudedShape(T, points, color, depth=.18) {
    const shape = new T.Shape();
    points.forEach((p, i) => i ? shape.lineTo(p[0],p[1]) : shape.moveTo(p[0],p[1]));
    shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth, bevelEnabled:true, bevelSegments:3, bevelSize:.045, bevelThickness:.045 });
    return new T.Mesh(geometry, material(T,color,.62,.2));
  }
  function makeGift(T, rawName) {
    const name = normalizeName(rawName), color = PALETTE[name] || 0x39ddff, group = new T.Group();
    let main;
    if (name === 'Herz') {
      const s = new T.Shape(); s.moveTo(0,.22); s.bezierCurveTo(-.12,.58,-.68,.55,-.66,.08);
      s.bezierCurveTo(-.65,-.22,-.24,-.48,0,-.72); s.bezierCurveTo(.24,-.48,.65,-.22,.66,.08);
      s.bezierCurveTo(.68,.55,.12,.58,0,.22);
      main = new T.Mesh(new T.ExtrudeGeometry(s,{depth:.24,bevelEnabled:true,bevelSegments:5,bevelSize:.07,bevelThickness:.07}),material(T,color,.45,.16));
    } else if (name === 'Stern') {
      const pts=[]; for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?.29:.7;pts.push([Math.cos(a)*r,Math.sin(a)*r]);}
      main=extrudedShape(T,pts,color,.2);
    } else if (name === 'Krone') {
      main=extrudedShape(T,[[-.7,-.38],[-.58,.35],[-.22,-.02],[0,.58],[.22,-.02],[.6,.35],[.7,-.38]],color,.24);
      [-.48,0,.48].forEach((x,i)=>{const gem=new T.Mesh(new T.OctahedronGeometry(.105,1),material(T,[0xff4eaa,0x50eaff,0xffd45c][i],.8,.1));gem.position.set(x,i===1?.08:0,.38);group.add(gem);});
    } else if (name === 'Feuer' || name === 'Phönix') {
      main=new T.Mesh(new T.ConeGeometry(.48,1.3,7,3),material(T,color,.25,.2));
      main.rotation.z=.12;
      if(name==='Phönix'){const wing=extrudedShape(T,[[-.05,0],[-.75,.48],[-.5,.02],[-.68,-.42],[0,-.1]],0xffb14a,.08);wing.position.x=-.15;wing.position.z=-.1;group.add(wing);const wing2=wing.clone();wing2.scale.x=-1;wing2.position.x=.15;group.add(wing2);}
    } else if (name === 'Bonbon' || name === 'Süßigkeit') {
      main=new T.Mesh(new T.SphereGeometry(.36,24,18),material(T,color,.18,.2));
      [-1,1].forEach(sign=>{const twist=new T.Mesh(new T.ConeGeometry(.19,.34,8),material(T,sign<0?0x36dfff:0xffd6f2,.3,.25));twist.position.set(sign*.43,0,0);twist.rotation.z=sign<0?Math.PI/2:-Math.PI/2;group.add(twist);});
      const stripe=new T.Mesh(new T.TorusGeometry(.28,.035,8,32),material(T,0xffffff,.2,.25));stripe.rotation.y=.8;group.add(stripe);
    } else if (name === 'Lutscher') {
      main=new T.Mesh(new T.SphereGeometry(.4,28,22),material(T,color,.35,.15));
      const swirl=new T.Mesh(new T.TorusGeometry(.23,.035,8,32),material(T,0xffffff,.2,.2));swirl.position.z=.35;group.add(swirl);
      const stick=new T.Mesh(new T.CylinderGeometry(.045,.045,.62,10),material(T,0xffffff,.1,.4));stick.position.y=-.58;group.add(stick);
    } else if (name === 'Gummibär') {
      const body=new T.Mesh(new T.SphereGeometry(.3,20,16),material(T,color,.12,.24));body.scale.set(1,1.22,.72);body.position.y=-.12;group.add(body);
      const head=new T.Mesh(new T.SphereGeometry(.24,20,16),material(T,color,.12,.24));head.position.y=.3;group.add(head);
      [[-.29,.02],[.29,.02],[-.2,-.4],[.2,-.4]].forEach(([x,y])=>{const limb=new T.Mesh(new T.SphereGeometry(.12,14,10),material(T,color,.1,.26));limb.position.set(x,y,0);group.add(limb);});
      const eyeMat=new T.MeshBasicMaterial({color:0x24132f});[-.08,.08].forEach(x=>{const eye=new T.Mesh(new T.SphereGeometry(.025,8,6),eyeMat);eye.position.set(x,.34,.21);group.add(eye);});
      main=null;
    } else if (name === 'Schokolade') {
      main=new T.Mesh(new T.BoxGeometry(.9,.65,.22),material(T,0x57301f,.35,.25));
      for(let x=-.3;x<=.31;x+=.3)for(let y=-.18;y<=.19;y+=.36){const square=new T.Mesh(new T.BoxGeometry(.24,.23,.08),material(T,0x9c5a36,.2,.28));square.position.set(x,y,.16);group.add(square);}
    } else if (name === 'Rose') {
      const stem=new T.Mesh(new T.CylinderGeometry(.025,.04,.95,8),material(T,0x3ad67b,.2,.35));stem.position.y=-.38;group.add(stem);
      for(let i=0;i<5;i++){const petal=new T.Mesh(new T.SphereGeometry(.23,18,12),material(T,color,.3,.2));const a=i*Math.PI*2/5;petal.position.set(Math.cos(a)*.17,.25+Math.sin(a)*.17,Math.sin(a)*.08);petal.scale.set(1,.7,.65);group.add(petal);}
      main=new T.Mesh(new T.SphereGeometry(.18,18,14),material(T,0xff92bd,.3,.2));main.position.y=.25;
    } else if (name === 'Diamant' || name === 'Kristall') {
      main=new T.Mesh(new T.OctahedronGeometry(.62, name==='Kristall'?1:0),material(T,color,.88,.1));
      const ring=new T.Mesh(new T.TorusGeometry(.78,.025,8,48),material(T,0xffffff,.8,.1));ring.rotation.x=.7;group.add(ring);
    } else if (name === 'Supercar') {
      main=new T.Mesh(new T.BoxGeometry(1.25,.28,.48),material(T,color,.8,.14));main.position.y=-.08;
      const cabin=new T.Mesh(new T.BoxGeometry(.58,.27,.4),material(T,0x9defff,.6,.12));cabin.position.set(-.08,.17,0);group.add(cabin);
      [-.4,.4].forEach(x=>{const wheel=new T.Mesh(new T.TorusGeometry(.13,.055,8,20),material(T,0x202638,.25,.4));wheel.position.set(x,-.25,.2);group.add(wheel);});
    } else if (name === 'Galaxy' || name === 'Universum') {
      main=new T.Mesh(new T.SphereGeometry(name==='Universum'?.56:.48,28,22),material(T,color,.6,.13));
      for(let i=0;i<3;i++){const ring=new T.Mesh(new T.TorusGeometry(.72+i*.1,.018,8,48),material(T,[0x36dfff,0xff42c8,0xd7c2ff][i],.8,.12));ring.rotation.set(i*.7,i*.55,.5+i*.5);group.add(ring);}
      if(name==='Universum'){for(let i=0;i<7;i++){const star=new T.Mesh(new T.SphereGeometry(.035,8,6),new T.MeshBasicMaterial({color:0xffffff}));const a=i*2.4;star.position.set(Math.cos(a)*(.8+i*.04),Math.sin(a)*(.8+i*.04),.1);group.add(star);}}
    } else if (name === 'Thron') {
      main=extrudedShape(T,[[-.55,-.55],[-.55,.35],[-.28,.12],[0,.52],[.28,.12],[.55,.35],[.55,-.55]],color,.18);
      const seat=new T.Mesh(new T.BoxGeometry(.95,.12,.42),material(T,0x8c62ff,.7,.18));seat.position.set(0,-.45,.22);group.add(seat);
    } else {
      // Named fallback still has a distinct 3D jewel rather than a flat emoji/icon.
      main=new T.Mesh(new T.DodecahedronGeometry(.52,1),material(T,color,.78,.13));
      const ring=new T.Mesh(new T.TorusGeometry(.7,.025,8,40),material(T,0x25dfff,.8,.13));ring.rotation.x=.7;group.add(ring);
    }
    if(main) { main.position.z += .06; group.add(main); }
    const halo=new T.Mesh(new T.TorusGeometry(.83,.016,8,48),new T.MeshBasicMaterial({color:0x25dfff,transparent:true,opacity:.68}));
    halo.position.z=-.24;group.add(halo);group.userData.giftName=name;
    return group;
  }
  function normalizeName(raw) {
    const original=String(raw||'Süßigkeit').trim();
    const premium=/^GAMETIK-GIFT-(\d{1,4})$/i.exec(original);
    if(premium){const price=Number(premium[1]);const models=['Kristall','Bonbon','Lutscher','Gummibär','Schokolade','Herz','Stern','Feuer','Krone','Rose','Diamant','Supercar','Phönix','Galaxy','Thron','Universum'];return models[Math.min(models.length-1,Math.floor(((price-5)%200)/12.5))];}
    const n=original.toLowerCase();
    const aliases=[
      [/herz|heart/,'Herz'],[/stern|star/,'Stern'],[/feuer|fire/,'Feuer'],[/krone|crown/,'Krone'],
      [/bonbon|candy|süßigkeit|suessigkeit/,'Bonbon'],[/lolli|lutscher/,'Lutscher'],[/gummibär|gummibaer|gummy/,'Gummibär'],
      [/schoko|chocolate/,'Schokolade'],[/rose/,'Rose'],[/diamant|diamond/,'Diamant'],[/kristall|crystal/,'Kristall'],
      [/supercar|sportwagen|auto/,'Supercar'],[/phönix|phoenix/,'Phönix'],[/galaxy|galaxie|portal/,'Galaxy'],
      [/thron|throne/,'Thron'],[/universum|universe/,'Universum']
    ];
    return (aliases.find(([re])=>re.test(n))||[])[1] || 'Süßigkeit';
  }
  function animate() {
    raf=0;if(!renderer)return;
    const now=performance.now();
    active=active.filter(o=>{ if(now-o.start<4200) return true; scene.remove(o.mesh); o.mesh.traverse(n=>{ if(n.geometry) n.geometry.dispose(); if(n.material) (Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose()); }); return false; });
    for(const o of active){
      const t=(now-o.start)/4200;
      /* Gifts only: clear, deliberate 3D rise, full turn, and settle. */
      o.mesh.position.x=o.mesh.userData.giftName==='Krone'?0:o.mesh.position.x;
      o.mesh.position.y=-.55+Math.sin(t*Math.PI)*1.55;
      o.mesh.rotation.y=t*Math.PI*4.2;o.mesh.rotation.x=Math.sin(t*Math.PI*2)*.18;o.mesh.rotation.z=Math.sin(t*Math.PI*4)*.09;
      o.mesh.scale.setScalar((.62+Math.sin(t*Math.PI)*.72)*o.scale);
      o.mesh.traverse(n=>{if(n.material&&'opacity'in n.material){n.material.transparent=true;n.material.opacity=Math.min(1,(1-t)*2.4);}});
    }
    renderer.render(scene,camera);
    if(active.length)raf=requestAnimationFrame(animate);
  }
  async function play(rawName, quantity=1, sender='') {
    try {
      const T=await loadThree();if(!renderer&&!setup(T))return false;
      const name=normalizeName(rawName), qty=Math.max(1,Math.min(999,Number(quantity)||1));
      const mesh=makeGift(T,name);
      const isCrown=name==='Krone';mesh.position.set(isCrown?0:((Math.random()-.5)*1.5),isCrown?-1.9:-1.9,0);
      const scale=Math.min(isCrown?2.84:1.42,(isCrown?2.04:1.02)+Math.log2(qty)*.08);mesh.scale.setScalar(scale);scene.add(mesh);
      active.push({mesh,start:performance.now(),scale});
      const label=document.createElement('div');label.className='gt-gift3d-label';
      label.textContent=(sender||'Community')+' sendet '+(qty>1?qty+'× ':'')+String(rawName||name);
      stage.appendChild(label);window.setTimeout(()=>label.remove(),3400);
      if(!raf)raf=requestAnimationFrame(animate);return true;
    } catch(e) { console.error('[GameTik 3D-Geschenke] Animation fehlgeschlagen:',e); showFallback(rawName, quantity, sender); return false; }
  }

  function showFallback(rawName, quantity, sender) {
    const target=findStage(); if(!target) return;
    const el=document.createElement('div'); el.className='gt-gift3d-fallback';
    el.textContent='🎁 '+(sender||'Community')+' sendet '+(Number(quantity)>1?Math.min(999,Number(quantity))+'× ':'')+String(rawName||'Geschenk');
    target.appendChild(el); window.setTimeout(()=>el.remove(),2600);
  }
  window.GameTikGift3D={play,normalizeName};
  const style=document.createElement('style');
  style.textContent='#gtGift3DCanvas{overflow:hidden}.gt-gift3d-fallback{position:absolute;z-index:10;left:50%;top:25%;transform:translateX(-50%);padding:9px 13px;border-radius:999px;background:linear-gradient(100deg,#24112fe8,#111b30e8);border:1px solid #ff42c8;color:#fff;font-weight:850;pointer-events:none;animation:gtGift3DLabel 2.6s ease-out forwards}.gt-gift3d-label{position:absolute;z-index:9;left:50%;top:18%;transform:translateX(-50%);max-width:85%;padding:7px 12px;border-radius:999px;border:1px solid #54e9ff99;background:linear-gradient(100deg,#24112fe8,#111b30e8);color:#fff;font-weight:850;font-size:clamp(11px,2.8vw,15px);text-align:center;box-shadow:0 0 18px #ff35c844,0 0 20px #25dfff33;pointer-events:none;animation:gtGift3DLabel 3.3s ease-out forwards!important}@keyframes gtGift3DLabel{0%{opacity:0;transform:translate(-50%,15px) scale(.7)}15%,72%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-20px) scale(.9)}}@media(prefers-reduced-motion:reduce){.gt-gift3d-label{animation-duration:.8s}}';
  document.head.appendChild(style);
})();
