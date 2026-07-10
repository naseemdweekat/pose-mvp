(function () {
  'use strict';

  // V7 NO-UI engine patch.
  // Purpose: keep /app/ interface 100% as-is, while only fixing the model engine:
  // - visible anime base color
  // - keyboard bone control
  // - 3 spine targets: Spine 1 / Spine 2 / Spine 3
  // This script does NOT create buttons, panels, links, styles, or any visible UI.

  var VERSION = 'anime-base-engine-no-ui-v7-20260706';
  var SKIN = 0xf2b48f;
  var selectedIndex = 0;
  var restRotations = {};
  var bootLogPrinted = false;

  var boneTargets = [
    ['Head', 'head'],
    ['Neck', 'neck'],
    ['Spine 1', 'spine'],
    ['Spine 2', 'spine1'],
    ['Spine 3', 'spine2'],
    ['Hips', 'hips'],
    ['Left Arm', 'leftarm'],
    ['Left Elbow', 'leftforearm'],
    ['Left Hand', 'lefthand'],
    ['Right Arm', 'rightarm'],
    ['Right Elbow', 'rightforearm'],
    ['Right Hand', 'righthand'],
    ['Left Thigh', 'leftupleg'],
    ['Left Knee', 'leftleg'],
    ['Left Foot', 'leftfoot'],
    ['Right Thigh', 'rightupleg'],
    ['Right Knee', 'rightleg'],
    ['Right Foot', 'rightfoot']
  ];

  var state = {
    vm: null,
    scene: null,
    models: [],
    meshes: [],
    skinned: [],
    bones: [],
    three: null,
    selectedBone: null,
    coloredCount: 0
  };

  function log() {
    try { console.log.apply(console, ['[PMA No-UI Engine]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function removePreviousInjectedUI() {
    // Remove ONLY helper UI from earlier diagnostic/patch attempts. Do not touch original app UI.
    try {
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
    } catch (e) {}
  }

  function isInput(el) {
    var t = (el && el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || (el && el.isContentEditable);
  }

  function normName(s) {
    return String(s || '').toLowerCase().replace(/mixamorig|[^a-z0-9]/g, '');
  }

  function exposeWebpackRequire() {
    if (window.__pmaWebpackRequire) return window.__pmaWebpackRequire;
    try {
      var id = '__pma_expose_require_' + Date.now();
      window.webpackJsonp = window.webpackJsonp || [];
      window.webpackJsonp.push([[id], {
        __pmaExposeRequire: function (module, exports, req) { window.__pmaWebpackRequire = req; }
      }, [['__pmaExposeRequire']]]);
    } catch (e) {}
    return window.__pmaWebpackRequire;
  }

  function getThree() {
    if (state.three) return state.three;
    var req = exposeWebpackRequire();
    if (!req) return null;
    try {
      var three = req('5a89');
      if (three && three.W) {
        state.three = three;
        return three;
      }
    } catch (e) {}
    return null;
  }

  function findMainVm() {
    var app = document.querySelector('#app');
    var root = app && app.__vue__;
    if (!root) return null;
    var stack = [root];
    while (stack.length) {
      var vm = stack.shift();
      if (vm && vm.scene && vm.renderer) return vm;
      if (vm && vm.sceneManager && vm.scene) return vm;
      if (vm && vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children);
    }
    return null;
  }

  function getModels(vm) {
    if (!vm) return [];
    if (vm.sceneManager && vm.sceneManager.models) return vm.sceneManager.models || [];
    if (vm.models) return vm.models || [];
    return [];
  }

  function traverseRoot(root, fn) {
    try {
      if (!root) return;
      if (root.traverse) root.traverse(fn);
      else fn(root);
    } catch (e) {}
  }

  function rememberRestRotation(b) {
    if (!b || !b.rotation) return;
    var key = b.uuid || b.name;
    if (key && !restRotations[key]) {
      restRotations[key] = { x: b.rotation.x || 0, y: b.rotation.y || 0, z: b.rotation.z || 0 };
    }
  }

  function collectScene() {
    removePreviousInjectedUI();
    state.vm = findMainVm() || state.vm;
    state.scene = state.vm && state.vm.scene;
    state.models = getModels(state.vm);
    state.meshes = [];
    state.skinned = [];
    state.bones = [];

    function addBone(b) {
      if (!b) return;
      if (state.bones.indexOf(b) < 0) state.bones.push(b);
      rememberRestRotation(b);
    }

    function scan(obj) {
      if (!obj) return;
      if (obj.isMesh || obj.isSkinnedMesh || obj.material) {
        if (state.meshes.indexOf(obj) < 0) state.meshes.push(obj);
        if (obj.isSkinnedMesh && state.skinned.indexOf(obj) < 0) state.skinned.push(obj);
      }
      if (obj.isBone || obj.type === 'Bone') addBone(obj);
      if (obj.isSkinnedMesh && obj.skeleton && obj.skeleton.bones) obj.skeleton.bones.forEach(addBone);
    }

    state.models.forEach(function (m) {
      traverseRoot(m.mesh, scan);
      traverseRoot(m.hipsController, scan);
      if (m.boneControllers && m.boneControllers.length) m.boneControllers.forEach(function (c) { traverseRoot(c, scan); });
    });
    traverseRoot(state.scene, scan);
    return !!state.scene;
  }

  function isSceneHelper(obj) {
    var n = normName(obj && obj.name);
    if (!obj) return true;
    if (obj.isLine || obj.isLineSegments || obj.isHelper) return true;
    if (n.indexOf('grid') >= 0 || n.indexOf('ground') >= 0 || n.indexOf('floor') >= 0) return true;
    if (n.indexOf('transform') >= 0) return true;
    if (n.indexOf('controller') >= 0 || n.indexOf('bonecontroller') >= 0) return true;
    return false;
  }

  function forceMaterialProps(mat, obj) {
    if (!mat) return;
    try { if (mat.color && mat.color.setHex) mat.color.setHex(SKIN); } catch (e) {}
    try { if (mat.emissive && mat.emissive.setHex) mat.emissive.setHex(SKIN); } catch (e) {}
    try { if ('emissiveIntensity' in mat) mat.emissiveIntensity = 0.65; } catch (e) {}
    try { if ('metalness' in mat) mat.metalness = 0; } catch (e) {}
    try { if ('roughness' in mat) mat.roughness = 0.85; } catch (e) {}
    ['map','aoMap','lightMap','alphaMap','emissiveMap','specularMap','metalnessMap','roughnessMap','envMap','bumpMap','normalMap','displacementMap'].forEach(function (k) {
      try { if (k in mat) mat[k] = null; } catch (e) {}
    });
    try { if ('skinning' in mat) mat.skinning = !!(obj && obj.isSkinnedMesh); } catch (e) {}
    try { if ('vertexColors' in mat) mat.vertexColors = false; } catch (e) {}
    try { if ('toneMapped' in mat) mat.toneMapped = false; } catch (e) {}
    try { mat.transparent = false; mat.opacity = 1; mat.side = 2; mat.depthWrite = true; mat.depthTest = true; mat.needsUpdate = true; } catch (e) {}
  }

  function applyAnimeColor() {
    var three = getThree();
    var MeshBasicMaterial = three && three.W;
    var count = 0;

    state.meshes.forEach(function (mesh) {
      if (!mesh || isSceneHelper(mesh)) return;
      var lower = normName(mesh.name);
      var likelyModel = mesh.isSkinnedMesh || lower.indexOf('anime') >= 0 || lower.indexOf('male') >= 0 || state.skinned.indexOf(mesh) >= 0;
      if (!likelyModel) return;
      try {
        mesh.visible = true;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        if (mesh.geometry) {
          try { if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals(); } catch (e) {}
          try { if (mesh.geometry.attributes && mesh.geometry.attributes.normal) mesh.geometry.attributes.normal.needsUpdate = true; } catch (e) {}
        }
        if (MeshBasicMaterial) {
          if (!mesh.__pmaNoUiEngineMaterial) {
            var mat = new MeshBasicMaterial({ color: SKIN, skinning: !!mesh.isSkinnedMesh, wireframe: false });
            forceMaterialProps(mat, mesh);
            mat.name = 'PMA_NoUI_AnimeSkin_Unlit';
            mesh.material = mat;
            mesh.__pmaNoUiEngineMaterial = true;
          } else {
            forceMaterialProps(mesh.material, mesh);
          }
        } else {
          var list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          list.forEach(function (mat) { forceMaterialProps(mat, mesh); });
        }
        count += 1;
      } catch (e) {}
    });
    state.coloredCount = count;
    return count;
  }

  function findBone(target) {
    if (!state.bones.length) collectScene();
    var wanted = normName(target);
    var exact = null;
    for (var i = 0; i < state.bones.length; i += 1) {
      if (normName(state.bones[i].name) === wanted) { exact = state.bones[i]; break; }
    }
    if (exact) return exact;
    for (var j = 0; j < state.bones.length; j += 1) {
      var n = normName(state.bones[j].name);
      if (n === wanted || n.indexOf(wanted) >= 0) return state.bones[j];
    }
    return null;
  }

  function selectedTarget() {
    var item = boneTargets[selectedIndex] || boneTargets[0];
    var bone = findBone(item[1]);
    state.selectedBone = bone;
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
    try { if (bone) bone.updateMatrixWorld(true); } catch (e) {}
    try { if (bone && bone.parent) bone.parent.updateMatrixWorld(true); } catch (e) {}
    state.skinned.forEach(function (m) {
      try { if (m.skeleton && m.skeleton.update) m.skeleton.update(); } catch (e) {}
      try { m.updateMatrixWorld(true); } catch (e) {}
    });
    try { if (state.scene && state.scene.updateMatrixWorld) state.scene.updateMatrixWorld(true); } catch (e) {}
  }

  function rotateSelected(axis, delta) {
    var bone = selectedTarget();
    if (!bone || !bone.rotation) {
      log('selected bone not found', boneTargets[selectedIndex] && boneTargets[selectedIndex][0]);
      return;
    }
    try {
      bone.rotation[axis] += delta;
      updateAfterBoneMove(bone);
    } catch (e) { log('bone rotation failed', e); }
  }

  function resetPose() {
    collectScene();
    state.bones.forEach(function (b) {
      if (!b || !b.rotation) return;
      var key = b.uuid || b.name;
      var r = restRotations[key];
      if (!r) return;
      try { b.rotation.set(r.x, r.y, r.z); b.updateMatrixWorld(true); } catch (e) {}
    });
    state.skinned.forEach(function (m) { try { if (m.skeleton && m.skeleton.update) m.skeleton.update(); } catch (e) {} });
    log('pose reset');
  }

  function onKeyDown(e) {
    if (isInput(document.activeElement) || isInput(e.target)) return;
    var key = String(e.key || '').toLowerCase();
    var step = e.altKey ? 0.025 : (e.shiftKey ? 0.16 : 0.07);
    var handled = true;

    // Main numeric controls.
    // 1 Head, 2 Neck, 3 Spine 1, 4 Spine 2, 5 Spine 3, 0 Hips.
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

  function tick() {
    try {
      removePreviousInjectedUI();
      collectScene();
      applyAnimeColor();
      if (!bootLogPrinted && state.scene) {
        bootLogPrinted = true;
        log('ready', VERSION, '| meshes:', state.meshes.length, '| skinned:', state.skinned.length, '| bones:', state.bones.length, '| UI untouched');
        log('keyboard: 1 Head, 2 Neck, 3/4/5 Spine, 0 Hips, [ ] cycle, WASD/Arrows rotate, Q/E twist, Shift fast, Alt fine, Esc reset');
      }
    } catch (e) { log('tick failed', e); }
  }

  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('DOMContentLoaded', function () {
    removePreviousInjectedUI();
    setTimeout(tick, 500);
    setTimeout(tick, 1500);
    setTimeout(tick, 3500);
  });
  var fast = setInterval(tick, 800);
  setTimeout(function () {
    clearInterval(fast);
    setInterval(tick, 3500);
  }, 25000);

  window.__PMA_NoUI_AnimeBaseEngine = {
    version: VERSION,
    collectScene: collectScene,
    applyAnimeColor: applyAnimeColor,
    resetPose: resetPose,
    selectIndex: selectIndex,
    rotateSelected: rotateSelected,
    state: state,
    boneTargets: boneTargets
  };
})();
