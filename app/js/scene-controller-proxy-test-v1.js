
(function () {
  'use strict';

  var VERSION = 'scene-controller-proxy-test-v1-20260710';
  var proxies = [];
  var lastCount = 0;
  var enabled = true;

  function log() {
    try { console.log.apply(console, ['[PMA Scene Controller Proxy Test]'].concat([].slice.call(arguments))); } catch (e) {}
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

  function score(vm) {
    var s = 0;
    try { if (vm.sceneManager) s += 40; } catch (e) {}
    try { if (vm.scene) s += 20; } catch (e) {}
    try { if (vm.renderer) s += 10; } catch (e) {}
    try { if (vm.camera) s += 10; } catch (e) {}
    try { if (vm.transformControl) s += 10; } catch (e) {}
    return s;
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

  function mainVM() {
    var v = allVMs();
    var best = null, bestScore = 0;
    v.forEach(function (vm) {
      var sc = score(vm);
      if (sc > bestScore) { bestScore = sc; best = vm; }
    });
    return best;
  }

  function unique(arr, x) { if (x && arr.indexOf(x) < 0) arr.push(x); }

  function collectModels() {
    var models = [];
    allVMs().forEach(function (vm) {
      try { if (vm.sceneManager && Array.isArray(vm.sceneManager.models)) vm.sceneManager.models.forEach(function (m) { unique(models, m); }); } catch (e) {}
      try { if (Array.isArray(vm.models)) vm.models.forEach(function (m) { if (m && m.boneControllers) unique(models, m); }); } catch (e) {}
      try {
        var scene = vm.scene || (vm.sceneManager && vm.sceneManager.scene);
        if (scene && scene.traverse) scene.traverse(function (o) { if (o && o.posingModel) unique(models, o.posingModel); });
      } catch (e) {}
    });
    return models;
  }

  function findCustomOrRiggedModels() {
    return collectModels().filter(function (m) {
      return m && m.boneControllers && m.boneControllers.length && m.skinnedMeshes && m.skinnedMeshes.length;
    });
  }

  function clearProxies() {
    proxies.forEach(function (p) {
      try { if (p.parent) p.parent.remove(p); } catch (e) {}
      try { if (p.geometry) p.geometry.dispose(); } catch (e) {}
      try { if (p.material) p.material.dispose(); } catch (e) {}
    });
    proxies = [];
    lastCount = 0;
  }

  function makeVectorLike(obj) {
    try {
      var C = obj && obj.position && obj.position.constructor;
      if (C) return new C();
    } catch (e) {}
    return null;
  }

  function createProxies() {
    var vm = mainVM();
    if (!vm) return;
    var scene = vm.scene || (vm.sceneManager && vm.sceneManager.scene);
    if (!scene) return;

    var model = findCustomOrRiggedModels().slice(-1)[0];
    if (!model || !model.boneControllers || !model.boneControllers.length) return;

    if (lastCount === model.boneControllers.length && proxies.length === lastCount) return;

    clearProxies();

    var sample = model.boneControllers[0];
    var THREE_VECTOR = makeVectorLike(sample);
    var GeoCtor = null, MatCtor = null, MeshCtor = null;
    try {
      // Reuse the same internal three constructors from the existing controller.
      GeoCtor = sample.geometry && sample.geometry.constructor;
      MatCtor = sample.material && sample.material.constructor;
      MeshCtor = sample.constructor;
    } catch (e) {}

    if (!GeoCtor || !MatCtor || !MeshCtor) return;

    model.boneControllers.forEach(function (ctrl, idx) {
      try {
        var radius = (idx === 0 ? 5 : 3);
        var geo = new GeoCtor(radius, 0); // DodecahedronBufferGeometry(radius, detail)
        var mat = new MatCtor({ color: idx === 0 ? 0xff00ff : 0xffff00, depthTest: false, depthWrite: false, transparent: false, opacity: 1 });
        var mesh = new MeshCtor(geo, mat);
        mesh.name = 'ProxyBoneController';
        mesh.renderOrder = 999999;
        mesh.visible = true;
        mesh.frustumCulled = false;
        mesh.posingModel = model;
        mesh.__pmaProxyFor = ctrl;
        mesh.__pmaBone = ctrl.parent;
        scene.add(mesh);
        proxies.push(mesh);
      } catch (e) {}
    });

    lastCount = proxies.length;
    log('created scene proxy controllers:', proxies.length, 'for model:', model.name);
  }

  function updateProxies() {
    if (!enabled) return;
    if (!proxies.length) createProxies();

    proxies.forEach(function (p) {
      try {
        var bone = p.__pmaBone;
        if (!bone || !bone.getWorldPosition) return;
        bone.getWorldPosition(p.position);
        // keep fixed scene scale so parent bone scale cannot make it invisible/huge
        p.scale.set(1, 1, 1);
        p.visible = true;
      } catch (e) {}
    });
  }

  function boot() {
    log('ready', VERSION);
    log('This is a temporary 3D scene proxy test, not HTML overlay.');
    function loop() {
      try { updateProxies(); } catch (e) {}
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  window.PMAProxyTest = {
    version: VERSION,
    enable: function () { enabled = true; },
    disable: function () { enabled = false; clearProxies(); },
    rebuild: function () { clearProxies(); createProxies(); },
    count: function () { return proxies.length; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
