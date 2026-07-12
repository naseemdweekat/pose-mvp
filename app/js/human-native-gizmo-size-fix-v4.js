
(function () {
  'use strict';

  var VERSION = 'human-native-gizmo-size-fix-v4-20260710';

  function log() {
    try { console.log.apply(console, ['[PMA Human Native Gizmo Size Fix]'].concat([].slice.call(arguments))); } catch (e) {}
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

  function findTransformControls() {
    var out = [];

    collectVMs().forEach(function (vm) {
      try { if (vm.transformControl && out.indexOf(vm.transformControl) < 0) out.push(vm.transformControl); } catch (e) {}
      try { if (vm.sceneManager && vm.sceneManager.transformControl && out.indexOf(vm.sceneManager.transformControl) < 0) out.push(vm.sceneManager.transformControl); } catch (e) {}
      try {
        var scene = vm.scene || (vm.sceneManager && vm.sceneManager.scene);
        if (scene && scene.traverse) {
          scene.traverse(function (obj) {
            if (obj && obj.isTransformControls && out.indexOf(obj) < 0) out.push(obj);
          });
        }
      } catch (e) {}
    });

    return out;
  }

  function findScenes() {
    var scenes = [];

    collectVMs().forEach(function (vm) {
      try { if (vm.scene && scenes.indexOf(vm.scene) < 0) scenes.push(vm.scene); } catch (e) {}
      try { if (vm.sceneManager && vm.sceneManager.scene && scenes.indexOf(vm.sceneManager.scene) < 0) scenes.push(vm.sceneManager.scene); } catch (e) {}
    });

    return scenes;
  }

  function isHumanNativeModel(model) {
    try {
      return !!(model && model.modelConst && model.modelConst.isHumanNativeRig);
    } catch (e) {
      return false;
    }
  }

  function objectHumanNativeModel(obj) {
    try {
      var p = obj;
      var i = 0;
      while (p && i < 12) {
        if (isHumanNativeModel(p.posingModel)) return p.posingModel;
        p = p.parent;
        i += 1;
      }
    } catch (e) {}
    return null;
  }

  function isHumanNativeController(obj) {
    try {
      if (!obj) return false;
      if (obj.name !== 'BoneController' && obj.name !== 'BoneControllerIK') return false;

      var model = obj.posingModel || (obj.parent && obj.parent.posingModel);
      return isHumanNativeModel(model);
    } catch (e) {
      return false;
    }
  }

  function makeVector(obj) {
    try {
      if (obj && obj.position && obj.position.constructor) return new obj.position.constructor();
    } catch (e) {}
    return null;
  }

  function normalizeController(ctrl) {
    try {
      var parent = ctrl.parent;
      var v = makeVector(parent || ctrl);
      var scalar = 1;

      if (parent && parent.getWorldScale && v) {
        parent.getWorldScale(v);
        var maxScale = Math.max(Math.abs(v.x || 1), Math.abs(v.y || 1), Math.abs(v.z || 1), 1);
        scalar = 1 / maxScale;
      }

      if (ctrl.scale && ctrl.scale.set) ctrl.scale.set(scalar, scalar, scalar);
      ctrl.frustumCulled = false;
      ctrl.renderOrder = Math.max(ctrl.renderOrder || 0, 9999);

      if (ctrl.material) {
        ctrl.material.depthTest = false;
        ctrl.material.depthWrite = false;
        ctrl.material.transparent = true;
        if (typeof ctrl.material.opacity === 'number' && ctrl.material.opacity > 0.95) ctrl.material.opacity = 0.95;
        ctrl.material.needsUpdate = true;
      }
    } catch (e) {}
  }

  function normalizeNativeControllers() {
    try {
      findScenes().forEach(function (scene) {
        if (!scene || !scene.traverse) return;
        scene.traverse(function (obj) {
          if (isHumanNativeController(obj)) normalizeController(obj);
        });
      });
    } catch (e) {}
  }

  function getAttachedHumanNativeObject(tc) {
    try {
      var obj = tc && tc.object;
      if (!obj) return null;
      return objectHumanNativeModel(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function tuneTransformControl(tc) {
    try {
      var attached = getAttachedHumanNativeObject(tc);
      if (!attached) return;

      // This fixes imported humanoids where armature/object scale makes the
      // original PMA transform gizmo appear enormous.
      // We keep it conservative so normal models still feel close to native PMA.
      if (typeof tc.setSize === 'function') {
        tc.setSize(0.28);
      } else {
        tc.size = 0.28;
      }

      // Some versions have child gizmo/picker groups using inherited scale;
      // keep transform control itself at clean scale.
      if (tc.scale && tc.scale.set) tc.scale.set(1, 1, 1);
      tc.visible = true;
      tc.enabled = true;
    } catch (e) {}
  }

  function tick() {
    normalizeNativeControllers();

    try {
      findTransformControls().forEach(tuneTransformControl);
    } catch (e) {}
  }

  function loop() {
    tick();
    requestAnimationFrame(loop);
  }

  window.PMAHumanNativeGizmoSizeFix = {
    version: VERSION,
    run: tick
  };

  log('ready', VERSION);
  requestAnimationFrame(loop);
})();
