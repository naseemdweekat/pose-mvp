
(function () {
  'use strict';

  var VERSION = 'add-human-native-button-v1-20260710';

  function log() {
    try { console.log.apply(console, ['[PMA Human Native Button]'].concat([].slice.call(arguments))); } catch (e) {}
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

  function findMainVm() {
    var roots = findVueRootsFromDom();
    var seen = [];
    var stack = roots.slice();
    var best = null;
    var bestScore = -1;

    while (stack.length) {
      var vm = stack.shift();
      if (!vm || seen.indexOf(vm) >= 0) continue;
      seen.push(vm);

      var score = 0;
      try { if (typeof vm.loadHumanNativeFromInput === 'function') score += 100; } catch (e) {}
      try { if (vm.scene) score += 20; } catch (e) {}
      try { if (vm.sceneManager) score += 10; } catch (e) {}
      try { if (vm.renderer) score += 10; } catch (e) {}

      if (score > bestScore) {
        best = vm;
        bestScore = score;
      }

      try { if (vm.$children) stack.push.apply(stack, vm.$children); } catch (e) {}
      try { if (vm.$parent && seen.indexOf(vm.$parent) < 0) stack.push(vm.$parent); } catch (e) {}
    }

    return best;
  }

  function installButton() {
    if (document.getElementById('pma-human-native-btn')) return;

    var host = document.querySelector('.top_menu_left_side') || document.querySelector('.topMenu') || document.body;

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fbx';
    input.id = 'pma-human-native-input';
    input.style.display = 'none';

    var btn = document.createElement('button');
    btn.id = 'pma-human-native-btn';
    btn.type = 'button';
    btn.title = 'Add Human Model FBX - Native PMA controller system';
    btn.textContent = 'Human FBX';
    btn.style.height = '34px';
    btn.style.margin = '0 4px';
    btn.style.padding = '0 10px';
    btn.style.border = '0';
    btn.style.borderRadius = '6px';
    btn.style.background = 'rgba(255,255,255,0.20)';
    btn.style.color = '#fff';
    btn.style.font = 'bold 12px Arial, sans-serif';
    btn.style.cursor = 'pointer';
    btn.style.verticalAlign = 'top';
    btn.style.pointerEvents = 'auto';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      input.click();
    });

    input.addEventListener('change', function () {
      var vm = findMainVm();

      if (!vm || typeof vm.loadHumanNativeFromInput !== 'function') {
        alert('Human Native loader is not ready. Refresh and try again.');
        return;
      }

      vm.loadHumanNativeFromInput({ target: input });
    });

    host.appendChild(btn);
    document.body.appendChild(input);

    log('installed', VERSION);
  }

  function boot() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      installButton();
      if (document.getElementById('pma-human-native-btn') || tries > 20) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PMAHumanNativeButton = {
    version: VERSION,
    reinstall: installButton
  };
})();
