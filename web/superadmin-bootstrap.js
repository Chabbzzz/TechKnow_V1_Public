/* The Super Admin workspace always requires an authenticated management session. */
(() => {
  const params = new URLSearchParams(window.location.search);
  const preview = params.get('preview') === '1';
  const sources = preview ? ['superadmin-preview.js'] : [
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage-compat.js',
    '../backend/config/firebase-config.js',
    'firebase-config.js?v=20261023',
    '../backend/services/presence.js',
    'presence.js',
    '../backend/domain/reservations.js',
    '../backend/services/admin.js',
    '../backend/services/review-moderation.js?v=20261111',
    '../backend/services/permits.js?v=20261025-permits',
    'superadmin-data.js?v=20261111-review-moderation',
    '../backend/dashboard-data.js?v=20261023',
  ];

  async function start() {
    for (const source of sources) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = () => reject(new Error('The workspace could not load. Check your connection and reload the page.'));
        document.body.appendChild(script);
      });
    }
  }
  start().catch(error => {
    const notice = document.getElementById('platform-notice');
    notice.hidden = false;
    notice.classList.add('platform-error');
    notice.setAttribute('role', 'alert');
    notice.textContent = error.message;
  });
})();
