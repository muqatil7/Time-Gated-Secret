(function () {
  document.addEventListener('DOMContentLoaded', function () {
    // Ensure dark theme hint for user agents
    document.documentElement.style.colorScheme = 'dark';

    // Set default timezone for the create page only, without changing server logic
    try {
      var path = (location.pathname || '').replace(/\/+$/, '');
      if (path === '/new') {
        var tzInput = document.querySelector('input[name="timezone"]');
        if (tzInput && (!tzInput.value || tzInput.value.trim().toUpperCase() === 'UTC')) {
          tzInput.value = 'Africa/Cairo';
        }
      }
    } catch (_) {}
  });
})();


