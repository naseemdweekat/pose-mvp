
(function () {
  'use strict';

  var VERSION = 'any-rig-deep-debug-v2-20260710';
  var lastSignature = '';

  function log() {
    try { console.log.apply(console, ['[PMA Any Rig Deep Debug]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function warn() {
    try { console.warn.apply(console, ['[PMA Any Rig Deep Debug]'].concat([].slice.call(arguments))); } catch (e) {}
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

  function vmScore(vm) {
    if (!vm) return 0;
    var s = 0;
    try { if (vm.scene) s += 10; } catch (e) {}
    try { if (vm.sceneManager) s += 40; } catch (e) {}
    try { if (vm.renderer) s += 10; } catch (e) {}
    try { if (vm.camera) s += 10; } catch (e) {}
    try { if (vm.transformControl) s += 10; } catch (e) {}
    try { if (Array.isArray(vm.models)) s += 10; } catch (e) {}
    return s;
  }

  function findMainVm() {
    var roots = findVueRootsFromDom();
    var stack = roots.slice();
    var best = null, bestScore = 0;
    while (stack.length) {
      var vm = stack.shift();
      var sc = vmScore(vm);
      if (sc > bestScore) {
        bestScore = sc;
        best = vm;
      }
      try { if (vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children); } catch (e) {}
    }
    return best;
  }

  function getModels(vm) {
    var a = [];
    try { if (vm && vm.sceneManager && Array.isArray(vm.sceneManager.models)) a = vm.sceneManager.models; } catch (e) {}
    if (a && a.length) return a;
    try { if (vm && Array.isArray(vm.models)) a = vm.models; } catch (e) {}
    return a || [];
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || null; } catch (e) { return null; }
  }

  function n4(x) {
    var v = Number(x || 0);
    return Math.round(v * 10000) / 10000;
  }

  function vec3ToObj(v) {
    if (!v) return null;
    return { x: n4(v.x), y: n4(v.y), z: n4(v.z) };
  }

  function makeVectorLike(obj) {
    try {
      var C = obj && obj.position && obj.position.constructor;
      if (C) return new C();
    } catch (e) {}
    try {
      var vm = findMainVm();
      var C2 = vm && vm.camera && vm.camera.position && vm.camera.position.constructor;
      if (C2) return new C2();
    } catch (e) {}
    return null;
  }

  function getWorldPosition(obj) {
    try {
      var v = makeVectorLike(obj);
      if (!v || !obj || !obj.getWorldPosition) return null;
      obj.getWorldPosition(v);
      return vec3ToObj(v);
    } catch (e) { return null; }
  }

  function getWorldScale(obj) {
    try {
      var v = makeVectorLike(obj);
      if (!v || !obj || !obj.getWorldScale) return null;
      obj.getWorldScale(v);
      return vec3ToObj(v);
    } catch (e) { return null; }
  }

  function parentChain(obj, max) {
    var out = [], p = obj, n = 0;
    while (p && n < (max || 10)) {
      out.push(safeName(p));
      p = p.parent;
      n += 1;
    }
    return out.join(' <- ');
  }

  function countSceneOccurrences(vm, obj) {
    var count = 0;
    try {
      var scene = vm && (vm.scene || (vm.sceneManager && vm.sceneManager.scene));
      if (!scene || !scene.traverse || !obj) return 0;
      scene.traverse(function (x) { if (x === obj) count += 1; });
    } catch (e) {}
    return count;
  }

  function boneRows(model) {
    var rows = [];
    try {
      (model.skinnedMeshes || []).forEach(function (sk, skIndex) {
        var bones = (sk.skeleton && sk.skeleton.bones) || [];
        bones.forEach(function (b, index) {
          rows.push({
            skinnedMesh: skIndex,
            index: index,
            id: b.id,
            uuid: b.uuid,
            name: b.name,
            type: b.type,
            visible: b.visible,
            parent: safeName(b.parent),
            children: b.children ? b.children.length : 0,
            localPos: JSON.stringify(vec3ToObj(b.position)),
            localScale: JSON.stringify(vec3ToObj(b.scale)),
            worldPos: JSON.stringify(getWorldPosition(b)),
            worldScale: JSON.stringify(getWorldScale(b))
          });
        });
      });
    } catch (e) { warn('boneRows failed', e); }
    return rows;
  }

  function controllerRows(model, vm) {
    var rows = [];
    try {
      (model.boneControllers || []).forEach(function (c, index) {
        rows.push({
          index: index,
          id: c.id,
          uuid: c.uuid,
          name: c.name,
          type: c.type,
          visible: c.visible,
          parent: safeName(c.parent),
          parentType: c.parent && c.parent.type,
          parentVisible: c.parent && c.parent.visible,
          inScene: countSceneOccurrences(vm, c),
          parentInScene: countSceneOccurrences(vm, c.parent),
          renderOrder: c.renderOrder,
          geometry: c.geometry && c.geometry.type,
          geometryParams: c.geometry && c.geometry.parameters ? JSON.stringify(c.geometry.parameters) : null,
          material: c.material && c.material.type,
          matVisible: c.material && c.material.visible,
          matDepthTest: c.material && c.material.depthTest,
          matDepthWrite: c.material && c.material.depthWrite,
          matTransparent: c.material && c.material.transparent,
          matOpacity: c.material && c.material.opacity,
          localPos: JSON.stringify(vec3ToObj(c.position)),
          localScale: JSON.stringify(vec3ToObj(c.scale)),
          worldPos: JSON.stringify(getWorldPosition(c)),
          worldScale: JSON.stringify(getWorldScale(c)),
          parentChain: parentChain(c, 8)
        });
      });
    } catch (e) { warn('controllerRows failed', e); }
    return rows;
  }

  function modelSummary(model, vm, index) {
    var controllers = controllerRows(model, vm);
    var bones = boneRows(model);
    var visible = controllers.filter(function (x) { return x.visible; }).length;
    return {
      index: index,
      sceneID: model.sceneID,
      name: model.name,
      isModel: model.isModel,
      isAnimal: model.isAnimal,
      isCustomRig_model: model.isCustomRig,
      isCustomRig_const: model.modelConst && model.modelConst.isCustomRig,
      isDisablePremium: model.isDisablePremium,
      modelConst_id: model.modelConst && model.modelConst.id,
      modelConst_name: model.modelConst && model.modelConst.name,
      modelConst_isPremium: model.modelConst && model.modelConst.isPremium,
      modelConst_boneNamesCount: model.modelConst && model.modelConst.boneNames && model.modelConst.boneNames.length,
      modelConst_hipBoneName: model.modelConst && model.modelConst.hipBoneName,
      modelConst_boneSize: model.modelConst && model.modelConst.boneSize,
      modelConst_hipBoneSize: model.modelConst && model.modelConst.hipBoneSize,
      meshName: model.mesh && model.mesh.name,
      meshType: model.mesh && model.mesh.type,
      meshVisible: model.mesh && model.mesh.visible,
      meshInScene: countSceneOccurrences(vm, model.mesh),
      skinnedMeshes: model.skinnedMeshes && model.skinnedMeshes.length,
      skeletonBones: bones.length,
      boneControllers: model.boneControllers && model.boneControllers.length,
      visibleControllers: visible,
      hipsController: model.hipsController && model.hipsController.name,
      hipsType: model.hipsController && model.hipsController.type,
      hipsVisible: model.hipsController && model.hipsController.visible,
      hipsWorldPos: JSON.stringify(getWorldPosition(model.hipsController)),
      transformObjectIsThisMesh: !!(vm && vm.transformControl && vm.transformControl.object === model.mesh),
      transformObjectIsHips: !!(vm && vm.transformControl && vm.transformControl.object === model.hipsController)
    };
  }

  function inspectModel(model, index, vm) {
    if (!model) return null;
    var s = modelSummary(model, vm, index);
    var bones = boneRows(model);
    var controllers = controllerRows(model, vm);

    console.group('[PMA Any Rig Deep Debug] INSPECT MODEL #' + index + ' - ' + (model.name || model.sceneID));
    console.log('Plain summary:', JSON.stringify(s, null, 2));
    console.log('Raw model:', model);
    console.log('modelConst:', model.modelConst);
    console.log('All bone names:', bones.map(function (b) { return b.name; }));
    console.table(bones.slice(0, 100));
    console.table(controllers.slice(0, 120));
    console.groupEnd();

    return { summary: s, bones: bones, controllers: controllers };
  }

  function dump(reason) {
    var vm = findMainVm();
    if (!vm) {
      warn('Main VM not found.');
      return null;
    }

    var models = getModels(vm);
    var summaries = models.map(function (m, i) { return modelSummary(m, vm, i); });
    var selected = null;
    try { selected = vm.selectedModel || null; } catch (e) {}

    console.group('[PMA Any Rig Deep Debug] DUMP - ' + (reason || 'manual'));
    console.log('Version:', VERSION);
    console.log('VM:', vm);
    console.log('Selected raw:', selected);
    console.log('TransformControl object:', vm.transformControl && vm.transformControl.object);
    console.table(summaries);
    console.log('Summaries JSON:', JSON.stringify(summaries, null, 2));
    console.groupEnd();

    var likely = [];
    summaries.forEach(function (s, i) {
      if ((s.boneControllers || 0) > 0 || (s.skeletonBones || 0) > 0 || s.isCustomRig_const || s.isCustomRig_model) likely.push(i);
    });

    likely.forEach(function (i) { inspectModel(models[i], i, vm); });

    window.PMADebugLast = {
      version: VERSION,
      reason: reason || 'manual',
      summaries: summaries,
      likelyIndexes: likely
    };

    log('Saved compact result to window.PMADebugLast');
    return window.PMADebugLast;
  }

  function signature() {
    var vm = findMainVm();
    var models = getModels(vm);
    return models.map(function (m) {
      return [
        m.sceneID,
        m.name,
        m.boneControllers && m.boneControllers.length,
        m.skinnedMeshes && m.skinnedMeshes.length,
        m.hipsController && m.hipsController.name,
        m.modelConst && m.modelConst.id,
        m.modelConst && m.modelConst.isCustomRig
      ].join(':');
    }).join('|');
  }

  function watch() {
    try {
      var sig = signature();
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        setTimeout(function () { dump('auto model change'); }, 700);
      }
    } catch (e) {}
  }

  function boot() {
    log('ready', VERSION);
    log('Debug only: no scene/controller/transform logic is changed.');
    log('After loading FBX, run PMADebug.dump() if needed.');
    setInterval(watch, 1000);
    setTimeout(function () { dump('initial'); }, 2500);
  }

  window.PMADebug = {
    version: VERSION,
    findMainVm: findMainVm,
    dump: function () { return dump('manual'); },
    inspectModel: function (index) {
      var vm = findMainVm();
      var models = getModels(vm);
      return inspectModel(models[index], index, vm);
    },
    summaries: function () {
      var vm = findMainVm();
      return getModels(vm).map(function (m, i) { return modelSummary(m, vm, i); });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
