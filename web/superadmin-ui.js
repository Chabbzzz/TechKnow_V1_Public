/* Navigation and responsive behavior for the platform workspace. */
(() => {
  const sidebar = document.getElementById('admin-sidebar');
  const main = document.getElementById('main-content');
  const menu = document.getElementById('mobile-menu-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  const mobile = window.matchMedia('(max-width: 900px)');

  function syncDrawer() {
    const open = mobile.matches && sidebar.classList.contains('open');
    sidebar.inert = mobile.matches && !open;
    main.inert = open;
    document.body.classList.toggle('sidebar-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }

  window.closeSuperAdminSidebar = () => {
    const restoreFocus = mobile.matches && sidebar.contains(document.activeElement);
    sidebar.classList.remove('open');
    syncDrawer();
    if (restoreFocus) menu.focus();
  };

  menu.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    syncDrawer();
    if (sidebar.classList.contains('open')) sidebar.querySelector('.nav-item.active').focus();
  });
  backdrop.addEventListener('click', window.closeSuperAdminSidebar);
  mobile.addEventListener('change', window.closeSuperAdminSidebar);

  function focusSection() {
    const heading = document.querySelector('.page.active h2');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  document.querySelectorAll('.nav-item[href^="#"]').forEach((item) => {
    item.addEventListener('click', () => {
      showSection(item.hash.slice(1));
      focusSection();
    });
  });
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section;
      showSection(section);
      window.location.hash = section;
      focusSection();
    });
  });
  window.addEventListener('hashchange', focusSection);

  document.addEventListener('keydown', (event) => {
    if (!mobile.matches || !sidebar.classList.contains('open')) return;
    if (event.key === 'Escape') {
      window.closeSuperAdminSidebar();
      menu.focus();
    }
    if (event.key !== 'Tab') return;
    const controls = [...sidebar.querySelectorAll('a[href], button:not(:disabled)')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });

  const date = document.getElementById('workspace-date');
  const now = new Date();
  date.dateTime = now.toISOString();
  date.textContent = new Intl.DateTimeFormat('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  }).format(now);
  syncDrawer();
})();
