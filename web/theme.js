/* Theme: 'system' follows the device, 'light' and 'dark' are fixed. Loaded from <head>
   before anything is drawn, so the page never flashes the wrong colours. The resolved
   value lands in <html data-theme>, which style.css switches on. */
(function () {
  var KEY = 'mep_theme';
  var COLORS = { light: '#1565c0', dark: '#121212' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }
  var choice = stored();
  function apply() {
    var eff = choice === 'system' ? (mq && mq.matches ? 'dark' : 'light') : choice;
    document.documentElement.setAttribute('data-theme', eff);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[eff]);
  }
  if (mq) {
    var onChange = function () { if (choice === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  apply();
  window.MEP_THEME = {
    get: function () { return choice; },
    set: function (v) {
      choice = v === 'light' || v === 'dark' ? v : 'system';
      try {
        if (choice === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
      } catch (e) { /* private mode: lasts until the tab closes */ }
      apply();
    },
  };
})();
