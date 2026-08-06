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
