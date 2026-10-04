// Apply the saved theme before first paint to avoid a flash of the wrong theme
;(function () {
  var stored = null
  try {
    stored = JSON.parse(localStorage.getItem('du:theme'))
  } catch {
    // storage unavailable
  }
  var dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  if (dark) document.documentElement.classList.add('dark')
})()
