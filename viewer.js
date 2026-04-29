import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const stage = $('stage');
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const animPanel = $('anim-panel');
const animList = $('anim-list');
const btnPlay = $('btn-play');
const btnPause = $('btn-pause');
const speedInput = $('speed');
const speedVal = $('speed-val');
const timeline = $('timeline');
const timeCur = $('time-cur');
const timeTotal = $('time-total');
const displayPanel = $('display-panel');

// Sidebar — model panel
const modelDrop = $('model-drop');
const modelInput = $('model-input');
const modelHier = $('model-hier');
const modelInfo = $('model-info');
const modelFname = $('model-fname');
const modelFsize = $('model-fsize');
const modelCount = $('model-count');
const modelClear = $('model-clear');

// Sidebar — animation panel
const animDrop = $('anim-drop');
const animInputFile = $('anim-input');
const animHier = $('anim-hier');
const animInfo = $('anim-info');
const animFname = $('anim-fname');
const animFsize = $('anim-fsize');
const animCount = $('anim-count');
const animClear = $('anim-clear');

// ─── Scene setup ─────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171f);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(3, 2, 4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const groundGeo = new THREE.PlaneGeometry(40, 40);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(40, 40, 0x2a2f3d, 0x1f242f);
grid.position.y = 0.001;
scene.add(grid);

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
sun.shadow.bias = -0.0005;
scene.add(sun);

// ─── State ───────────────────────────────────────────────────────

let modelData = null;  // { url, name, size, root, clips }
let animData = null;   // { url, name, size, scene, clips }

let mixer = null;
let actions = [];      // { source, name, clip, action }
let activeAction = null;
let activeClip = null;
let activeFps = 30;
let isPlaying = true;
let isScrubbing = false;
let displayMode = 'mesh';
let skeletonHelper = null;
const originalMaterials = new Map();

const clock = new THREE.Clock();

// ─── Resize ──────────────────────────────────────────────────────

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ─── Render loop ─────────────────────────────────────────────────

function tick() {
  const dt = clock.getDelta();
  if (mixer && isPlaying && !isScrubbing) {
    mixer.update(dt);
    syncTimelineFromAction();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

function syncTimelineFromAction() {
  if (!activeAction || !activeClip || isScrubbing) return;
  const t = activeAction.time % activeClip.duration;
  const frame = Math.round(t * activeFps);
  timeline.value = frame;
  timeCur.textContent = frame;
}

// ─── Helpers ─────────────────────────────────────────────────────

const loader = new GLTFLoader();

function formatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024;
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + u[i];
}

function showLoading(on) {
  let el = document.getElementById('loading');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading';
      el.textContent = 'Loading…';
      stage.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}

function isGltfFile(file) {
  return /\.(glb|gltf)$/i.test(file.name);
}

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// ─── Model load/unload ───────────────────────────────────────────

async function loadModel(file) {
  if (!file || !isGltfFile(file)) {
    alert('Only .glb / .gltf files are supported');
    return;
  }
  clearModel();
  showLoading(true);
  const url = URL.createObjectURL(file);

  try {
    const gltf = await loadGLTF(url);
    const root = gltf.scene;

    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        originalMaterials.set(o, o.material);
      }
    });
    scene.add(root);

    skeletonHelper = new THREE.SkeletonHelper(root);
    const mat = skeletonHelper.material;
    if (mat && mat.isLineBasicMaterial) {
      mat.color.set(0x22d3ee);
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.toneMapped = false;
    }
    skeletonHelper.renderOrder = 999;
    skeletonHelper.visible = false;
    scene.add(skeletonHelper);

    frameObject(root);

    modelData = {
      url,
      name: file.name,
      size: file.size,
      root,
      clips: gltf.animations || [],
    };

    showModelInfo();
    buildHierarchy(modelHier, root);
    updateModelCount();
    rebuildMixer();
    applyDisplayMode();
  } catch (err) {
    console.error(err);
    alert('Error loading model: ' + (err?.message || err));
    URL.revokeObjectURL(url);
  } finally {
    showLoading(false);
  }
}

function clearModel() {
  if (!modelData) return;
  scene.remove(modelData.root);
  modelData.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      });
    }
  });
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper.dispose?.();
    skeletonHelper = null;
  }
  URL.revokeObjectURL(modelData.url);
  modelData = null;
  originalMaterials.clear();

  hideModelInfo();
  modelHier.innerHTML = '<p class="empty-state">No model loaded</p>';
  modelCount.textContent = '0';
  rebuildMixer();
}

// ─── Animation load/unload ───────────────────────────────────────

async function loadAnimation(file) {
  if (!file || !isGltfFile(file)) {
    alert('Only .glb / .gltf files are supported');
    return;
  }
  clearAnimationOnly();
  showLoading(true);
  const url = URL.createObjectURL(file);

  try {
    const gltf = await loadGLTF(url);
    if (!gltf.animations || gltf.animations.length === 0) {
      alert('No animations found in file');
      URL.revokeObjectURL(url);
      showLoading(false);
      return;
    }

    animData = {
      url,
      name: file.name,
      size: file.size,
      scene: gltf.scene,
      clips: gltf.animations,
    };

    showAnimInfo();
    buildHierarchy(animHier, gltf.scene);
    updateAnimCount();
    rebuildMixer();
  } catch (err) {
    console.error(err);
    alert('Error loading animation: ' + (err?.message || err));
    URL.revokeObjectURL(url);
  } finally {
    showLoading(false);
  }
}

