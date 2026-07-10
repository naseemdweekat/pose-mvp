
(function () {
  'use strict';

  var VERSION = 'any-rig-debug-only-v1-20260710';
  var lastSignature = '';
  var lastManualDump = 0;

  function log() {
    try { console.log.apply(console, ['[PMA Any Rig Debug]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function warn() {
    try { console.warn.apply(console, ['[PMA Any Rig Debug]'].concat([].slice.call(arguments))); } catch (e) {}
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
    try { if (vm.sceneManager) s += 30; } catch (e) {}
    try { if (vm.renderer) s += 10; } catch (e) {}
    try { if (vm.camera) s += 10; } catch (e) {}
    try { if (vm.transformControl) s += 10; } catch (e) {}
    try { if (Array.isArray(vm.models)) s += 10; } catch (e) {}
    return s;
  }

  function findMainVm() {
    var roots = findVueRootsFromDom();
    var stack = roots.slice();
    var best = null;
    var bestScore = 0;
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
    try { if (vm && vm.sceneManager && Array.isArray(vm.sceneManager.models)) return vm.sceneManager.models; } catch (e) {}
    try { if (vm && Array.isArray(vm.models)) return vm.models; } catch (e) {}
    return [];
  }

  function safeName(o) {
    try { return o && (o.name || o.type || o.uuid || String(o.id)) || null; } catch (e) { return null; }
  }

  function vec3ToObj(v) {
    if (!v) return null;
    return {
      x: Number((v.x || 0).toFixed ? v.x.toFixed(4) : v.x || 0),
      y: Number((v.y || 0).toFixed ? v.y.toFixed(4) : v.y || 0),
      z: Number((v.z || 0).toFixed ? v.z.toFixed(4) : v.z || 0)
    };
  }

  function parentChain(obj, max) {
    var out = [];
    var p = obj;
    var n = 0;
    while (p && n < (max || 8)) {
      out.push(safeName(p));
      p = p.parent;
      n += 1;
    }
    return out.join(' <- ');
  }

  function getWorldPosition(obj) {
    try {
      if (!obj || !obj.getWorldPosition) return null;
      var v = new THREE.Vector3();
      obj.getWorldPosition(v);
      return vec3ToObj(v);
    } catch (e) {
      try {
        if (!obj || !obj.getWorldPosition) return null;
        var vm = findMainVm();
        var ctor = vm && vm.camera && vm.camera.position && vm.camera.position.constructor;
        if (ctor) {
          var vv = new ctor();
          obj.getWorldPosition(vv);
          return vec3ToObj(vv);
        }
      } catch (_e) {}
    }
    return null;
  }

  function getWorldScale(obj) {
    try {
      if (!obj || !obj.getWorldScale) return null;
      var vm = findMainVm();
      var ctor = obj.position && obj.position.constructor;
      var v = ctor ? new ctor() : null;
      if (!v) return null;
      obj.getWorldScale(v);
      return vec3ToObj(v);
    } catch (e) {}
    return null;
  }

  function getBoneRows(model) {
    var rows = [];
    try {
      (model.skinnedMeshes || []).forEach(function (sk, skIndex) {
        var bones = (sk.skeleton && sk.skeleton.bones) || [];
        bones.forEach(function (b, idx) {
          rows.push({
            skinnedMesh: skIndex,
            index: idx,
            name: b.name,
            type: b.type,
            visible: b.visible,
            parent: safeName(b.parent),
            children: b.children ? b.children.length : 0,
            localPos: vec3ToObj(b.position),
            localScale: vec3ToObj(b.scale),
            worldPos: getWorldPosition(b),
            worldScale: getWorldScale(b)
          });
        });
      });
    } catch (e) {
      warn('getBoneRows failed', e);
    }
    return rows;
  }

  function getControllerRows(model) {
    var rows = [];
    try {
      (model.boneControllers || []).forEach(function (c, idx) {
        rows.push({
          index: idx,
          name: c.name,
          type: c.type,
          visible: c.visible,
          parent: safeName(c.parent),
          parentType: c.parent && c.parent.type,
          parentVisible: c.parent && c.parent.visible,
          renderOrder: c.renderOrder,
          geometry: c.geometry && c.geometry.type,
          material: c.material && c.material.type,
          matVisible: c.material && c.material.visible,
          matDepthTest: c.material && c.material.depthTest,
          matTransparent: c.material && c.material.transparent,
          matOpacity: c.material && c.material.opacity,
          localPos: vec3ToObj(c.position),
          localScale: vec3ToObj(c.scale),
          worldPos: getWorldPosition(c),
          worldScale: getWorldScale(c),
          parentChain: parentChain(c, 7)
        });
      });
    } catch (e) {
      warn('getControllerRows failed', e);
    }
    return rows;
  }

  function summarizeRows(rows) {
    var out = {
      total: rows.length,
      visible: 0,
      parentVisible: 0,
      hasWorldPos: 0,
      geometryTypes: {},
      parentTypes: {}
    };
    rows.forEach(function (r) {
      if (r.visible) out.visible += 1;
      if (r.parentVisible) out.parentVisible += 1;
      if (r.worldPos) out.hasWorldPos += 1;
      if (r.geometry) out.geometryTypes[r.geometry] = (out.geometryTypes[r.geometry] || 0) + 1;
      if (r.parentType) out.parentTypes[r.parentType] = (out.parentTypes[r.parentType] || 0) + 1;
    });
    return out;
  }

  function inspectModel(model, label) {
    if (!model) {
      warn('No model to inspect.');
      return null;
    }

    var boneRows = getBoneRows(model);
    var controllerRows = getControllerRows(model);
    var summary = {
      label: label || '',
      sceneID: model.sceneID,
      name: model.name,
      isModel: model.isModel,
      isAnimal: model.isAnimal,
      isCustomRig: model.isCustomRig || (model.modelConst && model.modelConst.isCustomRig),
      isDisablePremium: model.isDisablePremium,
      modelConst: model.modelConst ? {
        id: model.modelConst.id,
        name: model.modelConst.name,
        isPremium: model.modelConst.isPremium,
        isCustomRig: model.modelConst.isCustomRig,
        isAnimal: model.modelConst.isAnimal,
        boneNamesCount: model.modelConst.boneNames && model.modelConst.boneNames.length,
        handBoneNamesCount: model.modelConst.handBoneNames && model.modelConst.handBoneNames.length,
        hipBoneName: model.modelConst.hipBoneName,
        boneSize: model.modelConst.boneSize,
        handBoneSize: model.modelConst.handBoneSize,
        hipBoneSize: model.modelConst.hipBoneSize
      } : null,
      mesh: model.mesh ? {
        name: model.mesh.name,
        type: model.mesh.type,
        visible: model.mesh.visible,
        children: model.mesh.children && model.mesh.children.length,
        worldPos: getWorldPosition(model.mesh),
        worldScale: getWorldScale(model.mesh)
      } : null,
      hipsController: model.hipsController ? {
        name: model.hipsController.name,
        type: model.hipsController.type,
        visible: model.hipsController.visible,
        worldPos: getWorldPosition(model.hipsController),
        worldScale: getWorldScale(model.hipsController)
      } : null,
      skinnedMeshes: (model.skinnedMeshes || []).map(function (sk, i) {
        return {
          index: i,
          name: sk.name,
          type: sk.type,
          visible: sk.visible,
          skeletonBones: sk.skeleton && sk.skeleton.bones && sk.skeleton.bones.length,
          worldPos: getWorldPosition(sk),
          worldScale: getWorldScale(sk)
        };
      }),
      bones: {
        total: boneRows.length,
        first20: boneRows.slice(0, 20)
      },
      controllers: summarizeRows(controllerRows)
    };

    console.group('[PMA Any Rig Debug] MODEL INSPECTION: ' + (model.name || model.sceneID));
    console.log('Summary:', summary);
    console.log('All bone names:', boneRows.map(function (b) { return b.name; }));
    console.table(boneRows.slice(0, 60));
    console.table(controllerRows.slice(0, 80));
    console.groupEnd();

    return { summary: summary, bones: boneRows, controllers: controllerRows };
  }

  function dumpAll(reason) {
    var vm = findMainVm();
    if (!vm) {
      warn('Vue/main app VM not found yet.');
      return;
    }

    var models = getModels(vm);
    var selected = null;
    try { selected = vm.selectedModel || null; } catch (e) {}
    var custom = models.filter(function (m) {
      try { return m && (m.isCustomRig || (m.modelConst && m.modelConst.isCustomRig)); } catch (e) { return false; }
    });

    console.group('[PMA Any Rig Debug] APP DUMP: ' + (reason || 'manual'));
    console.log('Version:', VERSION);
    console.log('Models:', models.map(function (m) {
      return {
        sceneID: m.sceneID,
        name: m.name,
        isModel: m.isModel,
        isCustomRig: m.isCustomRig || (m.modelConst && m.modelConst.isCustomRig),
        isAnimal: m.isAnimal,
        controllers: m.boneControllers && m.boneControllers.length,
        skinnedMeshes: m.skinnedMeshes && m.skinnedMeshes.length,
        hipsController: m.hipsController && m.hipsController.name
      };
    }));
    console.log('Selected:', selected && {
      sceneID: selected.sceneID,
      name: selected.name,
      controllers: selected.boneControllers && selected.boneControllers.length,
      hipsController: selected.hipsController && selected.hipsController.name
    });
    console.log('TransformControl:', vm.transformControl && {
      visible: vm.transformControl.visible,
      object: safeName(vm.transformControl.object),
      objectType: vm.transformControl.object && vm.transformControl.object.type,
      objectParent: vm.transformControl.object && safeName(vm.transformControl.object.parent)
    });
    console.groupEnd();

    if (custom.length) {
      custom.forEach(function (m, i) { inspectModel(m, 'custom #' + i); });
    } else if (selected) {
      inspectModel(selected, 'selected');
    } else {
      log('No custom rig found yet. Load Add Custom Rig (.fbx), then run: PMADebug.dump()');
    }
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
        m.modelConst && m.modelConst.isCustomRig
      ].join(':');
    }).join('|');
  }

  function watch() {
    try {
      var sig = signature();
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        setTimeout(function () { dumpAll('auto model change'); }, 400);
      }
    } catch (e) {}
  }

  function boot() {
    log('ready', VERSION);
    log('This is debug-only. It does not change controllers, transforms, or scene objects.');
    log('After loading your rig, run PMADebug.dump() if the auto log is not enough.');
    setInterval(watch, 1000);
    setTimeout(function () { dumpAll('initial'); }, 2500);
  }

  window.PMADebug = {
    version: VERSION,
    findMainVm: findMainVm,
    dump: function () { dumpAll('manual'); },
    inspectSelected: function () {
      var vm = findMainVm();
      return inspectModel(vm && vm.selectedModel, 'manual selected');
    },
    inspectCustom: function () {
      var vm = findMainVm();
      var models = getModels(vm);
      var custom = models.filter(function (m) { return m && (m.isCustomRig || (m.modelConst && m.modelConst.isCustomRig)); });
      custom.forEach(function (m, i) { inspectModel(m, 'manual custom #' + i); });
      return custom.length;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
