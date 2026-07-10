
(function () {
  'use strict';

  var VERSION = 'custom-rig-interactive-v2-20260710';

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
    dragLastX: 0,
    dragLastY: 0,
    moveMode: false,
    installedEvents: false,
    lastRigSignature: '',
    lastProxyCount: 0,
    statusEl: null
  };

  function log() {
    try { console.log.apply(console, ['[PMA Custom Rig Interactive v2]'].concat([].slice.call(arguments))); } catch (e) {}
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
      if (score > bestScore) {
        best = vm;
        bestScore = score;
      }
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
      geo = new GeoCtor(idx === 0 ? 5 : 4, 0);
    } catch (e) {
      try { geo = ctrl.geometry.clone(); } catch (e2) {}
    }

    if (!geo) return null;

    var mat = new MatCtor({
      color: idx === 0 ? 0xff44ff : 0xf4d000,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });

    try {
      if (mat.color && mat.color.setHex) mat.color.setHex(idx === 0 ? 0xff44ff : 0xf4d000);
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
    mesh.__pmaInitialQuat = ctrl.parent && ctrl.parent.quaternion ? ctrl.parent.quaternion.clone() : null;
    mesh.__pmaInitialPos = ctrl.parent && ctrl.parent.position ? ctrl.parent.position.clone() : null;
    mesh.__pmaDefaultColor = idx === 0 ? 0xff44ff : 0xf4d000;
    mesh.__pmaSelectedColor = 0x00ffff;
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
    log('target rig:', rig.root ? safeName(rig.root) : '(none)', 'native controllers:', rig.controllers.length, 'interactive points:', state.proxies.length);
  }

  function updateProxyAppearance(proxy) {
    if (!proxy || !proxy.material) return;

    var selected = state.selected === proxy;
    var color = selected ? proxy.__pmaSelectedColor : proxy.__pmaDefaultColor;

    try {
      if (proxy.material.color && proxy.material.color.setHex) proxy.material.color.setHex(color);
      proxy.material.opacity = selected ? 1.0 : 0.95;
      proxy.material.needsUpdate = true;
    } catch (e) {}
  }

  function updateStatus() {
    if (!state.statusEl) return;

    var name = state.selected ? safeName(state.selected.__pmaBone) : 'none';
    state.statusEl.textContent = 'Custom Rig: ' + (state.proxies.length || 0) + ' pts | selected: ' + name + ' | mode: ' + (state.moveMode ? 'MOVE' : 'ROTATE');
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

    updateStatus();
  }

  function setSelected(proxy) {
    state.selected = proxy || null;
    state.proxies.forEach(updateProxyAppearance);

    if (state.selected) {
      log('SELECTED:', safeName(state.selected.__pmaBone), 'mode:', state.moveMode ? 'MOVE' : 'ROTATE');
    } else {
      log('deselected');
    }

    updateStatus();
  }

  function resetSelectedBone() {
    if (!state.selected) return;

    var bone = state.selected.__pmaBone;
    if (!bone) return;

    try {
      if (state.selected.__pmaInitialQuat && bone.quaternion) bone.quaternion.copy(state.selected.__pmaInitialQuat);
      if (state.selected.__pmaInitialPos && bone.position) bone.position.copy(state.selected.__pmaInitialPos);
      if (bone.updateMatrix) bone.updateMatrix();
      if (bone.updateMatrixWorld) bone.updateMatrixWorld(true);
    } catch (e) {}
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

  function pickProxyByScreenDistance(event) {
    if (!state.proxies.length || !state.camera || !state.dom) return null;

    var best = null;
    var bestDist = Infinity;
    var threshold = 85;

    state.proxies.forEach(function (p) {
      var sp = screenPointForObject(p);
      if (!sp) return;

      // Ignore objects far behind camera projection when possible.
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

  function applyDragDelta(dx, dy, twist) {
    if (!state.selected) return;

    var bone = state.selected.__pmaBone;
    if (!bone) return;

    try {
      if (state.moveMode) {
        var moveSpeed = 0.05;
        bone.position.x += dx * moveSpeed;
        bone.position.z += dy * moveSpeed;
      } else {
        var rotateSpeed = 0.01;
        if (twist) {
          bone.rotation.z += dx * rotateSpeed;
        } else {
          bone.rotation.y += dx * rotateSpeed;
          bone.rotation.x += dy * rotateSpeed;
        }
      }

      if (bone.updateMatrix) bone.updateMatrix();
      if (bone.updateMatrixWorld) bone.updateMatrixWorld(true);
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
        var rotStep = 0.06;
        if (axis === 'x') bone.rotation.x += dir * rotStep;
        if (axis === 'y') bone.rotation.y += dir * rotStep;
        if (axis === 'z') bone.rotation.z += dir * rotStep;
      }

      if (bone.updateMatrix) bone.updateMatrix();
      if (bone.updateMatrixWorld) bone.updateMatrixWorld(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stopEvent(e) {
    try { e.preventDefault(); } catch (_e) {}
    try { e.stopPropagation(); } catch (_e2) {}
    try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_e3) {}
  }

  function onPointerDown(e) {
    var picked = pickProxyByScreenDistance(e);

    if (picked) {
      setSelected(picked);
      state.dragging = true;
      state.dragLastX = e.clientX;
      state.dragLastY = e.clientY;
      stopEvent(e);
    }
  }

  function onPointerMove(e) {
    if (!state.dragging || !state.selected) return;

    var dx = e.clientX - state.dragLastX;
    var dy = e.clientY - state.dragLastY;
    state.dragLastX = e.clientX;
    state.dragLastY = e.clientY;

    applyDragDelta(dx, dy, e.shiftKey);
    stopEvent(e);
  }

  function onPointerUp(e) {
    if (state.dragging) stopEvent(e);
    state.dragging = false;
  }

  function onKeyDown(e) {
    if (!state.selected) return;

    var handled = false;

    if (e.key === 'Escape') {
      setSelected(null);
      handled = true;
    } else if (e.key === 'r' || e.key === 'R') {
      resetSelectedBone();
      handled = true;
    } else if (e.key === 'm' || e.key === 'M') {
      state.moveMode = !state.moveMode;
      log('mode:', state.moveMode ? 'MOVE' : 'ROTATE');
      handled = true;
    } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
      handled = stepSelected(state.moveMode ? 'x' : 'y', -1);
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
      handled = stepSelected(state.moveMode ? 'x' : 'y', +1);
    } else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      handled = stepSelected(state.moveMode ? 'z' : 'x', -1);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      handled = stepSelected(state.moveMode ? 'z' : 'x', +1);
    } else if (e.key === 'q' || e.key === 'Q') {
      handled = stepSelected(state.moveMode ? 'y' : 'z', -1);
    } else if (e.key === 'e' || e.key === 'E') {
      handled = stepSelected(state.moveMode ? 'y' : 'z', +1);
    }

    if (handled) stopEvent(e);
  }

  function installEvents() {
    if (state.installedEvents || !state.dom) return;

    state.dom.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('keydown', onKeyDown, true);

    state.installedEvents = true;
    log('events installed on canvas');
  }

  function installStatus() {
    if (state.statusEl) return;

    var el = document.createElement('div');
    el.id = 'pma-custom-rig-status';
    el.style.position = 'fixed';
    el.style.right = '10px';
    el.style.bottom = '10px';
    el.style.zIndex = '999999';
    el.style.background = 'rgba(0,0,0,0.65)';
    el.style.color = '#fff';
    el.style.font = '12px Arial, sans-serif';
    el.style.padding = '6px 8px';
    el.style.borderRadius = '6px';
    el.style.pointerEvents = 'none';
    el.textContent = 'Custom Rig: loading';
    document.body.appendChild(el);
    state.statusEl = el;
  }

  function loop() {
    try {
      if (bootThreeRefs()) {
        installStatus();
        installEvents();
        updateProxies();
      }
    } catch (e) {}
    requestAnimationFrame(loop);
  }

  function boot() {
    log('ready', VERSION);
    log('No Raycaster required. Selection uses screen-distance picking.');
    log('Click near a yellow point to select. Selected point becomes cyan. Drag to rotate. Shift+drag = twist. Keyboard: W/S X, A/D Y, Q/E Z, M move mode, R reset, Esc deselect.');
    requestAnimationFrame(loop);
  }

  window.PMACustomRig = {
    version: VERSION,
    state: state,
    rebuild: function () { rebuildProxiesIfNeeded(true); },
    clear: clearProxies,
    selectByName: function (name) {
      var found = state.proxies.find(function (p) { return safeName(p.__pmaBone) === name; });
      if (found) setSelected(found);
      return !!found;
    },
    selectedBone: function () { return state.selected ? safeName(state.selected.__pmaBone) : null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
