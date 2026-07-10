(function () {
  "use strict";

  var FIX_VERSION = "anime-base-fix-v4-20260705-unlit-material-normals-keyboard";
  var RUNS_LEFT = 1800; // about 6 minutes at 300ms
  var SKIN = 0xf2b48f;
  var SHADOW_SKIN = 0xffc39c;
  var FORCE_UNLIT = true;
  var HAIR = 0x1b1716;
  var CONTROLLER = 0xffb229;
  var SELECTED = 0x34d399;
  var lastHint = "";
  var selectedBoneName = "mixamorig:Spine2";
  var selectedBone = null;
  var lastVM = null;

  var BONE_SHORTCUTS = {
    "1": "mixamorig:Head",
    "2": "mixamorig:Spine2",
    "3": "mixamorig:LeftArm",
    "4": "mixamorig:LeftForeArm",
    "5": "mixamorig:RightArm",
    "6": "mixamorig:RightForeArm",
    "7": "mixamorig:LeftUpLeg",
    "8": "mixamorig:LeftLeg",
    "9": "mixamorig:RightUpLeg",
    "0": "mixamorig:RightLeg"
  };

  var BONE_LABELS = [
    ["Head", "mixamorig:Head"],
    ["Chest", "mixamorig:Spine2"],
    ["L Arm", "mixamorig:LeftArm"],
    ["L Elbow", "mixamorig:LeftForeArm"],
    ["R Arm", "mixamorig:RightArm"],
    ["R Elbow", "mixamorig:RightForeArm"],
    ["L Thigh", "mixamorig:LeftUpLeg"],
    ["L Knee", "mixamorig:LeftLeg"],
    ["R Thigh", "mixamorig:RightUpLeg"],
    ["R Knee", "mixamorig:RightLeg"],
    ["L Hand", "mixamorig:LeftHand"],
    ["R Hand", "mixamorig:RightHand"],
    ["L Foot", "mixamorig:LeftFoot"],
    ["R Foot", "mixamorig:RightFoot"]
  ];

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

  function getModels(vm) {
    if (!vm) return [];
    if (vm.sceneManager && vm.sceneManager.models) return vm.sceneManager.models;
    if (vm.models) return vm.models;
    return [];
  }

  function matList(material) {
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
  }

  function lowerName(obj) {
    return String((obj && obj.name) || "").toLowerCase();
  }

  function isController(obj) {
    return obj && (obj.name === "BoneController" || obj.name === "BoneControllerIK" || lowerName(obj).indexOf("controller") >= 0);
  }

  function skipMesh(obj) {
    if (!obj) return true;
    if (isController(obj)) return false;
    var n = lowerName(obj);
    if (n.indexOf("transform") >= 0) return true;
    if (n.indexOf("grid") >= 0) return true;
    if (n.indexOf("floor") >= 0) return true;
    if (n.indexOf("ground") >= 0) return true;
    if (n.indexOf("plane") >= 0 && !obj.isSkinnedMesh) return true;
    if (obj.isLine || obj.isLineSegments || obj.isHelper) return true;
    return false;
  }

  function setMatColor(mat, hex) {
    if (!mat) return;
    try { if (mat.color && mat.color.setHex) mat.color.setHex(hex); } catch (e) {}
    try { if (mat.emissive && mat.emissive.setHex) mat.emissive.setHex(hex); } catch (e) {}
    try { if (mat.specular && mat.specular.setHex) mat.specular.setHex(0x050505); } catch (e) {}
    try { if (mat.uniforms) {
      Object.keys(mat.uniforms).forEach(function (k) {
        var u = mat.uniforms[k];
        if (!u || !u.value) return;
        if (/color|diffuse|albedo|base/i.test(k) && u.value.setHex) u.value.setHex(hex);
      });
    }} catch (e) {}
  }

  function forceMaterialFlags(mat, obj) {
    if (!mat) return;
    setMatColor(mat, SKIN);
    var maps = [
      "map", "aoMap", "lightMap", "alphaMap", "emissiveMap", "specularMap",
      "metalnessMap", "roughnessMap", "envMap", "bumpMap", "normalMap", "displacementMap"
    ];
    maps.forEach(function (m) { try { if (m in mat) mat[m] = null; } catch (e) {} });
    try { if ("metalness" in mat) mat.metalness = 0; } catch (e) {}
    try { if ("roughness" in mat) mat.roughness = 0.65; } catch (e) {}
    try { if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.55; } catch (e) {}
    try { if ("vertexColors" in mat) mat.vertexColors = false; } catch (e) {}
    try { if ("skinning" in mat) mat.skinning = !!(obj && obj.isSkinnedMesh); } catch (e) {}
    try { if ("morphTargets" in mat) mat.morphTargets = true; } catch (e) {}
    try { if ("toneMapped" in mat) mat.toneMapped = false; } catch (e) {}
    try { mat.transparent = false; mat.opacity = 1; mat.side = 2; mat.depthWrite = true; mat.depthTest = true; mat.lights = true; mat.needsUpdate = true; } catch (e) {}
    mat.__pmaFixVersion = FIX_VERSION;
  }

  function replaceWithReadableMaterial(obj) {
    // If the original material is a ShaderMaterial / broken black import, replace it with a clean
    // material using the same material constructor when possible. This avoids relying on textures.
    var original = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!original || obj.__pmaReadableMaterialApplied) return;
    var ctor = original.constructor;
    try {
      var clean = new ctor({ color: SKIN, emissive: 0x23130c, emissiveIntensity: 0.45, roughness: 0.65, metalness: 0, skinning: !!obj.isSkinnedMesh });
      forceMaterialFlags(clean, obj);
      obj.material = clean;
      obj.__pmaReadableMaterialApplied = true;
      return;
    } catch (e) {}
    forceMaterialFlags(original, obj);
  }


  function repairGeometry(obj) {
    try {
      if (!obj || !obj.geometry) return;
      var g = obj.geometry;
      // A lot of downloaded FBX files contain unusable / inverted / zero normals.
      // Rebuilding normals fixes lit materials; unlit/emissive is still used as a safe fallback.
      if (g.attributes && g.attributes.normal) {
        try { g.deleteAttribute && g.deleteAttribute("normal"); } catch (e) {}
      }
      try { if (g.computeVertexNormals) g.computeVertexNormals(); } catch (e) {}
      try { if (g.normalizeNormals) g.normalizeNormals(); } catch (e) {}
      try { if (g.attributes && g.attributes.normal) g.attributes.normal.needsUpdate = true; } catch (e) {}
      try { g.needsUpdate = true; } catch (e) {}
    } catch (e) {}
  }

  function makeUnlitReadableMaterial(obj) {
    var original = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!original) return null;
    // The original app bundle does not expose THREE globally, so use the imported material constructor.
    // We make the material self-lit by setting color + emissive to the same skin tone.
    try {
      var mat = new original.constructor({
        color: SKIN,
        emissive: SKIN,
        emissiveIntensity: 1.0,
        roughness: 0.8,
        metalness: 0,
        skinning: !!obj.isSkinnedMesh,
        wireframe: false
      });
      forceMaterialFlags(mat, obj);
      try { if (mat.emissive && mat.emissive.setHex) mat.emissive.setHex(SKIN); } catch (e) {}
      try { if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1.25; } catch (e) {}
      try { if ("lights" in mat) mat.lights = true; } catch (e) {}
      mat.__pmaUnlitReadable = true;
      return mat;
    } catch (e) {
      // Fallback: modify original material very aggressively.
      forceMaterialFlags(original, obj);
      try { if (original.emissive && original.emissive.setHex) original.emissive.setHex(SKIN); } catch (ee) {}
      try { if ("emissiveIntensity" in original) original.emissiveIntensity = 1.25; } catch (ee) {}
      return original;
    }
  }

  function fixOneMesh(obj) {
    if (!obj || !(obj.isMesh || obj.isSkinnedMesh || obj.material)) return;
    if (skipMesh(obj)) return;

    try { obj.frustumCulled = false; obj.castShadow = false; obj.receiveShadow = false; obj.visible = true; } catch (e) {}
    repairGeometry(obj);

    if (isController(obj)) {
      matList(obj.material).forEach(function (mat) {
        setMatColor(mat, CONTROLLER);
        try { mat.opacity = 0.95; mat.transparent = true; mat.depthTest = false; mat.depthWrite = false; mat.needsUpdate = true; } catch (e) {}
      });
      return;
    }

    // Use a strongly self-lit readable material; this bypasses bad FBX normals/AO lighting.
    if (!obj.__pmaUnlitV4Applied) {
      var readable = makeUnlitReadableMaterial(obj);
      if (readable) obj.material = readable;
      obj.__pmaUnlitV4Applied = true;
    }

    matList(obj.material).forEach(function (mat) { forceMaterialFlags(mat, obj); });
  }

  function traverseModel(model, fn) {
    if (!model) return;
    if (model.mesh && model.mesh.traverse) model.mesh.traverse(fn);
    if (model.hipsController && model.hipsController.traverse) model.hipsController.traverse(fn);
    if (model.boneControllers && model.boneControllers.length) {
      model.boneControllers.forEach(function (c) { if (c && c.traverse) c.traverse(fn); else fn(c); });
    }
  }

  function forceLights(vm) {
    if (!vm || !vm.scene) return;
    try {
      var hasAmbient = false;
      vm.scene.traverse(function (obj) {
        if (obj && obj.isLight) {
          obj.visible = true;
          if (obj.type === "AmbientLight") hasAmbient = true;
          if ("intensity" in obj && obj.intensity < 1.0) obj.intensity = 1.0;
        }
      });
      // Try to add an ambient light from the constructor of an existing light if possible.
      // If not possible, material emissive already keeps the model readable.
    } catch (e) {}
  }

  function fixMaterials(vm) {
    if (!vm) return;
    forceLights(vm);
    getModels(vm).forEach(function (m) { traverseModel(m, fixOneMesh); });
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
      if (models[i] && models[i].isModel && !models[i].isGroup && !models[i].isDeleted) { first = models[i]; break; }
    }
    first = first || models[0];
    try { if (first && !vm.selectedModel && typeof vm.selectObject === "function") vm.selectObject(first, true); } catch (e) {}
    try { if (typeof vm.setEnableInverseKinematics === "function") vm.setEnableInverseKinematics(true); } catch (e) {}
    try { if (typeof vm.showBoneControllers === "function") vm.showBoneControllers(); } catch (e) {}
    try { if (first && first.boneControllers && first.boneControllers.length) first.boneControllers.forEach(function (c) { if (c) c.visible = true; }); } catch (e) {}
    return first;
  }

  function collectBonesFromObject(root, list) {
    if (!root || !root.traverse) return;
    root.traverse(function (obj) {
      if (obj && (obj.isBone || obj.type === "Bone")) list.push(obj);
      if (obj && obj.isSkinnedMesh && obj.skeleton && obj.skeleton.bones) {
        obj.skeleton.bones.forEach(function (b) { if (list.indexOf(b) < 0) list.push(b); });
      }
    });
  }

  function getAllBones(vm) {
    var bones = [];
    getModels(vm).forEach(function (m) {
      if (m.mesh) collectBonesFromObject(m.mesh, bones);
    });
    if (vm && vm.scene) collectBonesFromObject(vm.scene, bones);
    var seen = {};
    return bones.filter(function (b) {
      var key = b.uuid || b.name;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function findBone(vm, wanted) {
    var bones = getAllBones(vm);
    var normalized = String(wanted || "").toLowerCase();
    for (var i = 0; i < bones.length; i += 1) {
      if (String(bones[i].name || "").toLowerCase() === normalized) return bones[i];
    }
    // fallback: allow searching without mixamorig prefix
    normalized = normalized.replace(/^mixamorig:/, "");
    for (var j = 0; j < bones.length; j += 1) {
      var n = String(bones[j].name || "").toLowerCase().replace(/^mixamorig:/, "");
      if (n === normalized) return bones[j];
    }
    return bones[0] || null;
  }

  function getTransformTarget(vm) {
    if (!vm) return null;
    if (selectedBone) return selectedBone;
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
    try { if (target && target.parent && target.parent.updateMatrixWorld) target.parent.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.selectedModel && vm.selectedModel.mesh && vm.selectedModel.mesh.updateMatrixWorld) vm.selectedModel.mesh.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.scene && vm.scene.updateMatrixWorld) vm.scene.updateMatrixWorld(true); } catch (e) {}
    try { if (vm && vm.$store && vm.selectedModel) vm.$store.commit("updateModel", vm.selectedModel); } catch (e) {}
    try { if (vm && vm.transformControl && vm.transformControl.dispatchEvent) vm.transformControl.dispatchEvent({ type: "objectChange" }); } catch (e) {}
  }

  function shortBoneName(name) {
    return String(name || "Object").replace(/^mixamorig:/, "");
  }

  function selectBoneByName(name) {
    selectedBoneName = name;
    var vm = findMainVm() || lastVM;
    if (vm) {
      selectedBone = findBone(vm, name);
      setHud(selectedBone ? ("Bone selected: " + shortBoneName(selectedBone.name)) : ("Bone not found: " + shortBoneName(name)));
    }
    syncBoneButtons();
  }

  function cycleBone(dir) {
    var idx = 0;
    for (var i = 0; i < BONE_LABELS.length; i += 1) if (BONE_LABELS[i][1] === selectedBoneName) idx = i;
    idx = (idx + dir + BONE_LABELS.length) % BONE_LABELS.length;
    selectBoneByName(BONE_LABELS[idx][1]);
  }

  function moveOrRotateByKeyboard(evt) {
    var tag = (evt.target && evt.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (evt.target && evt.target.isContentEditable)) return;

    var key = evt.key || "";
    var k = key.toLowerCase();

    if (BONE_SHORTCUTS[k]) {
      evt.preventDefault();
      selectBoneByName(BONE_SHORTCUTS[k]);
      return;
    }
    if (k === "[" || k === ",") { evt.preventDefault(); cycleBone(-1); return; }
    if (k === "]" || k === ".") { evt.preventDefault(); cycleBone(1); return; }

    var allowed = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "q", "e", "r", "f"];
    if (allowed.indexOf(k) < 0) return;

    var vm = findMainVm();
    if (!vm) return;
    lastVM = vm;
    if (!selectedBone) selectedBone = findBone(vm, selectedBoneName);
    var target = getTransformTarget(vm);
    if (!target) { setHud("No selected bone/model"); return; }

    evt.preventDefault();

    var posStep = evt.ctrlKey ? 10 : (evt.altKey ? 1 : 4);
    var rotStep = (evt.ctrlKey ? 9 : (evt.altKey ? 1.5 : 4)) * Math.PI / 180;
    var isBone = target && (target.isBone || target.type === "Bone");
    var translate = !isBone && (evt.shiftKey || k === "r" || k === "f");

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
      // For bones, W/S bend, A/D swing, Q/E twist. For model/controllers, same idea.
      if (k === "arrowup" || k === "w") target.rotation.x -= rotStep;
      if (k === "arrowdown" || k === "s") target.rotation.x += rotStep;
      if (k === "arrowleft" || k === "a") target.rotation.y += rotStep;
      if (k === "arrowright" || k === "d") target.rotation.y -= rotStep;
      if (k === "q") target.rotation.z += rotStep;
      if (k === "e") target.rotation.z -= rotStep;
      if (k === "r") target.rotation.z += rotStep;
      if (k === "f") target.rotation.z -= rotStep;
    }

    updateAfterMove(vm, target);
    setHud((isBone ? "Bone" : "Selected") + ": " + shortBoneName(target.name || target.type) + (translate ? " · Move" : " · Rotate"));
  }

  function ensureHud() {
    var hud = document.getElementById("pma-keyboard-fix-hud");
    if (hud) return hud;
    hud = document.createElement("div");
    hud.id = "pma-keyboard-fix-hud";
    hud.innerHTML =
      '<div class="pma-hud-title">Anime Base Controls · v4</div>' +
      '<div id="pma-keyboard-target">Loading model...</div>' +
      '<div class="pma-hud-small">1-0 = select bone · [ ] = cycle</div>' +
      '<div class="pma-hud-small">W/A/S/D or Arrows = rotate selected bone</div>' +
      '<div class="pma-hud-small">Q/E = twist · Alt = precise · Ctrl = faster</div>' +
      '<div id="pma-bone-buttons"></div>';
    document.body.appendChild(hud);

    var style = document.createElement("style");
    style.textContent =
      "#pma-keyboard-fix-hud{position:fixed;right:14px;bottom:14px;z-index:99999;background:rgba(22,24,30,.88);color:#fff;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 35px rgba(0,0,0,.35);backdrop-filter:blur(10px);border-radius:14px;padding:12px 14px;font-family:Arial,sans-serif;font-size:12px;line-height:1.45;max-width:330px;}" +
      "#pma-keyboard-fix-hud .pma-hud-title{font-weight:700;color:#ffb229;margin-bottom:4px;}" +
      "#pma-keyboard-target{font-weight:600;margin-bottom:6px;color:#dbeafe;}" +
      "#pma-keyboard-fix-hud .pma-hud-small{opacity:.78;}" +
      "#pma-bone-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px;}" +
      "#pma-bone-buttons button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:4px 6px;font-size:11px;cursor:pointer;}" +
      "#pma-bone-buttons button.active{background:#ffb229;color:#171717;font-weight:700;}" +
      "@media(max-width:720px){#pma-keyboard-fix-hud{left:10px;right:10px;bottom:10px;max-width:none;}#pma-bone-buttons{grid-template-columns:repeat(3,minmax(0,1fr));}}";
    document.head.appendChild(style);

    var wrap = document.getElementById("pma-bone-buttons");
    BONE_LABELS.forEach(function (pair) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[0];
      btn.setAttribute("data-bone", pair[1]);
      btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); selectBoneByName(pair[1]); });
      wrap.appendChild(btn);
    });
    syncBoneButtons();
    return hud;
  }

  function syncBoneButtons() {
    var buttons = document.querySelectorAll("#pma-bone-buttons button");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].classList.toggle("active", buttons[i].getAttribute("data-bone") === selectedBoneName);
    }
  }

  function setHud(text) {
    ensureHud();
    var el = document.getElementById("pma-keyboard-target");
    if (el && text !== lastHint) { el.textContent = text; lastHint = text; }
  }

  function tick() {
    RUNS_LEFT -= 1;
    var vm = findMainVm();
    if (vm) {
      lastVM = vm;
      try {
        var model = selectFirstModel(vm);
        fixMaterials(vm);
        selectedBone = findBone(vm, selectedBoneName);
        if (model) {
          var controllers = model.boneControllers ? model.boneControllers.length : 0;
          var bones = getAllBones(vm);
          if (controllers > 0) setHud("Controllers ready: " + controllers + " · Bone: " + shortBoneName(selectedBone && selectedBone.name));
          else if (bones.length) setHud("Bone mode ready: " + bones.length + " bones · " + shortBoneName(selectedBone && selectedBone.name));
          else setHud("No rig/controllers detected on this FBX");
          if (bones.length && !window.__pmaBonesLoggedV3) {
            console.info("Anime Base bones found:", bones.map(function (b) { return b.name; }).slice(0, 160));
            window.__pmaBonesLoggedV3 = true;
          }
        }
      } catch (e) {
        console.warn("Anime base v3 fixer error:", e);
      }
    } else {
      ensureHud();
    }
    if (RUNS_LEFT <= 0 && window.__animeBaseFixV3Interval) window.clearInterval(window.__animeBaseFixV3Interval);
  }

  document.addEventListener("keydown", moveOrRotateByKeyboard, true);
  window.__animeBaseFixV3Interval = window.setInterval(tick, 300);
  window.addEventListener("load", function () { setTimeout(tick, 500); setTimeout(tick, 1500); setTimeout(tick, 3500); });
})();
