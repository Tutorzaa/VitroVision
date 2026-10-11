/* VitroVision 3D — stylized plant driven by analysis scores (Three.js, ES module) */
import * as THREE from "three";

var METRIC_KEYS = ["leaf", "stem", "moisture", "roots"];
var S = {
  inited: false,
  renderer: null,
  scene: null,
  camera: null,
  leafMat: null,
  stemMat: null,
  soilMat: null,
  stem: null,
  leaves: [],
  bars: [],
  rotY: 0.6,
  targetRotY: 0.6,
  dragging: false,
  lastX: 0
};

function colorFor(v) {
  var g = new THREE.Color(0x2fa14f);
  var y = new THREE.Color(0xeab308);
  var r = new THREE.Color(0xdc2626);
  if (v >= 70) return y.clone().lerp(g, (v - 70) / 30);
  return r.clone().lerp(y, Math.max(v, 0) / 70);
}

function init(container) {
  var w = container.clientWidth || 300;
  var h = container.clientHeight || 260;

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);
  S.renderer = renderer;

  var scene = new THREE.Scene();
  S.scene = scene;

  var camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
  camera.position.set(0, 2.0, 4.8);
  camera.lookAt(0, 1.0, 0);
  S.camera = camera;

  scene.add(new THREE.HemisphereLight(0xd8f3dc, 0x1a2b1f, 0.95));
  var dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 5, 4);
  scene.add(dir);

  // Soil mound
  S.soilMat = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 1 });
  var soil = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.4, 32), S.soilMat);
  soil.position.y = 0;
  scene.add(soil);
  S.soil = soil;

  // Stem (pivot at base so it can droop)
  S.stemMat = new THREE.MeshStandardMaterial({ color: 0x3e7d44, roughness: 0.7 });
  var stemGeo = new THREE.CylinderGeometry(0.06, 0.1, 1.7, 12);
  stemGeo.translate(0, 0.85, 0);
  var stem = new THREE.Mesh(stemGeo, S.stemMat);
  stem.position.y = 0.2;
  scene.add(stem);
  S.stem = stem;

  // Leaves: flattened spheres around the stem
  S.leafMat = new THREE.MeshStandardMaterial({ color: 0x2fa14f, roughness: 0.65 });
  var leafGeo = new THREE.SphereGeometry(0.32, 14, 10);
  leafGeo.scale(1.5, 0.28, 0.75);
  for (var i = 0; i < 6; i++) {
    var a = (i / 6) * Math.PI * 2;
    var leaf = new THREE.Mesh(leafGeo, S.leafMat);
    var hh = 0.75 + (i % 3) * 0.38;
    leaf.position.set(Math.cos(a) * 0.42, 0.2 + hh, Math.sin(a) * 0.42);
    leaf.rotation.y = -a;
    leaf.rotation.z = 0.35;
    leaf.userData = { phase: i * 1.1, baseTilt: 0.35 };
    scene.add(leaf);
    S.leaves.push(leaf);
  }
  // Top bud
  var bud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), S.leafMat);
  bud.position.y = 2.0;
  scene.add(bud);

  // Metric bars behind the plant (left→right: leaf, stem, moisture, roots)
  for (var b = 0; b < 4; b++) {
    var bg = new THREE.BoxGeometry(0.42, 1, 0.42);
    bg.translate(0, 0.5, 0); // grow upward from base
    var bm = new THREE.MeshStandardMaterial({ color: 0x2fa14f, roughness: 0.6 });
    var bar = new THREE.Mesh(bg, bm);
    bar.position.set(-1.25 + b * 0.84, 0, -1.35);
    bar.scale.y = 0.2;
    scene.add(bar);
    S.bars.push(bar);
  }

  // Drag to rotate
  var el = renderer.domElement;
  el.style.touchAction = "pan-y";
  el.addEventListener("pointerdown", function (e) {
    S.dragging = true;
    S.lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", function (e) {
    if (!S.dragging) return;
    S.targetRotY += (e.clientX - S.lastX) * 0.012;
    S.lastX = e.clientX;
  });
  function endDrag() { S.dragging = false; }
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  // Resize
  function resize() {
    var nw = container.clientWidth || 300;
    var nh = container.clientHeight || 260;
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener("resize", resize);

  // Animate: auto-rotate + gentle leaf sway
  var clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    var t = clock.getElapsedTime();
    if (!S.dragging) S.targetRotY += 0.0035;
    S.rotY += (S.targetRotY - S.rotY) * 0.08;
    scene.rotation.y = S.rotY;
    for (var k = 0; k < S.leaves.length; k++) {
      var lf = S.leaves[k];
      lf.rotation.z = lf.userData.baseTilt + Math.sin(t * 1.6 + lf.userData.phase) * 0.05;
    }
    renderer.render(scene, camera);
  })();

  S.inited = true;
}

function render(score, values) {
  var container = document.getElementById("plant3d");
  if (!container || typeof score !== "number") return;
  if (!S.inited) init(container);
  if (!container.clientWidth) {
    requestAnimationFrame(function () { render(score, values); });
    return;
  }
  // Leaf color follows leaf score
  S.leafMat.color.copy(colorFor(values.leaf));
  // Stem tint + droop follows stem score
  var stemT = Math.max(0, Math.min(100, values.stem)) / 100;
  S.stemMat.color.copy(new THREE.Color(0xb98a2f)).lerp(new THREE.Color(0x3e7d44), stemT);
  S.stem.rotation.z = (1 - stemT) * 0.38;
  S.stem.rotation.x = (1 - stemT) * 0.14;
  // Soil darkness follows moisture
  var m = Math.max(0, Math.min(100, values.moisture)) / 100;
  S.soilMat.color.copy(new THREE.Color(0xc9a06a)).lerp(new THREE.Color(0x5b3d22), m);
  // Bars
  for (var i = 0; i < S.bars.length; i++) {
    var v = Math.max(0, Math.min(100, values[METRIC_KEYS[i]] || 0));
    S.bars[i].scale.y = 0.15 + (v / 100) * 1.5;
    S.bars[i].material.color.copy(colorFor(v));
  }
}

window.VitroVision3D = { render: render };
window.dispatchEvent(new Event("vitro3d-ready"));
