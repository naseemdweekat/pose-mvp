(function () {
  "use strict";

  var RUNS_LEFT = 120; // about 4 minutes
  var SKIN = 0xf2b493;
  var CONTROLLER = 0xffb229;

  function findMainVm() {
    var app = document.querySelector("#app");
    var root = app && app.__vue__;
    if (!root) return null;
    var stack = [root];
    while (stack.length) {
      var vm = stack.shift();
      if (vm && vm.sceneManager && vm.scene && vm.renderer) return vm;
      if (vm && vm.$children) stack.push.apply(stack, vm.$children);
    }
    return null;
  }

  function matList(material) {
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
  }

  function fixMaterials(model) {
    if (!model || !model.mesh || !model.mesh.traverse) return;
    model.mesh.traverse(function (obj) {
      if (!obj) return;

      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.frustumCulled = false;
        obj.castShadow = true;
        obj.receiveShadow = true;

        matList(obj.material).forEach(function (mat) {
          if (!mat) return;

          // The imported FBX sometimes comes in nearly black or with broken maps.
          // Force a simple readable skin material for the MVP.
          if (obj.name !== "BoneController" && obj.name !== "BoneControllerIK") {
            if (mat.color && mat.color.setHex) mat.color.setHex(SKIN);
            if (mat.emissive && mat.emissive.setHex) mat.emissive.setHex(0x1a120f);
            if ("metalness" in mat) mat.metalness = 0;
            if ("roughness" in mat) mat.roughness = 0.82;
            if ("skinNing" in mat) mat.skinning = true;
            mat.skinning = true; // needed by older Three.js builds for SkinnedMesh deformation
            mat.map = null;
            mat.alphaMap = null;
            mat.transparent = false;
            mat.opacity = 1;
            mat.side = 2;
            mat.needsUpdate = true;
          }
        });
      }

      if (obj.name === "BoneController" || obj.name === "BoneControllerIK") {
        obj.visible = true;
        matList(obj.material).forEach(function (mat) {
          if (!mat) return;
          if (mat.color && mat.color.setHex) mat.color.setHex(CONTROLLER);
          mat.opacity = 0.85;
          mat.transparent = true;
          mat.depthTest = false;
          mat.needsUpdate = true;
        });
      }
    });
  }

  function selectFirstModel(vm) {
    var models = (vm.sceneManager && vm.sceneManager.models) || vm.models || [];
    if (!models || !models.length) return;
    var first = models.find(function (m) {
      return m && m.isModel && !m.isGroup && !m.isDeleted;
    }) || models[0];

    if (first && !vm.selectedModel && typeof vm.selectObject === "function") {
      try { vm.selectObject(first, true); } catch (e) { /* ignore */ }
    }

    if (first) {
      fixMaterials(first);
      if (typeof vm.setEnableInverseKinematics === "function") {
        try { vm.setEnableInverseKinematics(true); } catch (e) { /* ignore */ }
      }
      if (typeof vm.showBoneControllers === "function") {
        try { vm.showBoneControllers(); } catch (e) { /* ignore */ }
      }
    }
  }

  function tick() {
    RUNS_LEFT -= 1;
    var vm = findMainVm();
    if (vm) {
      try {
        selectFirstModel(vm);
        var models = (vm.sceneManager && vm.sceneManager.models) || vm.models || [];
        models.forEach(fixMaterials);
      } catch (e) {
        console.warn("Anime base fixer error:", e);
      }
    }
    if (RUNS_LEFT <= 0) window.clearInterval(window.__animeBaseFixInterval);
  }

  window.__animeBaseFixInterval = window.setInterval(tick, 2000);
  window.addEventListener("load", function () { setTimeout(tick, 1500); });
})();
