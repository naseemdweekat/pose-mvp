
(function () {
  'use strict';

  var VERSION = 'locator-debug-v3-20260710';

  function log() {
    try { console.log.apply(console, ['[PMA Locator Debug v3]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function warn() {
    try { console.warn.apply(console, ['[PMA Locator Debug v3]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || null; } catch (e) { return null; }
  }

  function n4(x) {
    var v = Number(x || 0);
    return Math.round(v * 10000) / 10000;
  }

  function vec(v) {
    if (!v) return null;
    return { x: n4(v.x), y: n4(v.y), z: n4(v.z) };
  }

  function makeVec(obj) {
    try {
      var C = obj && obj.position && obj.position.constructor;
      if (C) return new C();
    } catch (e) {}
    return null;
  }

  function worldPos(obj) {
    try {
      var v = makeVec(obj);
      if (v && obj && obj.getWorldPosition) {
        obj.getWorldPosition(v);
        return vec(v);
      }
    } catch (e) {}
    return null;
  }

  function worldScale(obj) {
    try {
      var v = makeVec(obj);
      if (v && obj && obj.getWorldScale) {
        obj.getWorldScale(v);
        return vec(v);
      }
    } catch (e) {}
    return null;
  }

  function parentChain(obj, max) {
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

  function allDomVueRoots() {
    var roots = [];
    try {
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].__vue__ && roots.indexOf(all[i].__vue__) < 0) roots.push(all[i].__vue__);
      }
    } catch (e) {}
    return roots;
  }

  function allVueVMs() {
    var roots = allDomVueRoots();
    var seen = [];
    var stack = roots.slice();
    while (stack.length) {
      var vm = stack.shift();
      if (!vm || seen.indexOf(vm) >= 0) continue;
      seen.push(vm);
      try { if (vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children); } catch (e) {}
      try { if (vm.$parent && seen.indexOf(vm.$parent) < 0) stack.push(vm.$parent); } catch (e) {}
    }
    return seen;
  }

  function vmLabel(vm) {
    try {
      return (vm.$options && (vm.$options.name || vm.$options._componentTag || vm.$options.__file)) || '(anonymous)';
    } catch (e) {
      return '(unknown)';
    }
  }

  function sampleArray(arr) {
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 4).map(function (x) {
      return {
        name: safeName(x),
        sceneID: x && x.sceneID,
        id: x && x.id,
        isModel: x && x.isModel,
        isConstModel: x && x.type === 'model',
        controllers: x && x.boneControllers && x.boneControllers.length,
        skinnedMeshes: x && x.skinnedMeshes && x.skinnedMeshes.length,
        mesh: x && safeName(x.mesh),
        modelConst: x && x.modelConst && safeName(x.modelConst)
      };
    });
  }

  function describeVM(vm, index) {
    var sm = null;
    try { sm = vm.sceneManager || null; } catch (e) {}
    return {
      index: index,
      uid: vm && vm._uid,
      label: vmLabel(vm),
      hasSceneManager: !!sm,
      hasScene: !!(sm && sm.scene),
      smModelsLen: sm && sm.models && sm.models.length,
      smModelsSample: sm && sm.models ? JSON.stringify(sampleArray(sm.models)) : '',
      ownModelsLen: vm && vm.models && vm.models.length,
      ownModelsSample: vm && vm.models ? JSON.stringify(sampleArray(vm.models)) : '',
      selected: vm && safeName(vm.selectedModel),
      lastSelected: vm && safeName(vm.lastSelectedModel),
      hasRenderer: !!(vm && vm.renderer),
      hasCamera: !!(vm && vm.camera),
      hasTransform: !!(vm && vm.transformControl)
    };
  }

  function addUnique(arr, item) {
    if (item && arr.indexOf(item) < 0) arr.push(item);
  }

  function collectModelsFromScene(scene) {
    var models = [];
    try {
      if (!scene || !scene.traverse) return models;
      scene.traverse(function (obj) {
        try { if (obj && obj.posingModel) addUnique(models, obj.posingModel); } catch (e) {}
        try { if (obj && obj.parent && obj.parent.posingModel) addUnique(models, obj.parent.posingModel); } catch (e) {}
      });
    } catch (e) {}
    return models;
  }

  function collectAllPossibleModels() {
    var vms = allVueVMs();
    var models = [];
    vms.forEach(function (vm) {
      try { addUnique(models, vm.selectedModel); } catch (e) {}
      try { addUnique(models, vm.lastSelectedModel); } catch (e) {}
      try { if (vm.sceneManager && Array.isArray(vm.sceneManager.models)) vm.sceneManager.models.forEach(function (m) { addUnique(models, m); }); } catch (e) {}
      try { if (Array.isArray(vm.models)) vm.models.forEach(function (m) { if (m && (m.boneControllers || m.skinnedMeshes || m.mesh)) addUnique(models, m); }); } catch (e) {}
      try { collectModelsFromScene(vm.sceneManager && vm.sceneManager.scene).forEach(function (m) { addUnique(models, m); }); } catch (e) {}
      try { collectModelsFromScene(vm.scene).forEach(function (m) { addUnique(models, m); }); } catch (e) {}
    });
    return models;
  }

  function controllerRows(model) {
    var rows = [];
    try {
      (model.boneControllers || []).forEach(function (c, index) {
        rows.push({
          index: index,
          id: c.id,
          name: c.name,
          type: c.type,
          visible: c.visible,
          parent: safeName(c.parent),
          parentType: c.parent && c.parent.type,
          parentVisible: c.parent && c.parent.visible,
          geometry: c.geometry && c.geometry.type,
          geomParams: c.geometry && c.geometry.parameters ? JSON.stringify(c.geometry.parameters) : '',
          material: c.material && c.material.type,
          depthTest: c.material && c.material.depthTest,
          depthWrite: c.material && c.material.depthWrite,
          transparent: c.material && c.material.transparent,
          opacity: c.material && c.material.opacity,
          localPos: JSON.stringify(vec(c.position)),
          localScale: JSON.stringify(vec(c.scale)),
          worldPos: JSON.stringify(worldPos(c)),
          worldScale: JSON.stringify(worldScale(c)),
          chain: parentChain(c, 8)
        });
      });
    } catch (e) {}
    return rows;
  }

  function boneRows(model) {
    var rows = [];
    try {
      (model.skinnedMeshes || []).forEach(function (sk, smIndex) {
        var bones = (sk.skeleton && sk.skeleton.bones) || [];
        bones.forEach(function (b, index) {
          rows.push({
            sm: smIndex,
            index: index,
            name: b.name,
            type: b.type,
            visible: b.visible,
            parent: safeName(b.parent),
            children: b.children && b.children.length,
            localPos: JSON.stringify(vec(b.position)),
            localScale: JSON.stringify(vec(b.scale)),
            worldPos: JSON.stringify(worldPos(b)),
            worldScale: JSON.stringify(worldScale(b))
          });
        });
      });
    } catch (e) {}
    return rows;
  }

  function modelSummary(m, index) {
    var ctr = controllerRows(m);
    var bon = boneRows(m);
    return {
      index: index,
      name: safeName(m),
      sceneID: m && m.sceneID,
      isModel: m && m.isModel,
      isAnimal: m && m.isAnimal,
      isCustomRig_model: m && m.isCustomRig,
      isCustomRig_const: m && m.modelConst && m.modelConst.isCustomRig,
      isDisablePremium: m && m.isDisablePremium,
      modelConstName: m && m.modelConst && m.modelConst.name,
      modelConstId: m && m.modelConst && m.modelConst.id,
      modelConstBoneNames: m && m.modelConst && m.modelConst.boneNames && m.modelConst.boneNames.length,
      modelConstHip: m && m.modelConst && m.modelConst.hipBoneName,
      modelConstBoneSize: m && m.modelConst && m.modelConst.boneSize,
      modelConstHipSize: m && m.modelConst && m.modelConst.hipBoneSize,
      mesh: m && safeName(m.mesh),
      meshType: m && m.mesh && m.mesh.type,
      meshVisible: m && m.mesh && m.mesh.visible,
      skinnedMeshes: m && m.skinnedMeshes && m.skinnedMeshes.length,
      skeletonBones: bon.length,
      boneControllers: m && m.boneControllers && m.boneControllers.length,
      visibleControllers: ctr.filter(function (x) { return x.visible; }).length,
      hipsController: m && m.hipsController && m.hipsController.name,
      hipsType: m && m.hipsController && m.hipsController.type,
      hipsVisible: m && m.hipsController && m.hipsController.visible,
      hipsWorldPos: JSON.stringify(worldPos(m && m.hipsController))
    };
  }

  function inspectModel(m, index) {
    console.group('[PMA Locator Debug v3] MODEL #' + index + ' ' + safeName(m));
    console.log('Raw model:', m);
    console.log('Summary:', modelSummary(m, index));
    console.log('modelConst:', m && m.modelConst);
    var bones = boneRows(m);
    var ctrs = controllerRows(m);
    console.log('All bone names:', bones.map(function (x) { return x.name; }));
    console.table(bones.slice(0, 100));
    console.table(ctrs.slice(0, 120));
    console.groupEnd();
    return { summary: modelSummary(m, index), bones: bones, controllers: ctrs };
  }

  function dumpAll(reason) {
    var vms = allVueVMs();
    var vmRows = vms.map(describeVM);
    var models = collectAllPossibleModels();
    var summaries = models.map(modelSummary);

    console.group('[PMA Locator Debug v3] DUMP ' + (reason || 'manual'));
    console.log('Version:', VERSION);
    console.table(vmRows);
    console.table(summaries);
    console.log('VM rows JSON:', JSON.stringify(vmRows, null, 2));
    console.log('Model summaries JSON:', JSON.stringify(summaries, null, 2));
    console.groupEnd();

    models.forEach(function (m, i) {
      if ((m && m.boneControllers && m.boneControllers.length) || (m && m.skinnedMeshes && m.skinnedMeshes.length)) {
        inspectModel(m, i);
      }
    });

    window.PMALocatorLast = { version: VERSION, vmRows: vmRows, summaries: summaries };
    log('Saved compact result to window.PMALocatorLast');
    return window.PMALocatorLast;
  }

  var lastSig = '';
  function sig() {
    try {
      var models = collectAllPossibleModels();
      return models.map(function (m) {
        return [safeName(m), m.sceneID, m.boneControllers && m.boneControllers.length, m.skinnedMeshes && m.skinnedMeshes.length, m.hipsController && m.hipsController.name].join(':');
      }).join('|');
    } catch (e) { return ''; }
  }

  function watch() {
    var s = sig();
    if (s && s !== lastSig) {
      lastSig = s;
      setTimeout(function () { dumpAll('auto'); }, 700);
    }
  }

  window.PMALocator = {
    version: VERSION,
    dump: function () { return dumpAll('manual'); },
    vms: function () { return allVueVMs().map(describeVM); },
    models: function () { return collectAllPossibleModels().map(modelSummary); },
    inspect: function (i) { return inspectModel(collectAllPossibleModels()[i], i); }
  };

  function boot() {
    log('ready', VERSION);
    log('Run PMALocator.dump() after loading FBX.');
    setInterval(watch, 1000);
    setTimeout(function () { dumpAll('initial'); }, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
