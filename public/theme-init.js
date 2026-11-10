/**
 * Applies the stored theme before the first paint (no flash). Loaded as a classic blocking script
 * from index.html so that the Content-Security-Policy can stay `script-src 'self'`.
 * Keep the storage key in sync with THEME_STORAGE_KEY in src/shared/theme.
 */
;(function () {
  var theme = 'system'
  try {
    var stored = window.localStorage.getItem('mini-crm-theme')
    if (stored === 'light' || stored === 'dark') theme = stored
  } catch (error) {
    theme = 'system'
  }
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0b1120' : '#ffffff')
})()
