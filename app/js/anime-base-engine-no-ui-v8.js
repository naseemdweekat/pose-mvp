(function () {
  'use strict';

  // V8: NO UI REBUILD.
  // Keeps the original /app/ interface intact and only patches the internal model engine:
  // - finds Vue root correctly after #app is replaced
  // - colors the anime male base instead of black silhouette
  // - keyboard bone rotation works on the loaded model
  // - adds material presets inside the EXISTING color menu only

  var VERSION = 'anime-base-engine-no-ui-v8-20260706';
  var DEFAULT_COLOR = '#f2b48f';
  var selectedIndex = 0;
  var restRotations = {};
  var bootLogged = false;
  var patchedVm = null;
  var currentStyle = 'skin';
  var currentColor = DEFAULT_COLOR;

  var boneTargets = [
    ['Head', ['Head']],
    ['Neck', ['Neck']],
    ['Spine 1', ['Spine']],
    ['Spine 2', ['Spine1']],
    ['Spine 3', ['Spine2']],
    ['Hips', ['Hips', 'Pelvis']],
    ['Left Arm', ['LeftArm', 'LeftShoulder']],
    ['Left Elbow', ['LeftForeArm']],
    ['Left Hand', ['LeftHand']],
    ['Right Arm', ['RightArm', 'RightShoulder']],
    ['Right Elbow', ['RightForeArm']],
    ['Right Hand', ['RightHand']],
    ['Left Thigh', ['LeftUpLeg']],
    ['Left Knee', ['LeftLeg']],
    ['Left Foot', ['LeftFoot']],
    ['Right Thigh', ['RightUpLeg']],
    ['Right Knee', ['RightLeg']],
    ['Right Foot', ['RightFoot']]
  ];

  var state = {
    vm: null,
    scene: null,
    models: [],
    modelMeshes: [],
    skinned: [],
    bones: [],
    activeModel: null,
    coloredCount: 0,
    selectedBone: null
  };

  function log() {
    try { console.log.apply(console, ['[PMA Engine V8]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function isInput(el) {
    var t = (el && el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || (el && el.isContentEditable);
  }

  function normName(s) {
    return String(s || '').toLowerCase().replace(/mixamorig|[^a-z0-9]/g, '');
  }

  function removeOldPatchUi() {
    // Remove only UI from previous diagnostic/custom attempts; never touch PoseMyArt UI.
    var ids = [
      'pma-keyboard-fix-hud',
      'animeBaseV5Panel',
      'pma-anime-base-status',
      'pma-anime-base-panel',
      'pma-diag-link'
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
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
    try { if (vm.sceneManager) s += 20; } catch (e) {}
    try { if (vm.scene) s += 15; } catch (e) {}
    try { if (vm.renderer) s += 15; } catch (e) {}
    try { if (Array.isArray(vm.models) && vm.models.length) s += 12; } catch (e) {}
    try { if (vm.selectedModel) s += 8; } catch (e) {}
    try { if (typeof vm.changeModelColor === 'function') s += 8; } catch (e) {}
    try { if (typeof vm.commitModelChanges === 'function') s += 5; } catch (e) {}
    return s;
  }

  function findMainVm() {
    var roots = findVueRootsFromDom();
    var stack = roots.slice();
    var best = null;
    var bestScore = 0;
    while (stack.length) {
      var vm = stack.shift();
      var score = vmScore(vm);
      if (score > bestScore) {
        best = vm;
        bestScore = score;
      }
      try {
        if (vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children);
      } catch (e) {}
    }
    return best || state.vm || null;
  }

  function arrayUnique(arr) {
    var out = [];
    arr.forEach(function (x) { if (x && out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  function looksLikeModel(m) {
    return !!(m && (m.mesh || (m.skinnedMeshes && m.skinnedMeshes.length) || m.isModel));
  }

  function getModels(vm) {
    var list = [];
    try { if (vm && vm.selectedModel && looksLikeModel(vm.selectedModel)) list.push(vm.selectedModel); } catch (e) {}
    try { if (vm && Array.isArray(vm.models)) list = list.concat(vm.models); } catch (e) {}
    try { if (vm && vm.sceneManager && Array.isArray(vm.sceneManager.models)) list = list.concat(vm.sceneManager.models); } catch (e) {}

    // Fallback: scan all Vue components for a models array. This is important because #app is replaced by Vue.
    var roots = findVueRootsFromDom();
    var stack = roots.slice();
    while (stack.length) {
      var comp = stack.shift();
      try { if (Array.isArray(comp.models)) list = list.concat(comp.models); } catch (e) {}
      try { if (comp.sceneManager && Array.isArray(comp.sceneManager.models)) list = list.concat(comp.sceneManager.models); } catch (e) {}
      try { if (comp.selectedModel && looksLikeModel(comp.selectedModel)) list.push(comp.selectedModel); } catch (e) {}
      try { if (comp.$children && comp.$children.length) stack.push.apply(stack, comp.$children); } catch (e) {}
    }
    return arrayUnique(list).filter(looksLikeModel);
  }

  function traverseRoot(root, fn) {
    if (!root) return;
    try {
      if (root.traverse) root.traverse(fn);
      else fn(root);
    } catch (e) {}
  }

  function isControllerOrHelper(obj) {
    if (!obj) return true;
    var n = normName(obj.name);
    if (obj.isLine || obj.isLineSegments || obj.isHelper) return true;
    if (n.indexOf('bonecontroller') >= 0 || n.indexOf('controller') >= 0) return true;
    if (n.indexOf('transform') >= 0 || n.indexOf('grid') >= 0 || n.indexOf('ground') >= 0 || n.indexOf('floor') >= 0) return true;
    return false;
  }

  function rememberRestRotation(bone) {
    try {
      var key = bone.uuid || bone.name;
      if (key && bone.rotation && !restRotations[key]) {
        restRotations[key] = { x: bone.rotation.x || 0, y: bone.rotation.y || 0, z: bone.rotation.z || 0 };
      }
    } catch (e) {}
  }

  function collectScene() {
    removeOldPatchUi();
    state.vm = findMainVm() || state.vm;
    state.scene = (state.vm && state.vm.scene) || state.scene;
    state.models = getModels(state.vm);
    state.activeModel = getActiveModel();
    state.modelMeshes = [];
    state.skinned = [];
    state.bones = [];

    function addBone(b) {
      if (!b) return;
      if (state.bones.indexOf(b) < 0) state.bones.push(b);
      rememberRestRotation(b);
    }

    function scanModelObject(obj) {
      if (!obj) return;
      if ((obj.isMesh || obj.isSkinnedMesh || obj.material) && !isControllerOrHelper(obj)) {
        if (state.modelMeshes.indexOf(obj) < 0) state.modelMeshes.push(obj);
      }
      if (obj.isSkinnedMesh) {
        if (state.skinned.indexOf(obj) < 0) state.skinned.push(obj);
        try { if (obj.skeleton && obj.skeleton.bones) obj.skeleton.bones.forEach(addBone); } catch (e) {}
      }
      if (obj.isBone || obj.type === 'Bone') addBone(obj);
    }

    state.models.forEach(function (m) {
      try { if (Array.isArray(m.skinnedMeshes)) m.skinnedMeshes.forEach(function (s) { if (state.skinned.indexOf(s) < 0) state.skinned.push(s); }); } catch (e) {}
      traverseRoot(m.mesh, scanModelObject);
      try { if (Array.isArray(m.skinnedMeshes)) m.skinnedMeshes.forEach(function (s) { traverseRoot(s, scanModelObject); }); } catch (e) {}
      try { if (m.hipsController) traverseRoot(m.hipsController, scanModelObject); } catch (e) {}
      // Don't treat bone controllers as colored model meshes, but do scan their parents for bones when possible.
      try {
        if (Array.isArray(m.boneControllers)) {
          m.boneControllers.forEach(function (c) {
            if (c && c.parent && (c.parent.isBone || c.parent.type === 'Bone')) addBone(c.parent);
            try { if (c.targetBone) addBone(c.targetBone); } catch (e) {}
            try { if (c.effectorBone) addBone(c.effectorBone); } catch (e) {}
          });
        }
      } catch (e) {}
    });

    // Fallback: if model arrays are not available yet, scan scene for skinned meshes only.
    if (!state.modelMeshes.length && state.scene) {
      traverseRoot(state.scene, function (obj) {
        if (obj && obj.isSkinnedMesh && !isControllerOrHelper(obj)) scanModelObject(obj);
      });
    }
    return !!(state.vm || state.scene || state.models.length);
  }

  function getActiveModel() {
    var vm = state.vm || findMainVm();
    try { if (vm && vm.selectedModel && looksLikeModel(vm.selectedModel)) return vm.selectedModel; } catch (e) {}
    var models = state.models && state.models.length ? state.models : getModels(vm);
    for (var i = 0; i < models.length; i += 1) {
      if (models[i] && models[i].isModel && !models[i].isDeleted) return models[i];
    }
    return models[0] || null;
  }

  function normalizeColor(input) {
    if (!input) return currentColor || DEFAULT_COLOR;
    if (typeof input === 'string') return input.charAt(0) === '#' ? input : ('#' + input);
    if (input.hex) return input.hex;
    if (input.hexa) return input.hexa;
    if (typeof input.r === 'number') {
      var r = Math.max(0, Math.min(255, Math.round(input.r))).toString(16).padStart(2, '0');
      var g = Math.max(0, Math.min(255, Math.round(input.g))).toString(16).padStart(2, '0');
      var b = Math.max(0, Math.min(255, Math.round(input.b))).toString(16).padStart(2, '0');
      return '#' + r + g + b;
    }
    return currentColor || DEFAULT_COLOR;
  }

  function hexToNumber(hex) {
    hex = normalizeColor(hex).replace('#', '').slice(0, 6);
    return parseInt(hex || 'f2b48f', 16);
  }

  function cloneOrCreateMaterial(mesh) {
    var mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mesh.__pmaV8OriginalMaterial) {
      try { mesh.__pmaV8OriginalMaterial = Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material; } catch (e) {}
    }
    if (!mat) return null;
    try {
      if (!mesh.__pmaV8Material || mesh.__pmaV8MaterialStyle !== currentStyle) {
        if (typeof mat.clone === 'function') mat = mat.clone();
        mesh.__pmaV8Material = mat;
        mesh.__pmaV8MaterialStyle = currentStyle;
        mesh.material = mat;
      } else {
        mat = mesh.__pmaV8Material;
        mesh.material = mat;
      }
    } catch (e) {}
    return mat;
  }

  function applyMaterialToMesh(mesh, style, color) {
    if (!mesh || isControllerOrHelper(mesh)) return false;
    var mat = cloneOrCreateMaterial(mesh);
    if (!mat) return false;
    var n = hexToNumber(color);
    try { mesh.visible = true; mesh.frustumCulled = false; } catch (e) {}
    try { if (mesh.geometry && mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals(); } catch (e) {}

    if (style === 'restore') {
      try { if (mesh.__pmaV8OriginalMaterial) mesh.material = mesh.__pmaV8OriginalMaterial; } catch (e) {}
      return true;
    }

    try { if (mat.color && mat.color.set) mat.color.set(color); else if (mat.color && mat.color.setHex) mat.color.setHex(n); } catch (e) {}
    try { if (mat.emissive && mat.emissive.set) mat.emissive.set(color); else if (mat.emissive && mat.emissive.setHex) mat.emissive.setHex(n); } catch (e) {}
    try { if ('emissiveIntensity' in mat) mat.emissiveIntensity = style === 'clay' ? 0.35 : 0.9; } catch (e) {}
    try { if ('metalness' in mat) mat.metalness = 0; } catch (e) {}
    try { if ('roughness' in mat) mat.roughness = style === 'clay' ? 0.95 : 0.75; } catch (e) {}
    try { if ('skinning' in mat) mat.skinning = !!mesh.isSkinnedMesh; } catch (e) {}
    try { if ('vertexColors' in mat) mat.vertexColors = false; } catch (e) {}
    try { if ('toneMapped' in mat) mat.toneMapped = false; } catch (e) {}
    try { mat.transparent = false; mat.opacity = 1; mat.side = 2; mat.depthTest = true; mat.depthWrite = true; } catch (e) {}
    try { mat.wireframe = style === 'wireframe'; } catch (e) {}

    // Remove maps that can keep the model black in recovered/offline builds.
    if (style !== 'restore') {
      ['map','aoMap','lightMap','alphaMap','emissiveMap','specularMap','metalnessMap','roughnessMap','envMap','bumpMap','normalMap','displacementMap'].forEach(function (k) {
        try { if (k in mat) mat[k] = null; } catch (e) {}
      });
    }
    try { mat.needsUpdate = true; } catch (e) {}
    return true;
  }

  function applyModelStyle(style, color, model) {
    currentStyle = style || currentStyle || 'skin';
    currentColor = normalizeColor(color || currentColor || DEFAULT_COLOR);

    collectScene();
    model = model || getActiveModel();
    var meshes = [];
    if (model) {
      try { traverseRoot(model.mesh, function (obj) { if ((obj.isMesh || obj.isSkinnedMesh || obj.material) && !isControllerOrHelper(obj)) meshes.push(obj); }); } catch (e) {}
      try { if (Array.isArray(model.skinnedMeshes)) model.skinnedMeshes.forEach(function (m) { if (meshes.indexOf(m) < 0) meshes.push(m); }); } catch (e) {}
      try { model.color = currentColor; } catch (e) {}
    }
    if (!meshes.length) meshes = state.modelMeshes.slice();

    var count = 0;
    meshes.forEach(function (mesh) { if (applyMaterialToMesh(mesh, currentStyle, currentColor)) count += 1; });
    state.coloredCount = count;

    try {
      if (state.vm && typeof state.vm.commitModelChanges === 'function' && model) state.vm.commitModelChanges(model);
    } catch (e) {}
    try { if (state.scene && state.scene.updateMatrixWorld) state.scene.updateMatrixWorld(true); } catch (e) {}
    return count;
  }

  function patchVmMethods() {
    var vm = findMainVm();
    if (!vm || patchedVm === vm) return;
    patchedVm = vm;
    state.vm = vm;

    try {
      if (typeof vm.changeModelColor === 'function' && !vm.__pmaV8ChangeColorPatched) {
        var original = vm.changeModelColor;
        vm.changeModelColor = function (value) {
          var hex = normalizeColor(value);
          currentStyle = currentStyle === 'wireframe' ? 'wireframe' : 'skin';
          currentColor = hex;
          try { original.call(this, value); } catch (e) {}
          try { applyModelStyle(currentStyle, currentColor, this.selectedModel || getActiveModel()); } catch (e) {}
          setTimeout(function () { try { applyModelStyle(currentStyle, currentColor); } catch (e) {} }, 80);
        };
        vm.__pmaV8ChangeColorPatched = true;
      }
    } catch (e) {}
  }

  function getBones(model) {
    var bones = [];
    function add(b) { if (b && bones.indexOf(b) < 0) { bones.push(b); rememberRestRotation(b); } }
    try { if (model && model.skinnedMeshes) model.skinnedMeshes.forEach(function (s) { if (s.skeleton && s.skeleton.bones) s.skeleton.bones.forEach(add); }); } catch (e) {}
    try { if (model && model.mesh) traverseRoot(model.mesh, function (obj) { if (obj.isBone || obj.type === 'Bone') add(obj); if (obj.isSkinnedMesh && obj.skeleton && obj.skeleton.bones) obj.skeleton.bones.forEach(add); }); } catch (e) {}
    if (!bones.length) bones = state.bones.slice();
    return bones;
  }

  function findBoneByEndsWith(model, suffixes) {
    var bones = getBones(model);
    for (var s = 0; s < suffixes.length; s += 1) {
      var wanted = normName(suffixes[s]);
      for (var i = 0; i < bones.length; i += 1) {
        if (normName(bones[i].name).endsWith(wanted)) return bones[i];
      }
    }
    for (var s2 = 0; s2 < suffixes.length; s2 += 1) {
      var wanted2 = normName(suffixes[s2]);
      for (var j = 0; j < bones.length; j += 1) {
        var n = normName(bones[j].name);
        if (n.indexOf(wanted2) >= 0) return bones[j];
      }
    }
    return null;
  }

  function selectedTarget() {
    collectScene();
    var item = boneTargets[selectedIndex] || boneTargets[0];
    var model = getActiveModel();
    var bone = findBoneByEndsWith(model, item[1]);
    state.selectedBone = bone;
    state.activeModel = model;
    return bone;
  }

  function selectIndex(index) {
    selectedIndex = (index + boneTargets.length) % boneTargets.length;
    var bone = selectedTarget();
    log('selected', boneTargets[selectedIndex][0], bone ? bone.name : '(not found)');
  }

  function cycleBone(dir) {
    selectIndex(selectedIndex + dir);
  }

  function updateAfterBoneMove(bone) {
    var model = state.activeModel || getActiveModel();
    try { if (bone) bone.updateMatrixWorld(true); } catch (e) {}
    try { if (bone && bone.parent) bone.parent.updateMatrixWorld(true); } catch (e) {}
    try {
      if (model && model.skinnedMeshes) {
        model.skinnedMeshes.forEach(function (m) {
          try { if (m.skeleton && m.skeleton.update) m.skeleton.update(); } catch (e) {}
          try { m.updateMatrixWorld(true); } catch (e) {}
        });
      }
    } catch (e) {}
    try { if (model && model.mesh && model.mesh.updateMatrixWorld) model.mesh.updateMatrixWorld(true); } catch (e) {}
    try { if (state.scene && state.scene.updateMatrixWorld) state.scene.updateMatrixWorld(true); } catch (e) {}
    try { if (state.vm && typeof state.vm.commitModelChanges === 'function' && model) state.vm.commitModelChanges(model); } catch (e) {}
  }

  function rotateSelected(axis, delta) {
    var bone = selectedTarget();
    if (!bone || !bone.rotation) {
      log('keyboard: selected bone not found', boneTargets[selectedIndex] && boneTargets[selectedIndex][0]);
      return false;
    }
    try {
      bone.rotation[axis] += delta;
      updateAfterBoneMove(bone);
      return true;
    } catch (e) {
      log('bone rotation failed', e);
      return false;
    }
  }

  function resetPose() {
    collectScene();
    getBones(getActiveModel()).forEach(function (b) {
      if (!b || !b.rotation) return;
      var key = b.uuid || b.name;
      var r = restRotations[key];
      if (!r) return;
      try { b.rotation.set(r.x, r.y, r.z); b.updateMatrixWorld(true); } catch (e) {}
    });
    updateAfterBoneMove(state.selectedBone);
    log('pose reset');
  }

  function onKeyDown(e) {
    if (isInput(document.activeElement) || isInput(e.target)) return;
    var key = String(e.key || '').toLowerCase();
    var step = e.altKey ? 0.025 : (e.shiftKey ? 0.16 : 0.07);
    var handled = true;

    if (/^[0-9]$/.test(key)) {
      var idx = key === '0' ? 5 : (parseInt(key, 10) - 1);
      selectIndex(idx);
    } else if (key === '[' || key === ',') cycleBone(-1);
    else if (key === ']' || key === '.') cycleBone(1);
    else if (key === 'w' || key === 'arrowup') rotateSelected('x', -step);
    else if (key === 's' || key === 'arrowdown') rotateSelected('x', step);
    else if (key === 'a' || key === 'arrowleft') rotateSelected('y', step);
    else if (key === 'd' || key === 'arrowright') rotateSelected('y', -step);
    else if (key === 'q') rotateSelected('z', step);
    else if (key === 'e') rotateSelected('z', -step);
    else if (key === 'escape') resetPose();
    else handled = false;

    if (handled) {
      try { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } catch (_e) {}
    }
  }

  function ensurePresetStyles() {
    if (document.getElementById('pma-v8-style-css')) return;
    var css = document.createElement('style');
    css.id = 'pma-v8-style-css';
    css.textContent = '' +
      '.pma-v8-presets{display:flex;gap:6px;flex-wrap:wrap;padding:10px 10px 0 10px;max-width:330px}' +
      '.pma-v8-chip{border:0;border-radius:14px;padding:6px 10px;font:600 12px system-ui,Arial;cursor:pointer;background:#2b2b2b;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)}' +
      '.pma-v8-chip:hover{filter:brightness(1.18)}' +
      '.pma-v8-chip-swatch{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px;border:1px solid rgba(255,255,255,.55)}';
    document.head.appendChild(css);
  }

  function presetButton(label, style, color) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pma-v8-chip';
    btn.setAttribute('data-pma-style', style);
    var swatch = document.createElement('span');
    swatch.className = 'pma-v8-chip-swatch';
    swatch.style.background = style === 'wireframe' ? '#111' : color;
    btn.appendChild(swatch);
    btn.appendChild(document.createTextNode(label));
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var finalColor = color;
      if (style === 'skin') finalColor = currentColor || color;
      applyModelStyle(style, finalColor);
    }, true);
    return btn;
  }

  function injectColorPresetsIntoOriginalMenu() {
    ensurePresetStyles();
    var cards = document.querySelectorAll('.v-menu__content.menuable__content__active .v-card, .v-menu__content .v-card');
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      if (card.querySelector('.pma-v8-presets')) return;
      // Only use menus that look like the color picker menu.
      if (!card.querySelector('.v-color-picker') && !card.textContent.match(/rgba|hex|hexa/i)) continue;
      var wrap = document.createElement('div');
      wrap.className = 'pma-v8-presets';
      wrap.appendChild(presetButton('Skin', 'skin', '#f2b48f'));
      wrap.appendChild(presetButton('Clay', 'clay', '#beb7ad'));
      wrap.appendChild(presetButton('Gray', 'gray', '#d7d7d7'));
      wrap.appendChild(presetButton('Toon', 'toon', '#ffd2a3'));
      wrap.appendChild(presetButton('Wire', 'wireframe', '#f2b48f'));
      wrap.appendChild(presetButton('Restore', 'restore', '#cccccc'));
      card.insertBefore(wrap, card.firstChild);
      return;
    }
  }

  function hookColorButton() {
    if (document.__pmaV8ColorHooked) return;
    document.__pmaV8ColorHooked = true;
    document.addEventListener('click', function (e) {
      var target = e.target && (e.target.closest ? e.target.closest('#colorMenuButton') : null);
      if (!target) return;
      setTimeout(injectColorPresetsIntoOriginalMenu, 80);
      setTimeout(injectColorPresetsIntoOriginalMenu, 250);
      setTimeout(injectColorPresetsIntoOriginalMenu, 700);
    }, true);
  }

  function tick() {
    try {
      removeOldPatchUi();
      patchVmMethods();
      collectScene();
      hookColorButton();
      // Keep the recovered anime base visible and colored, but do not touch UI.
      var count = applyModelStyle(currentStyle || 'skin', currentColor || DEFAULT_COLOR);
      if (!bootLogged && (state.vm || state.models.length)) {
        bootLogged = true;
        log('ready', VERSION, '| models:', state.models.length, '| meshes:', state.modelMeshes.length, '| bones:', state.bones.length, '| colored:', count);
        log('keyboard: 1 Head, 2 Neck, 3/4/5 Spine, 0 Hips, [ ] cycle, WASD/Arrows rotate, Q/E twist, Shift fast, Alt fine, Esc reset');
      }
    } catch (e) { log('tick failed', e); }
  }

  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('DOMContentLoaded', function () {
    removeOldPatchUi();
    setTimeout(tick, 400);
    setTimeout(tick, 1200);
    setTimeout(tick, 3000);
  });

  var fast = setInterval(tick, 900);
  setTimeout(function () {
    clearInterval(fast);
    setInterval(tick, 4000);
  }, 30000);

  window.__PMA_NoUI_AnimeBaseEngine = window.__PMA_Engine_V8 = {
    version: VERSION,
    collectScene: collectScene,
    applyModelStyle: applyModelStyle,
    resetPose: resetPose,
    selectIndex: selectIndex,
    rotateSelected: rotateSelected,
    state: state,
    boneTargets: boneTargets
  };
})();
