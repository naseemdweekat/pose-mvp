
(function () {
  'use strict';

  var VERSION = 'custom-rig-interactive-v1-20260710';
  var state = {
    vm: null,
    scene: null,
    camera: null,
    renderer: null,
    dom: null,
    targetRig: null,
    proxies: [],
    selected: null,
    dragging: false,
    dragButton: 0,
    dragLastX: 0,
    dragLastY: 0,
    moveMode: false,
    raycaster: null,
    pointer: null,
    installedEvents: false,
    lastRigSignature: '',
    lastProxyCount: 0
  };

  function log() {
    try { console.log.apply(console, ['[PMA Custom Rig Interactive]'].concat([].slice.call(arguments))); } catch (e) {}
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

  function pickVM() {
    var best = null;
    var bestScore = -1;
    collectVMs().forEach(function (vm) {
      var score = 0;
      try { if (vm.scene) score += 40; } catch (e) {}
      try { if (vm.camera) score += 20; } catch (e) {}
      try { if (vm.renderer) score += 20; } catch (e) {}
      try { if (vm.sceneManager) score += 10; } catch (e) {}
      try { if (vm.models) score += 5; } catch (e) {}
      if (score > bestScore) { best = vm; bestScore = score; }
    });
    return best;
  }

  function bootThreeRefs() {
    state.vm = pickVM();
    if (!state.vm) return false;
    state.scene = state.vm.scene || (state.vm.sceneManager && state.vm.sceneManager.scene) || null;
    state.camera = state.vm.camera || null;
    state.renderer = state.vm.renderer || null;
    state.dom = state.renderer && state.renderer.domElement ? state.renderer.domElement : document.querySelector('#renderer canvas');
    if (!state.scene || !state.camera || !state.dom) return false;

    if (!state.raycaster) {
      // Use the same THREE constructors via existing scene objects.
      try {
        var VCtor = state.camera.position && state.camera.position.constructor;
        var RCtor = null;
        state.scene.traverse(function (obj) {
          if (!RCtor && obj.raycast && obj.geometry) {
            var mod = obj.constructor && obj.constructor.prototype;
          }
        });
        // Use global THREE if present, otherwise infer from object methods.
        if (window.THREE && window.THREE.Raycaster && window.THREE.Vector2) {
          state.raycaster = new window.THREE.Raycaster();
          state.pointer = new window.THREE.Vector2();
        } else {
          // Fallback: get constructors from a visible mesh and camera vector.
          var sceneObj = null;
          state.scene.traverse(function (o) { if (!sceneObj && o.isMesh) sceneObj = o; });
          if (sceneObj && sceneObj.constructor) {
            // Raycaster constructor not easy to infer if THREE isn't global.
            // In PMA it is usually exposed globally.
          }
        }
      } catch (e) {}
    }

    if (!state.raycaster || !state.pointer) {
      if (window.THREE && window.THREE.Raycaster && window.THREE.Vector2) {
        state.raycaster = new window.THREE.Raycaster();
        state.pointer = new window.THREE.Vector2();
      } else {
        log('THREE.Raycaster not found globally. Mouse selection may not work.');
      }
    }
    return true;
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
      g.minId = g.controllers.reduce(function (m, c) { return Math.min(m, c.id || 999999); }, 999999);
      g.boneNames = g.controllers.map(function (c) { return safeName(c.parent); });
      g.chain = g.controllers[0] ? chain(g.controllers[0], 6) : '';
      return g;
    });
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

  function looksLikeBuiltInAnime(g) {
    var names = g.boneNames.join('|').toLowerCase();
    return /head|neck|spine|spine-1|spine-2|spine-3|shoulder|elbow|hand|hip|knee|foot/.test(names) && !/becken|bauch|schwanz|pfote|oberarm_|unterarm_/.test(names);
  }

  function pickTargetRig() {
    var groups = groupNativeControllers();
    if (!groups.length) return null;

    // Prefer non-built-in group with highest max controller id (most recently loaded custom rig).
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
    return rig.key + '|' + rig.controllers.map(function (c) { return c.id + ':' + safeName(c.parent); }).join(',');
  }

  function shouldDisplayBone(controller) {
    var name = safeName(controller.parent).toLowerCase();
    if (!name) return false;
    if (/_end(_end)?$/.test(name)) return false;
    return true;
  }

  function clearProxies() {
    state.proxies.forEach(function (p) {
      try { if (p.parent) p.parent.remove(p); } catch (e) {}
      try { if (p.geometry) p.geometry.dispose(); } catch (e) {}
      try { if (p.material) p.material.dispose(); } catch (e) {}
    });
    state.proxies = [];
    state.selected = null;
  }

  function createProxyFor(ctrl, idx) {
    var MeshCtor = ctrl.constructor;
    var GeoCtor = ctrl.geometry && ctrl.geometry.constructor;
    var MatCtor = ctrl.material && ctrl.material.constructor;
    if (!MeshCtor || !GeoCtor || !MatCtor) return null;

    var geo = null;
    try {
      // DodecahedronBufferGeometry(radius, detail)
      geo = new GeoCtor(5, 0);
    } catch (e) {
      try { geo = ctrl.geometry.clone(); } catch (e2) {}
    }
    if (!geo) return null;

    var mat = new MatCtor({
      color: 0xf4d000,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    try {
      if (mat.color && mat.color.setHex) mat.color.setHex(0xf4d000);
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = 0.95;
      mat.needsUpdate = true;
    } catch (e) {}

    var mesh = new MeshCtor(geo, mat);
    mesh.name = 'PMACustomRigPoint';
    mesh.renderOrder = 999999;
    mesh.frustumCulled = false;
    mesh.visible = true;
    mesh.__pmaCtrl = ctrl;
    mesh.__pmaBone = ctrl.parent;
    mesh.__pmaInitialQuat = ctrl.parent.quaternion ? ctrl.parent.quaternion.clone() : null;
    mesh.__pmaInitialPos = ctrl.parent.position ? ctrl.parent.position.clone() : null;
    mesh.__pmaDefaultColor = 0xf4d000;
    mesh.__pmaSelectedColor = 0xff44ff;
    state.scene.add(mesh);
    return mesh;
  }

  function rebuildProxiesIfNeeded(force) {
    var rig = pickTargetRig();
    var sig = rigSignature(rig);
    if (!force && sig && sig === state.lastRigSignature && state.proxies.length === state.lastProxyCount) return;
    clearProxies();
    state.targetRig = rig;
    state.lastRigSignature = sig;

    if (!rig) return;
    rig.controllers.filter(shouldDisplayBone).forEach(function (ctrl, idx) {
      var proxy = createProxyFor(ctrl, idx);
      if (proxy) state.proxies.push(proxy);
    });

    state.lastProxyCount = state.proxies.length;
    log('target rig:', rig.root ? safeName(rig.root) : '(none)', 'controllers:', rig.controllers.length, 'visible points:', state.proxies.length);
  }

  function updateProxyAppearance(proxy) {
    if (!proxy || !proxy.material) return;
    var color = (state.selected === proxy) ? proxy.__pmaSelectedColor : proxy.__pmaDefaultColor;
    try {
      if (proxy.material.color && proxy.material.color.setHex) proxy.material.color.setHex(color);
      proxy.material.opacity = state.selected === proxy ? 1.0 : 0.95;
      proxy.material.needsUpdate = true;
    } catch (e) {}
  }

  function updateProxies() {
    rebuildProxiesIfNeeded(false);
    state.proxies.forEach(function (p) {
      try {
        var bone = p.__pmaBone;
        if (!bone || !bone.getWorldPosition) return;
        bone.getWorldPosition(p.position);
        p.scale.set(1, 1, 1);
        p.visible = true;
        updateProxyAppearance(p);
      } catch (e) {}
    });
  }

  function setSelected(proxy) {
    state.selected = proxy || null;
    state.proxies.forEach(updateProxyAppearance);
    if (state.selected) {
      log('selected bone:', safeName(state.selected.__pmaBone), 'moveMode:', state.moveMode);
    }
  }

  function resetSelectedBone() {
    if (!state.selected) return;
    var bone = state.selected.__pmaBone;
    if (!bone) return;
    try {
      if (state.selected.__pmaInitialQuat && bone.quaternion) bone.quaternion.copy(state.selected.__pmaInitialQuat);
      if (state.selected.__pmaInitialPos && bone.position) bone.position.copy(state.selected.__pmaInitialPos);
      bone.updateMatrix && bone.updateMatrix();
      bone.updateMatrixWorld && bone.updateMatrixWorld(true);
    } catch (e) {}
  }

  function screenToNDC(event) {
    if (!state.dom || !state.pointer) return false;
    var rect = state.dom.getBoundingClientRect();
    state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  function pickProxy(event) {
    if (!state.raycaster || !state.pointer || !state.camera || !state.proxies.length) return null;
    if (!screenToNDC(event)) return null;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    var hits = state.raycaster.intersectObjects(state.proxies, false);
    return hits && hits.length ? hits[0].object : null;
  }

  function applyRotateDelta(dx, dy, isTwist) {
    if (!state.selected) return;
    var bone = state.selected.__pmaBone;
    if (!bone) return;
    var speed = 0.01;
    try {
      if (state.moveMode) {
        var moveSpeed = 0.05;
        bone.position.x += dx * moveSpeed;
        bone.position.z += dy * moveSpeed;
      } else if (isTwist) {
        bone.rotation.z += dx * speed;
      } else {
        bone.rotation.y += dx * speed;
        bone.rotation.x += dy * speed;
      }
      bone.updateMatrix && bone.updateMatrix();
      bone.updateMatrixWorld && bone.updateMatrixWorld(true);
    } catch (e) {}
  }

  function stepSelected(axis, dir) {
    if (!state.selected) return false;
    var bone = state.selected.__pmaBone;
    if (!bone) return false;
    try {
      if (state.moveMode) {
        var moveStep = 0.6;
        if (axis === 'x') bone.position.x += dir * moveStep;
        if (axis === 'y') bone.position.y += dir * moveStep;
        if (axis === 'z') bone.position.z += dir * moveStep;
      } else {
        var step = 0.06;
        if (axis === 'x') bone.rotation.x += dir * step;
        if (axis === 'y') bone.rotation.y += dir * step;
        if (axis === 'z') bone.rotation.z += dir * step;
      }
      bone.updateMatrix && bone.updateMatrix();
      bone.updateMatrixWorld && bone.updateMatrixWorld(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  function onPointerDown(e) {
    var picked = pickProxy(e);
    if (picked) {
      setSelected(picked);
      state.dragging = true;
      state.dragButton = e.button;
      state.dragLastX = e.clientX;
      state.dragLastY = e.clientY;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  }

  function onPointerMove(e) {
    if (!state.dragging || !state.selected) return;
    var dx = e.clientX - state.dragLastX;
    var dy = e.clientY - state.dragLastY;
    state.dragLastX = e.clientX;
    state.dragLastY = e.clientY;
    applyRotateDelta(dx, dy, e.shiftKey);
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function onPointerUp() {
    state.dragging = false;
  }

  function onKeyDown(e) {
    if (!state.selected) return;
    var handled = false;

    if (e.key === 'Escape') { setSelected(null); handled = true; }
    else if (e.key === 'r' || e.key === 'R') { resetSelectedBone(); handled = true; }
    else if (e.key === 'm' || e.key === 'M') { state.moveMode = !state.moveMode; log('moveMode:', state.moveMode); handled = true; }
    else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') handled = stepSelected(state.moveMode ? 'x' : 'y', -1);
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') handled = stepSelected(state.moveMode ? 'x' : 'y', +1);
    else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') handled = stepSelected(state.moveMode ? 'z' : 'x', -1);
    else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') handled = stepSelected(state.moveMode ? 'z' : 'x', +1);
    else if (e.key === 'q' || e.key === 'Q') handled = stepSelected(state.moveMode ? 'y' : 'z', -1);
    else if (e.key === 'e' || e.key === 'E') handled = stepSelected(state.moveMode ? 'y' : 'z', +1);

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  }

  function installEvents() {
    if (state.installedEvents || !state.dom) return;
    state.dom.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    state.installedEvents = true;
  }

  function loop() {
    try {
      if (bootThreeRefs()) {
        installEvents();
        updateProxies();
      }
    } catch (e) {}
    requestAnimationFrame(loop);
  }

  function boot() {
    log('ready', VERSION);
    log('Click a yellow custom-rig point. Drag mouse to rotate. Shift+drag = twist. Keyboard: W/S X, A/D Y, Q/E Z, M toggle move mode, R reset, Esc deselect.');
    requestAnimationFrame(loop);
  }

  window.PMACustomRig = {
    version: VERSION,
    rebuild: function () { rebuildProxiesIfNeeded(true); },
    clear: clearProxies,
    state: state,
    selectByName: function (name) {
      var found = state.proxies.find(function (p) { return safeName(p.__pmaBone) === name; });
      if (found) setSelected(found);
      return !!found;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
