/* Screen preview only: no authentication, Firebase data, or management operations. */
(() => {
  document.body.dataset.mode = 'preview';
  const notice = document.getElementById('platform-notice');
  notice.hidden = false;
  notice.classList.add('preview-notice');
  const text = document.createElement('span');
  const heading = document.createElement('strong');
  heading.textContent = 'Preview mode — no login required.';
  text.append(heading, document.createElement('br'), 'Explore all six sections. Live records and management actions are unavailable in this preview.');
  const login = document.createElement('a');
  login.href = 'superadmin.html';
  login.className = 'btn btn-outline btn-sm';
  login.textContent = 'Open live data';
  notice.replaceChildren(text, login);

  document.querySelectorAll('.stat-value').forEach(stat => { stat.textContent = '—'; });
  document.querySelectorAll('tbody').forEach(body => {
    const columns = body.closest('table').querySelectorAll('thead th').length;
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.className = 'empty-table';
    cell.textContent = 'Preview mode. Live records are not loaded.';
    const row = document.createElement('tr');
    row.appendChild(cell);
    body.replaceChildren(row);
  });
  document.querySelectorAll('.report-filter, #refresh-system-logs').forEach(button => {
    button.disabled = true;
    button.title = 'Available when signed in with live data';
  });
  document.querySelector('.admin-name').textContent = 'Workspace Preview';
  document.querySelector('.admin-role').textContent = 'No live data connected';
  document.querySelectorAll('.admin-logout').forEach(button => {
    button.setAttribute('aria-label', 'Exit preview');
    button.title = 'Exit preview';
    button.addEventListener('click', () => window.location.assign('landing.html'));
  });
  showSection(window.location.hash.slice(1));
})();
