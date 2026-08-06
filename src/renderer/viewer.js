// 3D part preview — renders a GLB model in an overlay so users can inspect a
// part before downloading its CAD file. Exposed to app.js (classic script) as
// window.openPartPreview(url, title).
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';

const overlay = document.getElementById('viewer-overlay');
const titleEl = document.getElementById('viewer-title');
const statusEl = document.getElementById('viewer-status');
const canvasWrap = document.getElementById('viewer-canvas-wrap');

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let rafId = 0;
let currentRoot = null;
const loader = new GLTFLoader();

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasWrap.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ff, 0.8);
  fill.position.set(-4, -2, -3);
  scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  // First user interaction stops the turntable.
  controls.addEventListener('start', () => { controls.autoRotate = false; });
}

function resize() {
  if (!renderer || overlay.classList.contains('hidden')) return;
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  rafId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function clearModel() {
  if (!currentRoot) return;
  scene.remove(currentRoot);
  currentRoot.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
  currentRoot = null;
}

function fitCamera(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center); // center the part on the origin

  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.position.set(dist * 0.7, dist * 0.5, dist * 1.1);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

window.openPartPreview = (url, title) => {
  ensureRenderer();
  titleEl.textContent = title || '3D preview';
  statusEl.textContent = 'Loading model…';
  statusEl.classList.remove('hidden');
  overlay.classList.remove('hidden');
  clearModel();
  resize();
  cancelAnimationFrame(rafId);
  animate();

  loader.load(
    url,
    (gltf) => {
      clearModel();
      currentRoot = gltf.scene;
      // CAD exports carry no materials worth keeping — apply one clean look.
      currentRoot.traverse((o) => {
        if (o.isMesh) {
          o.material = new THREE.MeshStandardMaterial({
            color: 0x8fbf6e,
            metalness: 0.1,
            roughness: 0.55,
          });
        }
      });
      scene.add(currentRoot);
      fitCamera(currentRoot);
      controls.autoRotate = true;
      statusEl.classList.add('hidden');
    },
    undefined,
    () => {
      statusEl.textContent = 'Could not load the 3D preview.';
    }
  );
};

function closeViewer() {
  overlay.classList.add('hidden');
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearModel();
}

document.getElementById('viewer-close').addEventListener('click', closeViewer);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeViewer();
});
window.addEventListener('resize', resize);

// --- Turntable thumbnails ---
// Small always-rotating canvases used as the cover art for product cards in the
// library and as the hero of the product detail overlay. Kept separate from the
// overlay viewer above: thumbnails share cached geometry, so they must never
// dispose it.

const modelCache = new Map(); // url -> Promise<THREE.Group>

function loadModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
      })
    );
  }
  return modelCache.get(url).then((root) => root.clone(true));
}

const PART_MATERIAL = { color: 0x8fbf6e, metalness: 0.1, roughness: 0.55 };

window.mountPartThumb = (container, url, opts = {}) => {
  const speed = opts.speed != null ? opts.speed : 0.35; // radians / second
  const margin = opts.margin != null ? opts.margin : 1.05;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'thumb-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7);
  fill.position.set(-4, -2, -3);
  scene.add(fill);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let model = null;
  let raf = 0;
  let disposed = false;
  let last = 0;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return false;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }

  // Frame the part for a turntable: it only spins around Y, so its height and
  // its radius around that axis are both constant. Fitting those two keeps the
  // part as large as possible without it clipping at any angle — a plain
  // bounding-sphere fit would leave a tall part looking tiny.
  function frame() {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radiusXZ = 0.5 * Math.hypot(size.x, size.z) || 1;

    const fovV = (camera.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    const dist =
      Math.max(size.y * 0.5 / Math.tan(fovV / 2), radiusXZ / Math.sin(fovH / 2)) * margin;

    const tilt = 0.1; // look very slightly down on the part
    const reach = Math.max(size.y, radiusXZ * 2);
    camera.near = Math.max(dist - reach, 0.01);
    camera.far = dist + reach * 2;
    camera.position.set(
      center.x,
      center.y + Math.sin(tilt) * dist,
      center.z + Math.cos(tilt) * dist
    );
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(() => {
    if (resize()) frame();
  });
  ro.observe(container);

  function tick(now) {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    pivot.rotation.y += ((now - last) / 1000) * speed;
    last = now;
    renderer.render(scene, camera);
  }

  loadModel(url)
    .then((root) => {
      if (disposed) return;
      root.traverse((o) => {
        if (o.isMesh) o.material = new THREE.MeshStandardMaterial(PART_MATERIAL);
      });
      const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      root.position.sub(center); // spin around the part's own centre
      model = root;
      pivot.add(root);
      resize();
      frame();
      container.classList.add('thumb-ready');
      last = performance.now();
      raf = requestAnimationFrame(tick);
    })
    .catch(() => {
      if (!disposed) container.classList.add('thumb-failed');
    });

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};

document.dispatchEvent(new Event('viewer-ready'));