function clearAnimationOnly() {
  if (!animData) return;
  URL.revokeObjectURL(animData.url);
  animData = null;
  hideAnimInfo();
  animHier.innerHTML = '<p class="empty-state">No animation loaded</p>';
  animCount.textContent = '0';
  rebuildMixer();
}

// ─── Mixer rebuild ───────────────────────────────────────────────

function rebuildMixer() {
  // Tear down old mixer
  if (mixer) {
    mixer.stopAllAction();
    actions.forEach(a => mixer.uncacheAction(a.clip));
    mixer = null;
  }
  actions = [];
  activeAction = null;
  activeClip = null;

  if (!modelData) {
    renderAnimList();
    animPanel.classList.add('hidden');
    return;
  }

  mixer = new THREE.AnimationMixer(modelData.root);

  const all = [];
  if (modelData.clips.length) {
    modelData.clips.forEach((clip) => all.push({ source: 'model', clip }));
  }
  if (animData?.clips.length) {
    animData.clips.forEach((clip) => all.push({ source: 'anim', clip }));
  }

  actions = all.map((entry, i) => ({
    source: entry.source,
    name: entry.clip.name || `Clip ${i}`,
    clip: entry.clip,
    action: mixer.clipAction(entry.clip),
  }));

  renderAnimList();

  if (actions.length > 0) {
    animPanel.classList.remove('hidden');
    // Prefer first 'anim' source if present, else first model clip
    const animIdx = actions.findIndex(a => a.source === 'anim');
    playAnim(animIdx >= 0 ? animIdx : 0);
  } else {
    animPanel.classList.add('hidden');
  }
}

// ─── Camera framing ──────────────────────────────────────────────

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.6;

  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(dist * 0.7, dist * 0.5, dist));
  camera.near = maxDim / 1000;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
  controls.update();

  ground.position.y = box.min.y - 0.001;
  grid.position.y = box.min.y;
}

// ─── Animation list ──────────────────────────────────────────────

function renderAnimList() {
  animList.innerHTML = '';
  if (actions.length === 0) {
    const note = document.createElement('p');
    note.className = 'anim-note';
    note.textContent = 'Load an animation';
    animList.appendChild(note);
    return;
  }
  actions.forEach((a, i) => {
    const btn = document.createElement('button');
    btn.dataset.index = i;
    btn.className = 'anim-btn src-' + a.source;
    btn.innerHTML = `
      <span class="anim-src">${a.source === 'model' ? 'M' : 'A'}</span>
      <span class="anim-name">${a.name}</span>
    `;
    btn.title = a.source === 'model' ? 'From model file' : 'From animation file';
    btn.addEventListener('click', () => playAnim(i));
    animList.appendChild(btn);
  });
}

function detectFps(clip) {
  for (const track of clip.tracks) {
    const times = track.times;
    if (times.length < 2) continue;
    let minDelta = Infinity;
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1];
      if (d > 1e-4 && d < minDelta) minDelta = d;
    }
    if (isFinite(minDelta) && minDelta > 0) {
      const fps = 1 / minDelta;
      for (const candidate of [24, 25, 30, 50, 60, 120]) {
        if (Math.abs(fps - candidate) < 0.5) return candidate;
      }
      return Math.max(1, Math.round(fps));
    }
  }
  return 30;
}

function playAnim(index) {
  const next = actions[index];
  if (!next) return;

  if (activeAction && activeAction !== next.action) {
    activeAction.fadeOut(0.3);
  }
  next.action.reset().setEffectiveTimeScale(parseFloat(speedInput.value)).fadeIn(0.3).play();
  next.action.paused = !isPlaying;
  activeAction = next.action;
  activeClip = next.clip;
  activeFps = detectFps(next.clip);

  const totalFrames = Math.max(1, Math.round(next.clip.duration * activeFps));
  timeline.min = 0;
  timeline.max = totalFrames;
  timeline.value = 0;
  timeCur.textContent = '0';
  timeTotal.textContent = totalFrames;

  Array.from(animList.children).forEach((el, i) => {
    if (el.classList) el.classList.toggle('active', i === index);
  });
}

function setPlaying(playing) {
  isPlaying = playing;
  if (activeAction) activeAction.paused = !isPlaying;
  btnPlay.classList.toggle('active', isPlaying);
  btnPause.classList.toggle('active', !isPlaying);
}

btnPlay.addEventListener('click', () => setPlaying(true));
btnPause.addEventListener('click', () => setPlaying(false));

timeline.addEventListener('pointerdown', () => { isScrubbing = true; });
timeline.addEventListener('pointerup', () => { isScrubbing = false; });
timeline.addEventListener('pointercancel', () => { isScrubbing = false; });
timeline.addEventListener('input', () => {
  if (!activeAction || !activeClip) return;
  const frame = parseInt(timeline.value, 10);
  const t = Math.min(frame / activeFps, activeClip.duration);
  activeAction.time = t;
  mixer.update(0);
  timeCur.textContent = frame;
});

