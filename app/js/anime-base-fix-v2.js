(function () {
  "use strict";

  var FIX_VERSION = "anime-base-fix-v2-20260705";
  var RUNS_LEFT = 360; // keeps fixing while the app loads / changes models
  var SKIN = 0xf1b08f;
  var SKIN_EMISSIVE = 0x2b1710;
  var CONTROLLER = 0xffb229;
  var SELECTED = 0x34d399;
  var lastHint = "";

  function findMainVm() {
    var app = document.querySelector("#app");
    var root = app && app.__vue__;
    if (!root) return null;
    var stack = [root];
    while (stack.length) {
      var vm = stack.shift();
      if (vm && vm.sceneManager && vm.scene && vm.renderer) return vm;
      if (vm && vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children);
    }
    return null;
  }

  function matList(material) {
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
  }

  function setColor(mat, hex) {
    if (mat && mat.color && mat.color.setHex) mat.color.setHex(hex);
  }

  function isController(obj) {
    return obj && (obj.name === "BoneController" || obj.name === "BoneControllerIK");
  }

  function skipMesh(obj) {
    if (!obj) return true;
    if (isController(obj)) return false;
    var n = (obj.name || "").toLowerCase();
    if (n.indexOf("transform") >= 0) return true;
    if (n.indexOf("grid") >= 0) return true;
    if (n.indexOf("floor") >= 0) return true;
    if (n.indexOf("ground") >= 0) return true;
    if (n.indexOf("plane") >= 0 && !obj.isSkinnedMesh) return true;
    if (obj.isLine || obj.isLineSegments || obj.isHelper) return true;
    return false;
  }

  function cleanMaterial(mat, obj, hex) {
    if (!mat) return mat;
    var fixed = mat;

    // Clone first so we don't mutate cached FBX materials shared between objects.
    try {
      if (mat.clone) fixed = mat.clone();
    } catch (e) {
      fixed = mat;
    }

    // Some imported FBX materials come as black because the wrong texture channel is used.
    // Strip every map that can darken the model and force a readable skin tone.
    setColor(fixed, hex);
    if (fixed.emissive && fixed.emissive.setHex) fixed.emissive.setHex(SKIN_EMISSIVE);
    if ("emissiveIntensity" in fixed) fixed.emissiveIntensity = 0.18;
    if ("metalness" in fixed) fixed.metalness = 0;
    if ("roughness" in fixed) fixed.roughness = 0.78;
    if ("vertexColors" in fixed) fixed.vertexColors = false;

    var maps = [
      "map", "aoMap", "lightMap", "alphaMap", "emissiveMap", "specularMap",
      "metalnessMap", "roughnessMap", "envMap", "bumpMap", "displacementMap"
    ];
    for (var i = 0; i < maps.length; i += 1) {
      if (maps[i] in fixed) fixed[maps[i]] = null;
    }

    // Keep normal maps optional; if the model has a valid one it is fine, but broken maps can darken.
    if ("normalMap" in fixed) fixed.normalMap = null;

    fixed.skinning = !!(obj && obj.isSkinnedMesh);
    fixed.transparent = false;
    fixed.opacity = 1;
    fixed.side = 2; // THREE.DoubleSide in this build
    fixed.depthWrite = true;
    fixed.depthTest = true;
    fixed.needsUpdate = true;
    fixed.__pmaFixVersion = FIX_VERSION;
    return fixed;
  }

  function fixOneMesh(obj) {
    if (!obj || !(obj.isMesh || obj.isSkinnedMesh || obj.material)) return;
    if (skipMesh(obj)) return;

    obj.frustumCulled = false;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.visible = true;

    if (isController(obj)) {
      matList(obj.material).forEach(function (mat) {
        setColor(mat, CONTROLLER);
        if (mat) {
          mat.opacity = 0.9;
          mat.transparent = true;
          mat.depthTest = false;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        }
      });
      return;
    }

    var list = matList(obj.material);
    if (!list.length) return;
    var fixed = [];
    for (var i = 0; i < list.length; i += 1) {
      fixed.push(cleanMaterial(list[i], obj, SKIN));
    }
    obj.material = Array.isArray(obj.material) ? fixed : fixed[0];
  }

  function traverseModel(model, fn) {
    if (!model) return;
    if (model.mesh && model.mesh.traverse) model.mesh.traverse(fn);
    if (model.hipsController && model.hipsController.traverse) model.hipsController.traverse(fn);
    if (model.boneControllers && model.boneControllers.length) {
      model.boneControllers.forEach(function (c) { if (c && c.traverse) c.traverse(fn); else fn(c); });
    }
  }

  function getModels(vm) {
    if (!vm) return [];
    if (vm.sceneManager && vm.sceneManager.models) return vm.sceneManager.models;
    if (vm.models) return vm.models;
    return [];
  }

  function forceLights(vm) {
    if (!vm || !vm.scene) return;
    try {
      vm.scene.traverse(function (obj) {
        if (obj && obj.isLight) {
          obj.visible = true;
          if ("intensity" in obj && obj.intensity < 0.65) obj.intensity = 0.9;
        }
      });
    } catch (e) {}
  }

  function fixMaterials(vm) {
    if (!vm) return;
    forceLights(vm);

    var models = getModels(vm);
    models.forEach(function (m) {
      traverseModel(m, fixOneMesh);
    });

    // Extra fallback: catch FBX meshes even if the Vue model wrapper is not ready yet.
    if (vm.scene && vm.scene.traverse) {
      vm.scene.traverse(function (obj) {
        if (obj && (obj.isSkinnedMesh || (obj.isMesh && !skipMesh(obj)))) fixOneMesh(obj);
      });
    }
  }

  function selectFirstModel(vm) {
    var models = getModels(vm);
    if (!models.length) return null;
    var first = null;
    for (var i = 0; i < models.length; i += 1) {
      if (models[i] && models[i].isModel && !models[i].isGroup && !models[i].isDeleted) {
        first = models[i];
        break;
      }
    }
    first = first || models[0];

    if (first && !vm.selectedModel && typeof vm.selectObject === "function") {
      try { vm.selectObject(first, true); } catch (e) {}
    }

    if (first) {
      if (typeof vm.setEnableInverseKinematics === "function") {
        try { vm.setEnableInverseKinematics(true); } catch (e) {}
      }
      if (typeof vm.showBoneControllers === "function") {
        try { vm.showBoneControllers(); } catch (e) {}
      }
      if (first.boneControllers && first.boneControllers.length) {
        first.boneControllers.forEach(function (c) { if (c) c.visible = true; });
      }
    }
    return first;
  }

  function countBones(model) {
    var bones = [];
    traverseModel(model, function (obj) {
      if (obj && (obj.isBone || obj.type === "Bone")) bones.push(obj.name || "Bone");
    });
    return bones;
  }

  function ensureHud() {
    var hud = document.getElementById("pma-keyboard-fix-hud");
    if (hud) return hud;
    hud = document.createElement("div");
    hud.id = "pma-keyboard-fix-hud";
    hud.innerHTML =
      '<div class="pma-hud-title">Anime Base Fix</div>' +
      '<div id="pma-keyboard-target">Loading model...</div>' +
      '<div class="pma-hud-small">W/A/S/D or Arrows = rotate selected joint</div>' +
      '<div class="pma-hud-small">Shift + W/A/S/D = move selected point</div>' +
      '<div class="pma-hud-small">Q/E = twist · R/F = up/down</div>';
    document.body.appendChild(hud);

    var style = document.createElement("style");
    style.textContent =
      "#pma-keyboard-fix-hud{position:fixed;right:14px;bottom:14px;z-index:99999;background:rgba(22,24,30,.86);color:#fff;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 35px rgba(0,0,0,.35);backdrop-filter:blur(10px);border-radius:14px;padding:12px 14px;font-family:Arial,sans-serif;font-size:12px;line-height:1.45;max-width:280px;pointer-events:none;}" +
      "#pma-keyboard-fix-hud .pma-hud-title{font-weight:700;color:#ffb229;margin-bottom:4px;}" +
      "#pma-keyboard-target{font-weight:600;margin-bottom:6px;color:#dbeafe;}" +
      "#pma-keyboard-fix-hud .pma-hud-small{opacity:.8;}" +
      "@media(max-width:720px){#pma-keyboard-fix-hud{display:none;}}";
    document.head.appendChild(style);
    return hud;
  }

  function setHud(text) {
    ensureHud();
    var el = document.getElementById("pma-keyboard-target");
    if (el && text !== lastHint) {
      el.textContent = text;
      lastHint = text;
    }
  }

  function getTransformTarget(vm) {
    if (!vm) return null;
    if (vm.transformControl && vm.transformControl.object) return vm.transformControl.object;
    if (vm.selectedModel) {
      if (vm.selectedModel.isModel && vm.selectedModel.hipsController) return vm.selectedModel.hipsController;
      if (vm.selectedModel.mesh) return vm.selectedModel.mesh;
    }
    var first = selectFirstModel(vm);
    if (first) return first.hipsController || first.mesh || null;
    return null;
  }

  function updateAfterMove(vm, target) {
    try { if (target && target.updateMatrixWorld) target.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.selectedModel && vm.selectedModel.mesh && vm.selectedModel.mesh.updateMatrixWorld) vm.selectedModel.mesh.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.scene && vm.scene.updateMatrixWorld) vm.scene.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.$store && vm.selectedModel) vm.$store.commit("updateModel", vm.selectedModel); } catch (e) {}
    try { if (vm && vm.transformControl && vm.transformControl.dispatchEvent) vm.transformControl.dispatchEvent({ type: "objectChange" }); } catch (e) {}
  }

  function moveOrRotateByKeyboard(evt) {
    var tag = (evt.target && evt.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (evt.target && evt.target.isContentEditable)) return;

    var key = evt.key || "";
    var k = key.toLowerCase();
    var allowed = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "q", "e", "r", "f"];
    if (allowed.indexOf(k) < 0) return;

    var vm = findMainVm();
    if (!vm) return;
    var target = getTransformTarget(vm);
    if (!target) {
      setHud("No selected model/controller");
      return;
    }

    evt.preventDefault();

    var posStep = evt.ctrlKey ? 10 : (evt.altKey ? 1 : 4);
    var rotStep = (evt.ctrlKey ? 10 : (evt.altKey ? 1.5 : 4)) * Math.PI / 180;
    var mode = "";
    try { mode = vm.transformControl && vm.transformControl.getMode ? vm.transformControl.getMode() : ""; } catch (e) {}

    // Default for joints/controllers is rotation. Hold Shift to move the point itself.
    var translate = evt.shiftKey || mode === "translate" || k === "r" || k === "f";

    if (translate) {
      if (!target.position) return;
      if (k === "arrowup" || k === "w") target.position.z -= posStep;
      if (k === "arrowdown" || k === "s") target.position.z += posStep;
      if (k === "arrowleft" || k === "a") target.position.x -= posStep;
      if (k === "arrowright" || k === "d") target.position.x += posStep;
      if (k === "r") target.position.y += posStep;
      if (k === "f") target.position.y -= posStep;
    } else {
      if (!target.rotation) return;
      if (k === "arrowup" || k === "w") target.rotation.x -= rotStep;
      if (k === "arrowdown" || k === "s") target.rotation.x += rotStep;
      if (k === "arrowleft" || k === "a") target.rotation.y += rotStep;
      if (k === "arrowright" || k === "d") target.rotation.y -= rotStep;
      if (k === "q") target.rotation.z += rotStep;
      if (k === "e") target.rotation.z -= rotStep;
    }

    updateAfterMove(vm, target);
    setHud("Selected: " + (target.name || target.type || "Object") + (translate ? " · Move" : " · Rotate"));
  }

  function tick() {
    RUNS_LEFT -= 1;
    var vm = findMainVm();
    if (vm) {
      try {
        var model = selectFirstModel(vm);
        fixMaterials(vm);
        if (model) {
          var controllers = model.boneControllers ? model.boneControllers.length : 0;
          if (controllers > 0) {
            setHud("Controllers ready: " + controllers);
          } else {
            var bones = countBones(model);
            if (bones.length) {
              setHud("Bones found, controllers not mapped: " + bones.length);
              if (!window.__pmaBonesLogged) {
                console.info("Anime Base bones found:", bones.slice(0, 120));
                window.__pmaBonesLogged = true;
              }
            } else {
              setHud("No rig/controllers detected on this FBX");
            }
          }
        }
      } catch (e) {
        console.warn("Anime base v2 fixer error:", e);
      }
    }
    if (RUNS_LEFT <= 0 && window.__animeBaseFixV2Interval) window.clearInterval(window.__animeBaseFixV2Interval);
  }

  document.addEventListener("keydown", moveOrRotateByKeyboard, true);
  window.__animeBaseFixV2Interval = window.setInterval(tick, 1000);
  window.addEventListener("load", function () { setTimeout(tick, 1000); setTimeout(tick, 3500); });
})();
