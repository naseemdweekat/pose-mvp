
(function () {
  'use strict';

  var VERSION = 'custom-rig-native-style-v3-20260710';

  var state = {
    vm: null,
    scene: null,
    camera: null,
    renderer: null,
    dom: null,
    transformControl: null,
    targetRig: null,
    points: [],
    selected: null,
    selectedBone: null,
    installedEvents: false,
    lastRigSignature: '',
    lastPointCount: 0,
    statusEl: null,
    mode: 'rotate'
  };

  function log() {
    try { console.log.apply(console, ['[PMA Custom Rig Native Style v3]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || ''; } catch (e) { return ''; }
  }

  function boneName(obj) {
    return safeName(obj || {}).toLowerCase();
  }

  function findVueRootsFromDom() {
    var roots = [];
    try {
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].__vue__ && roots.indexOf(all[i].__vue__) < 0) roots.push(all[i].__vue__);
      }
    } catch (e) {}
    return roots;
  }

  function collectVMs() {
    var roots = findVueRootsFromDom();
    var out = [];
    var seen = [];
    var stack = roots.slice();

    while (stack.length) {
      var vm = stack.shift();
      if (!vm || seen.indexOf(vm) >= 0) continue;
      seen.push(vm);
      out.push(vm);
      try { if (vm.$children) stack.push.apply(stack, vm.$children); } catch (e) {}
      try { if (vm.$parent && seen.indexOf(vm.$parent) < 0) stack.push(vm.$parent); } catch (e) {}
    }

    return out;
  }

  function scoreVM(vm) {
    var score = 0;
    try { if (vm.scene) score += 40; } catch (e) {}
    try { if (vm.camera) score += 20; } catch (e) {}
    try { if (vm.renderer) score += 20; } catch (e) {}
    try { if (vm.sceneManager) score += 10; } catch (e) {}
    try { if (vm.transformControl) score += 15; } catch (e) {}
    try { if (typeof vm.setTransformMode === 'function') score += 8; } catch (e) {}
    try { if (typeof vm.showTranformControls === 'function') score += 8; } catch (e) {}
    return score;
  }

  function pickVM() {
    var best = null;
    var bestScore = -1;

    collectVMs().forEach(function (vm) {
      var score = scoreVM(vm);
      if (score > bestScore) {
        best = vm;
        bestScore = score;
      }
    });

    return best;
  }

  function findTransformControl() {
    var found = null;

    collectVMs().forEach(function (vm) {
      try { if (!found && vm.transformControl && typeof vm.transformControl.attach === 'function') found = vm.transformControl; } catch (e) {}
      try { if (!found && vm.sceneManager && vm.sceneManager.transformControl && typeof vm.sceneManager.transformControl.attach === 'function') found = vm.sceneManager.transformControl; } catch (e) {}
    });

    if (!found && state.scene && state.scene.traverse) {
      try {
        state.scene.traverse(function (obj) {
          if (!found && obj && obj.isTransformControls && typeof obj.attach === 'function') found = obj;
        });
      } catch (e) {}
    }

    return found;
  }

  function bootRefs() {
    state.vm = pickVM();
    if (!state.vm) return false;

    state.scene = state.vm.scene || (state.vm.sceneManager && state.vm.sceneManager.scene) || state.scene;
    state.camera = state.vm.camera || state.camera;
    state.renderer = state.vm.renderer || state.renderer;
    state.dom = state.renderer && state.renderer.domElement ? state.renderer.domElement : (state.dom || document.querySelector('#renderer canvas'));
    state.transformControl = findTransformControl() || state.transformControl;

    return !!(state.scene && state.camera && state.dom);
  }

  function isBoneController(obj) {
    return !!(obj && obj.name === 'BoneController' && obj.parent && (obj.parent.type === 'Bone' || obj.parent.isBone));
  }

  function rootGroup(obj) {
    var p = obj;
    var prev = obj;
    while (p) {
      prev = p;
      if (!p.parent || p.parent.type === 'Scene') return p;
      p = p.parent;
    }
    return prev || obj;
  }

  function chain(obj, max) {
    var out = [];
    var p = obj;
    var i = 0;
    while (p && i < (max || 8)) {
      out.push(safeName(p));
      p = p.parent;
      i += 1;
    }
    return out.join(' <- ');
  }

  function groupNativeControllers() {
    if (!state.scene) return [];

    var groups = {};

    state.scene.traverse(function (obj) {
      if (!isBoneController(obj)) return;

      var root = rootGroup(obj);
      var key = (root ? root.id : 'none') + ':' + safeName(root);

      if (!groups[key]) groups[key] = { key: key, root: root, controllers: [] };
      groups[key].controllers.push(obj);
    });

    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.controllers.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
      g.maxId = g.controllers.reduce(function (m, c) { return Math.max(m, c.id || 0); }, 0);
      g.boneNames = g.controllers.map(function (c) { return safeName(c.parent); });
      g.chain = g.controllers[0] ? chain(g.controllers[0], 6) : '';
      return g;
    });
  }

  function looksLikeBuiltInAnime(g) {
    var names = g.boneNames.join('|').toLowerCase();
    return /head|neck|spine|shoulder|elbow|hand|hip|knee|foot/.test(names) &&
      !/becken|bauch|schwanz|pfote|oberarm_|unterarm_|brust|hals/.test(names);
  }

  function pickTargetRig() {
    var groups = groupNativeControllers();
    if (!groups.length) return null;

    var nonAnime = groups.filter(function (g) { return !looksLikeBuiltInAnime(g); });
    var pool = nonAnime.length ? nonAnime : groups;

    pool.sort(function (a, b) {
      if (b.maxId !== a.maxId) return b.maxId - a.maxId;
      return b.controllers.length - a.controllers.length;
    });

    return pool[0] || null;
  }

  function rigSignature(rig) {
    if (!rig) return '';
    return rig.key + '|' + rig.controllers.map(function (c) {
      return c.id + ':' + safeName(c.parent);
    }).join(',');
  }

  function shouldDisplayBone(controller) {
    var name = safeName(controller.parent).toLowerCase();
    if (!name) return false;
    if (/_end(_end)?$/.test(name)) return false;
    return true;
  }

  function colorForBone(name) {
    name = String(name || '').toLowerCase();

    if (/becken|hips|pelvis|root/.test(name)) return 0xff55ff;
    if (/kopf|head|hals|neck/.test(name)) return 0x34a1ff;
    if (/bauch|brust|spine|chest|torso/.test(name)) return 0x34a1ff;
    if (/oberarm|unterarm|vorderpfote|arm|hand|paw/.test(name)) return 0x36d68a;
    if (/oberschenkel|unterschenkel|pfote|leg|foot|thigh|calf/.test(name)) return 0xffb13b;
    if (/schwanz|tail/.test(name)) return 0xffdd33;
    return 0x34a1ff;
  }

  function clearPoints() {
    state.points.forEach(function (p) {
      try { if (p.parent) p.parent.remove(p); } catch (e) {}
      try { if (p.geometry) p.geometry.dispose(); } catch (e) {}
      try { if (p.material) p.material.dispose(); } catch (e) {}
    });

    state.points = [];
    state.selected = null;
    state.selectedBone = null;
  }

  function createPointFor(ctrl, idx) {
    var MeshCtor = ctrl.constructor;
    var GeoCtor = ctrl.geometry && ctrl.geometry.constructor;
    var MatCtor = ctrl.material && ctrl.material.constructor;

    if (!MeshCtor || !GeoCtor || !MatCtor) return null;

    var n = safeName(ctrl.parent);
    var isHip = /becken|hips|pelvis|root/i.test(n);

    var geo = null;
    try {
      // Same style as native PMA point: DodecahedronBufferGeometry(radius, detail)
      geo = new GeoCtor(isHip ? 3.2 : 2.4, 0);
    } catch (e) {
      try { geo = ctrl.geometry.clone(); } catch (e2) {}
    }

    if (!geo) return null;

    var color = colorForBone(n);

    var mat = new MatCtor({
      color: color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });

    try {
      if (mat.color && mat.color.setHex) mat.color.setHex(color);
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = 0.95;
      mat.needsUpdate = true;
    } catch (e) {}

    var mesh = new MeshCtor(geo, mat);
    mesh.name = 'PMACustomRigNativePoint';
    mesh.renderOrder = 999999;
    mesh.frustumCulled = false;
    mesh.visible = true;

    mesh.__pmaCtrl = ctrl;
    mesh.__pmaBone = ctrl.parent;
    mesh.__pmaDefaultColor = color;
    mesh.__pmaSelectedColor = 0xffffff;
    mesh.__pmaIsHip = isHip;

    state.scene.add(mesh);
    return mesh;
  }

  function rebuildPointsIfNeeded(force) {
    var rig = pickTargetRig();
    var sig = rigSignature(rig);

    if (!force && sig && sig === state.lastRigSignature && state.points.length === state.lastPointCount) return;

    clearPoints();
    state.targetRig = rig;
    state.lastRigSignature = sig;

    if (!rig) return;

    rig.controllers.filter(shouldDisplayBone).forEach(function (ctrl, idx) {
      var point = createPointFor(ctrl, idx);
      if (point) state.points.push(point);
    });

    state.lastPointCount = state.points.length;

    log('target rig:', rig.root ? safeName(rig.root) : '(none)', 'native controllers:', rig.controllers.length, 'native-style points:', state.points.length);
  }

  function updatePointAppearance(point) {
    if (!point || !point.material) return;

    var selected = state.selected === point;
    var color = selected ? point.__pmaSelectedColor : point.__pmaDefaultColor;

    try {
      if (point.material.color && point.material.color.setHex) point.material.color.setHex(color);
      point.material.opacity = selected ? 1.0 : 0.95;
      point.scale.set(selected ? 1.35 : 1, selected ? 1.35 : 1, selected ? 1.35 : 1);
      point.material.needsUpdate = true;
    } catch (e) {}
  }

  function updateStatus() {
    if (!state.statusEl) return;

    var name = state.selectedBone ? safeName(state.selectedBone) : 'none';
    var tc = state.transformControl ? 'axes ready' : 'axes not found';
    state.statusEl.textContent = 'Custom Rig | selected: ' + name + ' | mode: ' + state.mode.toUpperCase() + ' | ' + tc;
  }

  function updatePoints() {
    rebuildPointsIfNeeded(false);

    state.points.forEach(function (p) {
      try {
        var bone = p.__pmaBone;
        if (!bone || !bone.getWorldPosition) return;

        bone.getWorldPosition(p.position);
        p.visible = true;
        p.frustumCulled = false;
        updatePointAppearance(p);
      } catch (e) {}
    });

    updateStatus();
  }

  function screenPointForObject(obj) {
    try {
      if (!obj || !state.camera || !state.dom) return null;

      var v = obj.position.clone();
      v.project(state.camera);

      var rect = state.dom.getBoundingClientRect();

      return {
        x: (v.x + 1) * 0.5 * rect.width + rect.left,
        y: (-v.y + 1) * 0.5 * rect.height + rect.top,
        z: v.z
      };
    } catch (e) {
      return null;
    }
  }

  function pickPointByScreenDistance(event) {
    if (!state.points.length || !state.camera || !state.dom) return null;

    var best = null;
    var bestDist = Infinity;
    var threshold = 42;

    state.points.forEach(function (p) {
      var sp = screenPointForObject(p);
      if (!sp) return;

      if (sp.z > 1.5) return;

      var dx = event.clientX - sp.x;
      var dy = event.clientY - sp.y;
      var d = Math.sqrt(dx * dx + dy * dy);

      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    });

    if (best && bestDist <= threshold) return best;
    return null;
  }

  function setTransformMode(mode) {
    state.mode = mode || 'rotate';

    try {
      if (state.vm && typeof state.vm.setTransformMode === 'function') state.vm.setTransformMode(state.mode);
    } catch (e) {}

    try {
      if (state.transformControl && typeof state.transformControl.setMode === 'function') state.transformControl.setMode(state.mode);
    } catch (e) {}
  }

  function showTransformControl() {
    try {
      if (state.vm && typeof state.vm.showTranformControls === 'function') state.vm.showTranformControls();
    } catch (e) {}

    try {
      if (state.transformControl) {
        state.transformControl.visible = true;
        state.transformControl.enabled = true;
      }
    } catch (e) {}
  }

  function attachAxesToBone(bone, preferredMode) {
    if (!bone) return false;

    bootRefs();

    var tc = state.transformControl || findTransformControl();
    state.transformControl = tc;

    if (!tc || typeof tc.attach !== 'function') {
      log('TransformControls not found; selected bone but axes cannot attach:', safeName(bone));
      return false;
    }

    var mode = preferredMode || 'rotate';
    setTransformMode(mode);

    try {
      tc.attach(bone);
      showTransformControl();
      log('axes attached to bone:', safeName(bone), 'mode:', mode);
      return true;
    } catch (e) {
      log('failed to attach axes:', e);
      return false;
    }
  }

  function detachAxes() {
    try {
      if (state.transformControl && typeof state.transformControl.detach === 'function') state.transformControl.detach();
    } catch (e) {}
  }

  function selectPoint(point) {
    state.selected = point || null;
    state.selectedBone = point ? point.__pmaBone : null;

    state.points.forEach(updatePointAppearance);

    if (state.selectedBone) {
      var mode = point.__pmaIsHip ? 'translate' : 'rotate';
      attachAxesToBone(state.selectedBone, mode);
    } else {
      detachAxes();
    }

    updateStatus();
  }

  function stopEvent(e) {
    try { e.preventDefault(); } catch (_e) {}
    try { e.stopPropagation(); } catch (_e2) {}
    try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_e3) {}
  }

  function onPointerDown(e) {
    var picked = pickPointByScreenDistance(e);

    if (!picked) return;

    // If the same point is already selected, let TransformControls receive clicks on its axes.
    if (state.selected === picked && state.transformControl && state.transformControl.visible) {
      return;
    }

    selectPoint(picked);
    stopEvent(e);
  }

  function onKeyDown(e) {
    var handled = false;

    if (e.key === 'Escape') {
      selectPoint(null);
      handled = true;
    } else if (state.selectedBone && (e.key === 'r' || e.key === 'R')) {
      setTransformMode('rotate');
      handled = true;
    } else if (state.selectedBone && (e.key === 't' || e.key === 'T')) {
      setTransformMode('translate');
      handled = true;
    } else if (state.selectedBone && (e.key === 's' || e.key === 'S')) {
      setTransformMode('scale');
      handled = true;
    }

    if (handled) stopEvent(e);
  }

  function installEvents() {
    if (state.installedEvents || !state.dom) return;

    state.dom.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);

    state.installedEvents = true;
    log('events installed');
  }

  function installStatus() {
    if (state.statusEl) return;

    var el = document.createElement('div');
    el.id = 'pma-custom-rig-native-style-status';
    el.style.position = 'fixed';
    el.style.right = '10px';
    el.style.bottom = '10px';
    el.style.zIndex = '999999';
    el.style.background = 'rgba(0,0,0,0.58)';
    el.style.color = '#fff';
    el.style.font = '12px Arial, sans-serif';
    el.style.padding = '6px 8px';
    el.style.borderRadius = '6px';
    el.style.pointerEvents = 'none';
    el.textContent = 'Custom Rig Native Style';
    document.body.appendChild(el);

    state.statusEl = el;
  }

  function loop() {
    try {
      if (bootRefs()) {
        installStatus();
        installEvents();
        updatePoints();
      }
    } catch (e) {}

    requestAnimationFrame(loop);
  }

  function boot() {
    log('ready', VERSION);
    log('Native-style points. Click a point to select; original TransformControls axes should appear. T=translate, R=rotate, S=scale, Esc=deselect.');
    requestAnimationFrame(loop);
  }

  window.PMACustomRigNative = {
    version: VERSION,
    state: state,
    rebuild: function () { rebuildPointsIfNeeded(true); },
    selectedBone: function () { return state.selectedBone ? safeName(state.selectedBone) : null; },
    selectByName: function (name) {
      var point = state.points.find(function (p) { return safeName(p.__pmaBone) === name; });
      if (point) selectPoint(point);
      return !!point;
    },
    mode: function (mode) {
      if (mode) setTransformMode(mode);
      return state.mode;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
