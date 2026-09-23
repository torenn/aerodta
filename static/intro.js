(function(){
  const canvas   = document.getElementById('intro-canvas');
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02060c);
  scene.fog = new THREE.FogExp2(0x02060c, 0.007);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth/window.innerHeight, 0.1, 2000);
  camera.position.set(-55,12,80);
  camera.lookAt(0,3,0);

  scene.add(new THREE.AmbientLight(0x223355,3.0));
  const sun = new THREE.DirectionalLight(0x5577aa,3.5);
  sun.position.set(40,80,60); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.near=1; sun.shadow.camera.far=600;
  sun.shadow.camera.left=sun.shadow.camera.bottom=-120;
  sun.shadow.camera.right=sun.shadow.camera.top=120;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x112244,1.2);
  fill.position.set(-30,8,-40); scene.add(fill);
  const engineGlow = new THREE.PointLight(0xff7700,8,30);
  scene.add(engineGlow);

  // Ground
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshLambertMaterial({color:0x050d18}));
  gnd.rotation.x=-Math.PI/2; gnd.position.y=-2.2; gnd.receiveShadow=true; scene.add(gnd);
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(22,1000),new THREE.MeshLambertMaterial({color:0x091624}));
  rw.rotation.x=-Math.PI/2; rw.position.y=-2.18; scene.add(rw);
  for(let i=-25;i<=25;i++){
    const d=new THREE.Mesh(new THREE.PlaneGeometry(0.6,7),new THREE.MeshLambertMaterial({color:0x18385a}));
    d.rotation.x=-Math.PI/2; d.position.set(0,-2.17,i*14); scene.add(d);
  }
  const lm=new THREE.MeshPhongMaterial({color:0xffee66,emissive:0xffcc22,emissiveIntensity:2.5});
  for(let i=-22;i<=22;i++) [-10.5,10.5].forEach(x=>{
    const l=new THREE.Mesh(new THREE.SphereGeometry(0.22,7,7),lm);
    l.position.set(x,-2.0,i*10); scene.add(l);
  });
  const sv=[];
  for(let i=0;i<2500;i++) sv.push((Math.random()-.5)*1000,40+Math.random()*400,(Math.random()-.5)*1000);
  const sg=new THREE.BufferGeometry();
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sv,3));
  scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.45,transparent:true,opacity:0.7})));

  // ── Aircraft: wrapper Group animated by the timeline; GLB model lives inside ──
  const plane = new THREE.Group();
  plane.position.set(0,-2.2+0.9,-180);
  plane.rotation.y = Math.PI;
  scene.add(plane);
  engineGlow.position.set(0,-1.0,-180);

  // Target dimension for the model along its longest axis (matches original fuselage length ~16 units)
  const TARGET_LENGTH = 60;

  let start = null, rafId, done = false;
  let modelLoaded = false;

  // Reveal skip immediately, and let the loader hide the "building scene" spinner when done
  document.getElementById('introSkip').classList.add('show');
  document.getElementById('intro-loading').classList.add('hidden');

  const loader = new THREE.GLTFLoader();
  loader.load(
    '/static/scene.gltf',
    function (gltf) {
      const model = gltf.scene;

      // 1. Normalise scale so any model fits the scene
      const box0 = new THREE.Box3().setFromObject(model);
      const size0 = new THREE.Vector3();
      box0.getSize(size0);
      const maxDim = Math.max(size0.x, size0.y, size0.z) || 1;
      const s = TARGET_LENGTH / maxDim;
      model.scale.setScalar(s);

      // 2. Centre the model so it rotates about its own geometric centre
      const box1 = new THREE.Box3().setFromObject(model);
      const centre = new THREE.Vector3();
      box1.getCenter(centre);
      model.position.sub(centre);

      // 3. Enable shadows
      model.traverse(function (child) {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      plane.add(model);
      model.rotation.y = Math.PI;

      modelLoaded = true;
      document.getElementById('intro-loading').classList.add('hidden');
      requestAnimationFrame(loop);
    },
    undefined,
    function (err) {
      console.error('Failed to load /static/plane.glb', err);
      document.getElementById('intro-loading').innerHTML =
        '<div class="intro-loading-txt" style="color:#f87171">Could not load plane.glb — check /static/</div>';
      // Still hide spinner and start loop so the intro can be skipped / ended gracefully
      setTimeout(function(){
        document.getElementById('intro-loading').classList.add('hidden');
        requestAnimationFrame(loop);
      }, 1500);
    }
  );

  const TOTAL=5000;
  function lerp(a,b,t){return a+(b-a)*t;}
  function eO(t){return 1-Math.pow(1-t,3);}
  function eIO(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
  function eI(t){return t*t*t;}
  function cl(v,a,b){return Math.min(Math.max(v,a),b);}

  function loop(ts){
    rafId=requestAnimationFrame(loop);
    if(!start) start=ts;
    const t=cl((ts-start)/TOTAL,0,1);
    let px=0,py,pz,rx=0,ry=Math.PI;
    let cx,cy,cz,lx=0,ly,lz;

    if(t<=0.28){
      const p=eO(t/0.28);
      pz=lerp(-180,-50,p); py=-2.2+0.9;
      cx=lerp(-55,-48,p); cy=lerp(12,9,p); cz=lerp(80,65,p);
      ly=3; lz=pz+8; engineGlow.intensity=lerp(3,10,p);
    } else if(t<=0.52){
      const p=eIO((t-0.28)/0.24);
      pz=lerp(-50,30,p); py=lerp(-2.2+0.9,5,eO(p));
      rx=lerp(0,-0.22,p);
      cx=lerp(-48,-32,p); cy=lerp(9,8,p); cz=lerp(65,52,p);
      ly=lerp(3,7,p); lz=pz; engineGlow.intensity=12;
    } else if(t<=0.78){
      const p=eIO((t-0.52)/0.26);
      pz=lerp(30,120,p); py=lerp(5,55,eI(p));
      px=lerp(0,14,p); rx=lerp(-0.22,-0.38,p); ry=lerp(Math.PI,Math.PI+0.16,p);
      cx=lerp(-32,-12,p); cy=lerp(8,24,p); cz=lerp(52,45,p);
      lx=lerp(0,12,p); ly=lerp(7,30,p); lz=lerp(pz,pz+35,p);
      engineGlow.intensity=lerp(12,4,p);
    } else {
      const p=eI((t-0.78)/0.22);
      pz=lerp(120,300,p); py=lerp(55,180,p);
      px=lerp(14,40,p); rx=lerp(-0.38,-0.48,p); ry=lerp(Math.PI+0.16,Math.PI+0.3,p);
      plane.scale.setScalar(lerp(1,0.5,p));
      cx=lerp(-12,2,p); cy=lerp(24,42,p); cz=lerp(45,38,p);
      lx=lerp(12,30,p); ly=lerp(30,90,p); lz=lerp(pz,pz+60,p);
      engineGlow.intensity=Math.max(0,lerp(4,-3,p));
    }

    plane.position.set(px,py,pz);
    plane.rotation.set(rx,ry,0);
    engineGlow.position.set(px-5*Math.sin(ry),py-0.5,pz-5*Math.cos(ry));
    camera.position.set(cx,cy,cz);
    camera.lookAt(lx,ly,lz);

    if(t>0.06&&t<0.80) document.getElementById('introBrand').classList.add('show');
    else document.getElementById('introBrand').classList.remove('show');

    renderer.render(scene,camera);
    if(t>=1&&!done){done=true;endIntro();}
  }

  function endIntro(){
    cancelAnimationFrame(rafId);
    document.getElementById('intro').classList.add('exit');
    setTimeout(()=>{
      document.getElementById('intro').style.display='none';
      renderer.dispose();
      document.getElementById('app').classList.add('visible');
    },700);
  }

  window.skipIntro=()=>{if(!done){done=true;endIntro();}};
  window.addEventListener('resize',()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });
})();