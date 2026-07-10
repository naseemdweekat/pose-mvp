
(function () {
  'use strict';

  var VERSION = 'custom-rig-native-style-v5-20260710';

  var state = {
    vm: null,
    scene: null,
    camera: null,
    renderer: null,
    dom: null,
    transformControl: null,
    targetRig: null,
    targetModel: null,
    points: [],
    selected: null,
    selectedBone: null,
    installedEvents: false,
    lastRigSignature: '',
    lastPointCount: 0,
    mode: 'rotate',
    hiddenByUser: false
  };

  function log() {
    try { console.log.apply(console, ['[PMA Custom Rig Native Style v5]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || ''; } catch (e) { return ''; }
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

  function currentSelectedModel() {
    var selected = null;
    collectVMs().forEach(function (vm) {
      try {
        if (!selected && vm.selectedModel && vm.selectedModel.isModel) selected = vm.selectedModel;
      } catch (e) {}
    });
    return selected;
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

  function controllerModel(ctrl) {
    return (ctrl && ctrl.posingModel) ||
      (ctrl && ctrl.parent && ctrl.parent.posingModel) ||
      null;
  }

  function isCustomRigModel(model) {
    try {
      return !!(model && (
        model.isCustomRig ||
        (model.modelConst && model.modelConst.isCustomRig) ||
        (model.modelConst && model.modelConst.name && !/Anime Male Base|Coming Soon/i.test(model.modelConst.name) && model.modelConst.isDisablePremium)
      ));
    } catch (e) {
      return false;
    }
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

      var model = controllerModel(obj);

      // Only uploaded/custom rig. Never duplicate points over original Anime Base.
      if (!isCustomRigModel(model)) return;

      var root = rootGroup(obj);
      var modelKey = model ? (model.sceneID || model.name || model.id || '') : '';
      var key = String(modelKey) + ':' + (root ? root.id : 'none') + ':' + safeName(root);

      if (!groups[key]) groups[key] = { key: key, root: root, model: model, controllers: [] };
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

  function pickTargetRig() {
    var groups = groupNativeControllers();
    if (!groups.length) return null;

    var selected = currentSelectedModel();

    if (isCustomRigModel(selected)) {
      var exact = groups.filter(function (g) { return g.model === selected; });
      if (exact.length) {
        exact.sort(function (a, b) { return b.controllers.length - a.controllers.length; });
        return exact[0];
      }
    }

    groups.sort(function (a, b) {
      if (b.maxId !== a.maxId) return b.maxId - a.maxId;
      return b.controllers.length - a.controllers.length;
    });

    return groups[0] || null;
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

  function nativeColorFromController(ctrl) {
    try {
      if (ctrl && ctrl.material && ctrl.material.color && typeof ctrl.material.color.getHex === 'function') {
        return ctrl.material.color.getHex();
      }
    } catch (e) {}

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
      geo = new GeoCtor(isHip ? 3.0 : 2.2, 0);
    } catch (e) {
      try { geo = ctrl.geometry.clone(); } catch (e2) {}
    }

    if (!geo) return null;

    var color = nativeColorFromController(ctrl);

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
    state.targetModel = rig ? rig.model : null;
    state.lastRigSignature = sig;
    state.hiddenByUser = false;

    if (!rig) return;

    rig.controllers.filter(shouldDisplayBone).forEach(function (ctrl, idx) {
      var point = createPointFor(ctrl, idx);
      if (point) state.points.push(point);
    });

    state.lastPointCount = state.points.length;

    log('target custom rig:', rig.model ? safeName(rig.model) : '(model)', 'native controllers:', rig.controllers.length, 'native-style points:', state.points.length);
  }

  function shouldShowPoints() {
    if (!state.targetRig || !state.points.length) return false;

    var selected = currentSelectedModel();

    if (state.selectedBone) return true;
    if (selected && selected === state.targetModel) return true;
    if (selected && selected !== state.targetModel) return false;
    if (state.hiddenByUser) return false;

    return true;
  }

  function updatePointAppearance(point, visible) {
    if (!point || !point.material) return;

    var selected = state.selected === point;
    var color = selected ? point.__pmaSelectedColor : point.__pmaDefaultColor;

    try {
      if (point.material.color && point.material.color.setHex) point.material.color.setHex(color);
      point.material.opacity = selected ? 1.0 : 0.95;
      point.scale.set(selected ? 1.25 : 1, selected ? 1.25 : 1, selected ? 1.25 : 1);
      point.visible = !!visible;
      point.material.needsUpdate = true;
    } catch (e) {}
  }

  function updatePoints() {
    rebuildPointsIfNeeded(false);

    var visible = shouldShowPoints();

    state.points.forEach(function (p) {
      try {
        var bone = p.__pmaBone;
        if (!bone || !bone.getWorldPosition) return;

        bone.getWorldPosition(p.position);
        p.frustumCulled = false;
        updatePointAppearance(p, visible);
      } catch (e) {}
    });
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
    if (!state.points.length || !state.camera || !state.dom || !shouldShowPoints()) return null;

    var best = null;
    var bestDist = Infinity;
    var threshold = 42;

    state.points.forEach(function (p) {
      if (!p.visible) return;

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
      log('axes attached to custom bone:', safeName(bone), 'mode:', mode);
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
    state.hiddenByUser = false;
    state.selected = point || null;
    state.selectedBone = point ? point.__pmaBone : null;

    state.points.forEach(function (p) { updatePointAppearance(p, shouldShowPoints()); });

    if (state.selectedBone) {
      var mode = point.__pmaIsHip ? 'translate' : 'rotate';
      attachAxesToBone(state.selectedBone, mode);
    } else {
      detachAxes();
    }
  }

  function deselectCustomRig(hide) {
    state.selected = null;
    state.selectedBone = null;
    state.hiddenByUser = !!hide;
    detachAxes();
    state.points.forEach(function (p) { updatePointAppearance(p, shouldShowPoints()); });
  }

  function stopEvent(e) {
    try { e.preventDefault(); } catch (_e) {}
    try { e.stopPropagation(); } catch (_e2) {}
    try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_e3) {}
  }

  function onPointerDown(e) {
    var picked = pickPointByScreenDistance(e);

    if (picked) {
      // If same point is selected, do not block the original TransformControls axes.
      if (state.selected === picked && state.transformControl && state.transformControl.visible) return;

      selectPoint(picked);
      stopEvent(e);
      return;
    }

    // v5 important fix:
    // If a custom bone is selected, any non-point pointerdown may be on the TransformControls axes.
    // Do NOT hide points or detach axes here; let original TransformControls receive the event.
    if (state.selectedBone) return;

    // Empty click only hides when no custom bone is actively selected.
    if (shouldShowPoints()) deselectCustomRig(true);
  }

  function onKeyDown(e) {
    var handled = false;

    if (e.key === 'Escape') {
      deselectCustomRig(true);
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

  function loop() {
    try {
      if (bootRefs()) {
        installEvents();
        updatePoints();
      }
    } catch (e) {}

    requestAnimationFrame(loop);
  }

  function boot() {
    log('ready', VERSION);
    log('v5 fix: selected custom-rig axes are no longer hidden/blocked on pointerdown. T=translate, R=rotate, S=scale, Esc=deselect.');
    requestAnimationFrame(loop);
  }

  window.PMACustomRigNative = {
    version: VERSION,
    state: state,
    show: function () { state.hiddenByUser = false; updatePoints(); },
    hide: function () { deselectCustomRig(true); },
    rebuild: function () { rebuildPointsIfNeeded(true); },
    selectedBone: function () { return state.selectedBone ? safeName(state.selectedBone) : null; },
    selectByName: function (name) {
      state.hiddenByUser = false;
      updatePoints();
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
