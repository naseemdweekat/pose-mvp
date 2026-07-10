(function(){
  'use strict';
  var VERSION = 'anime-base-main-unlit-keyboard-v5-20260705';
  var SKIN = 0xf2b48f;
  var CLAY = 0xd9d2c6;
  var WHITE = 0xffffff;
  var selectedIndex = 0;
  var boneTargets = [
    ['Head','head'],
    ['Neck','neck'],
    ['Chest','spine2'],
    ['Spine','spine1'],
    ['Hips','hips'],
    ['L Arm','leftarm'],
    ['L Elbow','leftforearm'],
    ['L Hand','lefthand'],
    ['R Arm','rightarm'],
    ['R Elbow','rightforearm'],
    ['R Hand','righthand'],
    ['L Thigh','leftupleg'],
    ['L Knee','leftleg'],
    ['L Foot','leftfoot'],
    ['R Thigh','rightupleg'],
    ['R Knee','rightleg'],
    ['R Foot','rightfoot']
  ];
  var state = { vm:null, scene:null, skinned:[], bones:[], three:null, materialMode:'skin', lastStatus:'Starting…', lastKey:'none' };

  function log(){ try{ console.log.apply(console, ['[AnimeBaseV5]'].concat([].slice.call(arguments))); }catch(e){} }
  function normName(s){ return String(s||'').toLowerCase().replace(/mixamorig|[^a-z0-9]/g,''); }
  function isInput(el){ var t=(el&&el.tagName||'').toLowerCase(); return t==='input'||t==='textarea'||t==='select'||(el&&el.isContentEditable); }

  function exposeWebpackRequire(){
    if (window.__pmaWebpackRequire) return window.__pmaWebpackRequire;
    try {
      var id = '__pma_expose_require_' + Date.now();
      window.webpackJsonp = window.webpackJsonp || [];
      window.webpackJsonp.push([[id], {
        __pmaExposeRequire: function(module, exports, req){ window.__pmaWebpackRequire = req; }
      }, [['__pmaExposeRequire']]]);
    } catch(e){ log('webpack expose failed', e); }
    return window.__pmaWebpackRequire;
  }

  function getThree(){
    if (state.three) return state.three;
    var req = exposeWebpackRequire();
    if (!req) return null;
    try {
      var three = req('5a89');
      // Known in this bundle: W = MeshBasicMaterial, n = Color.
      if (three && three.W) { state.three = three; return three; }
    } catch(e){ log('three module load failed', e); }
    return null;
  }

  function findMainVm(){
    var app = document.querySelector('#app');
    var root = app && app.__vue__;
    if (!root) return null;
    var stack=[root];
    while(stack.length){
      var vm=stack.shift();
      if (vm && vm.scene && vm.renderer) return vm;
      if (vm && vm.sceneManager && vm.scene) return vm;
      if (vm && vm.$children && vm.$children.length) stack.push.apply(stack, vm.$children);
    }
    return null;
  }

  function collectScene(){
    state.vm = findMainVm();
    state.scene = state.vm && state.vm.scene;
    state.skinned = [];
    state.bones = [];
    if (!state.scene || !state.scene.traverse) return false;
    state.scene.traverse(function(obj){
      if (!obj) return;
      if (obj.isSkinnedMesh) {
        state.skinned.push(obj);
        try { if (obj.skeleton && obj.skeleton.bones) state.bones = state.bones.concat(obj.skeleton.bones); } catch(e){}
      }
    });
    // unique bones
    var seen = [];
    state.bones = state.bones.filter(function(b){ if (!b) return false; if (seen.indexOf(b.uuid)>=0) return false; seen.push(b.uuid); return true; });
    if (state.skinned.length) state.lastStatus = 'Ready | skinned: '+state.skinned.length+' | bones: '+state.bones.length;
    else state.lastStatus = 'Waiting for anime_male_base skinned mesh…';
    return !!state.skinned.length;
  }

  function materialColor(){
    if (state.materialMode === 'clay') return CLAY;
    if (state.materialMode === 'white') return WHITE;
    return SKIN;
  }

  function applyUnlitMaterial(){
    var three = getThree();
    if (!three || !three.W) return false;
    var color = materialColor();
    state.skinned.forEach(function(mesh){
      try {
        if (!mesh.__pmaV5BasicMaterial || mesh.__pmaV5Color !== color) {
          var mat = new three.W({ color: color, skinning: true, wireframe: state.materialMode === 'wire' });
          mat.skinning = true;
          mat.side = 2;
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
          mat.depthTest = true;
          mat.toneMapped = false;
          mat.name = 'AnimeBaseV5_Unlit_' + state.materialMode;
          mesh.material = mat;
          mesh.__pmaV5BasicMaterial = true;
          mesh.__pmaV5Color = color;
        } else if (mesh.material) {
          mesh.material.wireframe = state.materialMode === 'wire';
          mesh.material.needsUpdate = true;
        }
        mesh.visible = true;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } catch(e){ log('material apply error', e); }
    });
    return true;
  }

  function findBone(target){
    if (!state.bones.length) collectScene();
    var n = normName(target);
    var exact = state.bones.find(function(b){ return normName(b.name) === n; });
    if (exact) return exact;
    return state.bones.find(function(b){ return normName(b.name).indexOf(n) >= 0; }) || null;
  }

  function selectedBone(){
    var target = boneTargets[selectedIndex] && boneTargets[selectedIndex][1];
    return findBone(target);
  }

  function applyBoneRotation(axis, delta){
    if (!state.bones.length) collectScene();
    var bone = selectedBone();
    if (!bone) { state.lastStatus = 'Bone not found: '+boneTargets[selectedIndex][0]; updatePanel(); return; }
    try {
      bone.rotation[axis] += delta;
      bone.updateMatrixWorld(true);
      if (bone.parent) bone.parent.updateMatrixWorld(true);
      state.skinned.forEach(function(m){ try { if (m.skeleton) { m.skeleton.update && m.skeleton.update(); } m.updateMatrixWorld(true); } catch(e){} });
      state.lastKey = axis.toUpperCase()+' '+(delta>0?'+':'')+delta.toFixed(3);
      state.lastStatus = 'Bone mode ready | '+boneTargets[selectedIndex][0]+' → '+bone.name;
      updatePanel();
    } catch(e){ state.lastStatus = 'Bone rotation failed: '+e.message; updatePanel(); }
  }

  function cycleBone(dir){
    selectedIndex = (selectedIndex + dir + boneTargets.length) % boneTargets.length;
    updatePanel();
  }

  function resetPose(){
    if (!state.bones.length) collectScene();
    state.bones.forEach(function(b){ try { b.rotation.set(0,0,0); b.updateMatrixWorld(true); } catch(e){} });
    state.lastStatus = 'Pose reset';
    updatePanel();
  }

  function buildPanel(){
    if (document.getElementById('animeBaseV5Panel')) return;
    var el = document.createElement('div');
    el.id = 'animeBaseV5Panel';
    el.innerHTML = '<div class="pma-v5-title">Anime Base Controls <span>V5</span></div>'+
      '<div class="pma-v5-status" id="pmaV5Status">Starting…</div>'+
      '<div class="pma-v5-row"><button data-bone="prev">[</button><select id="pmaV5Bone"></select><button data-bone="next">]</button></div>'+
      '<div class="pma-v5-row"><button data-mat="skin">Skin</button><button data-mat="clay">Clay</button><button data-mat="white">White</button><button data-mat="wire">Wire</button></div>'+
      '<div class="pma-v5-row"><button data-action="reset">Reset Pose</button><button data-action="refresh">Refresh</button></div>'+
      '<div class="pma-v5-help">1-0 select bones · WASD/Arrows rotate · Q/E twist · Alt slow · Ctrl fast</div>';
    var css = document.createElement('style');
    css.textContent = '#animeBaseV5Panel{position:fixed;right:14px;bottom:14px;z-index:999999;width:310px;background:rgba(17,24,39,.92);color:#e5e7eb;border:1px solid rgba(148,163,184,.35);border-radius:14px;padding:12px;font:12px/1.35 system-ui,-apple-system,Segoe UI,Arial;box-shadow:0 18px 44px rgba(0,0,0,.35);backdrop-filter:blur(12px)}#animeBaseV5Panel .pma-v5-title{font-weight:800;font-size:13px;margin-bottom:8px}#animeBaseV5Panel .pma-v5-title span{background:#7c3aed;color:#fff;border-radius:999px;padding:1px 7px;margin-left:6px}#animeBaseV5Panel .pma-v5-status{background:#0b1220;border:1px solid rgba(148,163,184,.18);border-radius:9px;padding:7px 8px;margin-bottom:8px;color:#cbd5e1;min-height:30px}#animeBaseV5Panel .pma-v5-row{display:flex;gap:6px;margin:7px 0}#animeBaseV5Panel button,#animeBaseV5Panel select{background:#1f2937;color:#f8fafc;border:1px solid rgba(148,163,184,.28);border-radius:8px;padding:7px 8px;font-weight:700;font-size:12px}#animeBaseV5Panel button{cursor:pointer;flex:1}#animeBaseV5Panel button:hover{background:#334155}#animeBaseV5Panel select{flex:3;min-width:0}#animeBaseV5Panel .pma-v5-help{color:#94a3b8;font-size:11px;margin-top:7px}';
    document.head.appendChild(css);
    document.body.appendChild(el);
    var select = document.getElementById('pmaV5Bone');
    boneTargets.forEach(function(b,i){ var o=document.createElement('option'); o.value=i; o.textContent=(i+1)+'. '+b[0]; select.appendChild(o); });
    select.addEventListener('change', function(){ selectedIndex = +select.value || 0; updatePanel(); });
    el.addEventListener('click', function(e){
      var t=e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.bone==='prev') cycleBone(-1);
      if (t.dataset.bone==='next') cycleBone(1);
      if (t.dataset.mat) { state.materialMode=t.dataset.mat; applyUnlitMaterial(); updatePanel(); }
      if (t.dataset.action==='reset') resetPose();
      if (t.dataset.action==='refresh') { collectScene(); applyUnlitMaterial(); updatePanel(); }
    });
  }

  function updatePanel(){
    buildPanel();
    var select = document.getElementById('pmaV5Bone');
    if (select && String(select.value)!==String(selectedIndex)) select.value = String(selectedIndex);
    var bone = selectedBone();
    var status = document.getElementById('pmaV5Status');
    if (status) {
      var btxt = bone ? ('<br>Selected: '+boneTargets[selectedIndex][0]+' / '+bone.name) : '<br>Selected: not found';
      status.innerHTML = state.lastStatus + btxt + '<br>Material: '+state.materialMode+' | Last key: '+state.lastKey;
    }
  }

  function onKey(e){
    if (isInput(document.activeElement)) return;
    var key = (e.key || '').toLowerCase();
    var step = e.altKey ? 0.025 : (e.ctrlKey || e.metaKey ? 0.18 : 0.075);
    var handled = true;
    if (/^[0-9]$/.test(key)) { selectedIndex = key === '0' ? 9 : (+key - 1); updatePanel(); }
    else if (key === '[') cycleBone(-1);
    else if (key === ']') cycleBone(1);
    else if (key === 'w' || key === 'arrowup') applyBoneRotation('x', step);
    else if (key === 's' || key === 'arrowdown') applyBoneRotation('x', -step);
    else if (key === 'a' || key === 'arrowleft') applyBoneRotation('y', step);
    else if (key === 'd' || key === 'arrowright') applyBoneRotation('y', -step);
    else if (key === 'q') applyBoneRotation('z', step);
    else if (key === 'e') applyBoneRotation('z', -step);
    else handled = false;
    if (handled) { try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }catch(_e){} }
  }

  function tick(){
    try {
      collectScene();
      applyUnlitMaterial();
      updatePanel();
    } catch(e){ log('tick error', e); }
  }

  window.addEventListener('keydown', onKey, true);
  document.addEventListener('DOMContentLoaded', function(){ buildPanel(); updatePanel(); });
  var boot = setInterval(tick, 900);
  setTimeout(function(){ clearInterval(boot); setInterval(tick, 3000); }, 30000);
  window.__AnimeBaseV5 = { collectScene:collectScene, applyUnlitMaterial:applyUnlitMaterial, resetPose:resetPose, state:state, version:VERSION };
  log('loaded', VERSION);
})();
