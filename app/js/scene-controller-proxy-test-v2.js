
(function () {
  'use strict';

  var VERSION = 'scene-controller-proxy-test-v2-20260710';
  var proxies = [];
  var lastTargetSig = '';
  var enabled = true;

  function log() {
    try { console.log.apply(console, ['[PMA Scene Controller Proxy Test v2]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || ''; } catch (e) { return ''; }
  }

  function parentChain(obj, max) {
    var out = [];
    var p = obj;
    var n = 0;
    while (p && n < (max || 12)) {
      out.push(safeName(p));
      p = p.parent;
      n += 1;
    }
    return out.join(' <- ');
  }

  function rootScene(obj) {
    var p = obj;
    var last = null;
    while (p) {
      last = p;
      if (p.type === 'Scene') return p;
      p = p.parent;
    }
    return last;
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

  function allVMs() {
    var roots = findVueRootsFromDom();
    var seen = [];
    var stack = roots.slice();
    while (stack.length) {
      var vm = stack.shift();
      if (!vm || seen.indexOf(vm) >= 0) continue;
      seen.push(vm);
      try { if (vm.$children) stack.push.apply(stack, vm.$children); } catch (e) {}
      try { if (vm.$parent && seen.indexOf(vm.$parent) < 0) stack.push(vm.$parent); } catch (e) {}
    }
    return seen;
  }

  function addUnique(arr, item) {
    if (item && arr.indexOf(item) < 0) arr.push(item);
  }

  function collectScenes() {
    var scenes = [];
    allVMs().forEach(function (vm) {
      try { addUnique(scenes, vm.scene); } catch (e) {}
      try { addUnique(scenes, vm.sceneManager && vm.sceneManager.scene); } catch (e) {}
    });
    return scenes.filter(Boolean);
  }

  function isNativeBoneController(obj) {
    return !!(obj && obj.name === 'BoneController' && obj.isMesh !== false && obj.parent && (obj.parent.type === 'Bone' || obj.parent.isBone));
  }

  function isWolfLike(ctrl) {
    var s = (safeName(ctrl.parent) + ' ' + parentChain(ctrl, 12)).toLowerCase();
    return /wolf|becken|bauch|brust|hals|kopf|oberarm|unterarm|vorderpfote|schwanz|oberschenkel|unterschenkel|pfote|schalterplatte|maul|ohr|aug/.test(s);
  }

  function collectControllers() {
    var controllers = [];
    collectScenes().forEach(function (scene) {
      try {
        scene.traverse(function (obj) {
          if (isNativeBoneController(obj)) addUnique(controllers, obj);
        });
      } catch (e) {}
    });

    var wolfLike = controllers.filter(isWolfLike);
    var target = wolfLike.length ? wolfLike : controllers;

    target.sort(function (a, b) {
      return safeName(a.parent).localeCompare(safeName(b.parent));
    });

    return {
      all: controllers,
      target: target,
      mode: wolfLike.length ? 'wolf/custom-like controllers only' : 'all controllers'
    };
  }

  function clearProxies() {
    proxies.forEach(function (p) {
      try { if (p.parent) p.parent.remove(p); } catch (e) {}
      try { if (p.geometry) p.geometry.dispose(); } catch (e) {}
      try { if (p.material) p.material.dispose(); } catch (e) {}
    });
    proxies = [];
  }

  function makeProxy(ctrl, idx) {
    var scene = rootScene(ctrl);
    if (!scene || scene.type !== 'Scene') return null;

    var MeshCtor = ctrl.constructor;
    var MatCtor = ctrl.material && ctrl.material.constructor;
    if (!MeshCtor || !MatCtor || !ctrl.geometry || !ctrl.geometry.clone) return null;

    var geo = ctrl.geometry.clone();
    var mat = new MatCtor({
      color: idx === 0 ? 0xff00ff : 0xffff00,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      opacity: 1
    });

    try {
      if (mat.color && mat.color.setHex) mat.color.setHex(idx === 0 ? 0xff00ff : 0xffff00);
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = false;
      mat.opacity = 1;
      mat.needsUpdate = true;
    } catch (e) {}

    var mesh = new MeshCtor(geo, mat);
    mesh.name = 'PMAProxyBoneController';
    mesh.renderOrder = 999999;
    mesh.frustumCulled = false;
    mesh.visible = true;
    mesh.__pmaProxyFor = ctrl;
    mesh.__pmaBone = ctrl.parent;
    mesh.posingModel = ctrl.posingModel || (ctrl.parent && ctrl.parent.posingModel) || null;
    scene.add(mesh);
    return mesh;
  }

  function rebuild() {
    clearProxies();

    var found = collectControllers();
    found.target.forEach(function (ctrl, idx) {
      var p = makeProxy(ctrl, idx);
      if (p) proxies.push(p);
    });

    log('all native BoneControllers:', found.all.length);
    log('target mode:', found.mode);
    log('created scene proxy controllers:', proxies.length);
    log('target parent sample:', found.target.slice(0, 20).map(function (c) { return safeName(c.parent); }));
    lastTargetSig = signatureFrom(found.target);
  }

  function signatureFrom(list) {
    return list.map(function (c) {
      return [c.id, safeName(c.parent), c.visible, parentChain(c, 4)].join(':');
    }).join('|');
  }

  function update() {
    if (!enabled) return;

    var found = collectControllers();
    var sig = signatureFrom(found.target);

    if (!proxies.length || sig !== lastTargetSig || proxies.length !== found.target.length) {
      rebuild();
      found = collectControllers();
    }

    proxies.forEach(function (p) {
      try {
        var bone = p.__pmaBone;
        if (!bone || !bone.getWorldPosition) return;
        bone.getWorldPosition(p.position);
        p.scale.set(1, 1, 1);
        p.visible = true;
        p.frustumCulled = false;
        if (p.material) {
          p.material.depthTest = false;
          p.material.depthWrite = false;
          p.material.opacity = 1;
          p.material.transparent = false;
        }
      } catch (e) {}
    });
  }

  function boot() {
    log('ready', VERSION);
    log('This scans actual scene BoneController meshes and prefers Wolf/custom-like bone names.');
    function loop() {
      try { update(); } catch (e) {}
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  window.PMAProxyTest = {
    version: VERSION,
    rebuild: rebuild,
    disable: function () { enabled = false; clearProxies(); },
    enable: function () { enabled = true; rebuild(); },
    count: function () { return proxies.length; },
    scan: collectControllers
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