speedInput.addEventListener('input', () => {
  const v = parseFloat(speedInput.value);
  speedVal.textContent = v.toFixed(2) + '×';
  if (activeAction) activeAction.setEffectiveTimeScale(v);
});

// ─── Display modes ───────────────────────────────────────────────

displayPanel.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    displayPanel.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    displayMode = btn.dataset.mode;
    applyDisplayMode();
  });
});

function applyDisplayMode() {
  if (!modelData) return;

  const showMesh = displayMode === 'mesh' || displayMode === 'wireframe';
  const showSkeleton = displayMode === 'skeleton';

  modelData.root.traverse((o) => {
    if (!o.isMesh) return;

    if (displayMode === 'wireframe') {
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      wireMat._isViewerWire = true;
      o.material = wireMat;
    } else {
      if (o.material && o.material._isViewerWire) {
        o.material.dispose();
        o.material = originalMaterials.get(o);
      }
    }

    o.visible = showMesh;
  });

  if (skeletonHelper) skeletonHelper.visible = showSkeleton;
}

// ─── Hierarchy ───────────────────────────────────────────────────

const ICONS = {
  Mesh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>',
  SkinnedMesh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>',
  Bone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18l12-12M6 6h3v3M15 15h3v3"/></svg>',
  Group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></svg>',
  Object3D: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
  Scene: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  Default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>',
};

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';

function buildHierarchy(container, root) {
  container.innerHTML = '';
  container.appendChild(renderNode(root, 0));
}

function renderNode(obj, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'node';

  const row = document.createElement('div');
  row.className = 'node-row';

  const chevron = document.createElement('span');
  chevron.className = 'chevron' + (obj.children.length ? ' open' : ' empty');
  chevron.innerHTML = CHEVRON;
  row.appendChild(chevron);

  const icon = document.createElement('span');
  icon.className = 'node-icon t-' + obj.type;
  icon.innerHTML = ICONS[obj.type] || ICONS.Default;
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'node-name';
  if (obj.name) {
    name.textContent = obj.name;
  } else {
    name.textContent = obj.type;
    name.classList.add('unnamed');
  }
  row.appendChild(name);

  const type = document.createElement('span');
  type.className = 'node-type';
  type.textContent = obj.type;
  row.appendChild(type);

  wrap.appendChild(row);

  if (obj.children.length) {
    const kids = document.createElement('div');
    kids.className = 'node-children';
    obj.children.forEach((child) => kids.appendChild(renderNode(child, depth + 1)));
    wrap.appendChild(kids);

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = chevron.classList.toggle('open');
      kids.style.display = open ? '' : 'none';
    });
  }

  return wrap;
}

function countNodes(root) {
  let n = 0;
  root.traverse(() => n++);
  return n;
}

function updateModelCount() {
  modelCount.textContent = modelData ? countNodes(modelData.root) : 0;
}

function updateAnimCount() {
  animCount.textContent = animData ? animData.clips.length : 0;
}

// ─── Sidebar info show/hide ──────────────────────────────────────

function showModelInfo() {
  modelDrop.classList.add('hidden');
  modelHier.classList.remove('hidden');
  modelInfo.classList.remove('hidden');
  modelClear.classList.remove('hidden');
  modelFname.textContent = modelData.name;
  modelFsize.textContent = formatBytes(modelData.size);
  // Hide stage centered drop zone
  dropZone.classList.add('hidden');
}

function hideModelInfo() {
  modelDrop.classList.remove('hidden');
  modelHier.classList.add('hidden');
  modelInfo.classList.add('hidden');
  modelClear.classList.add('hidden');
  // Show stage centered drop again
  dropZone.classList.remove('hidden');
}

function showAnimInfo() {
  animDrop.classList.add('hidden');
  animHier.classList.remove('hidden');
  animInfo.classList.remove('hidden');
  animClear.classList.remove('hidden');
  animFname.textContent = animData.name;
  animFsize.textContent = formatBytes(animData.size);
}

function hideAnimInfo() {
  animDrop.classList.remove('hidden');
  animHier.classList.add('hidden');
  animInfo.classList.add('hidden');
  animClear.classList.add('hidden');
}

// ─── Drop / file input wiring ────────────────────────────────────

function wireDropTarget(zone, input, onFile) {
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = '';
  });
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', (e) => {
    if (zone.contains(e.relatedTarget)) return;
    zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
}

// Stage centered drop = model
wireDropTarget(dropZone, fileInput, loadModel);
// Sidebar — model panel
wireDropTarget(modelDrop, modelInput, loadModel);
// Sidebar — animation panel
wireDropTarget(animDrop, animInputFile, loadAnimation);

// Clear buttons
modelClear.addEventListener('click', (e) => {
  e.stopPropagation();
  clearModel();
});
animClear.addEventListener('click', (e) => {
  e.stopPropagation();
  clearAnimationOnly();
});
