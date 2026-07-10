(function () {
  function addLink() {
    if (document.getElementById('pma-diag-link')) return;
    var a = document.createElement('a');
    a.id = 'pma-diag-link';
    a.href = 'diagnostic.html?v=diag1';
    a.textContent = 'Model Diagnostic';
    a.style.cssText = [
      'position:fixed','right:14px','bottom:14px','z-index:999999',
      'padding:10px 13px','border-radius:10px','background:#111827',
      'color:#fff','font:600 13px system-ui,-apple-system,Segoe UI,sans-serif',
      'text-decoration:none','box-shadow:0 10px 28px rgba(0,0,0,.28)',
      'border:1px solid rgba(255,255,255,.18)'
    ].join(';');
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLink);
  else addLink();
})();
