/* Presentation and keyboard behavior for the store workspace. */
(() => {
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  const menu = document.getElementById('mobile-menu-btn');
  const mobile = window.matchMedia('(max-width: 900px)');
  const modalTriggers = new Map();
  const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

  function visibleControls(container) {
    return [...container.querySelectorAll(focusable)].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  }

  function syncBackground() {
    const hasModal = Boolean(document.querySelector('.modal-overlay.open'));
    const hasDrawer = mobile.matches && sidebar.classList.contains('open');
    main.inert = hasModal || hasDrawer;
    sidebar.inert = hasModal || (mobile.matches && !hasDrawer);
    document.body.classList.toggle('modal-open', hasModal);
  }

  window.closeSidebar = () => {
    const restoreFocus = sidebar.contains(document.activeElement) && mobile.matches;
    sidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
    syncBackground();
    if (restoreFocus) menu.focus();
  };

  window.toggleSidebar = () => {
    if (sidebar.classList.contains('open')) return window.closeSidebar();
    sidebar.classList.add('open');
    document.body.classList.add('sidebar-open');
    menu.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', 'Close navigation');
    syncBackground();
    sidebar.querySelector('.nav-item.active').focus();
  };
  mobile.addEventListener('change', () => window.closeSidebar());

  window.openModal = id => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    if (!overlay.classList.contains('open')) modalTriggers.set(id, document.activeElement);
    overlay.classList.add('open');
    syncBackground();
    const dialog = overlay.querySelector('.modal');
    const firstInput = dialog.querySelector('input:not([type="file"]):not([type="hidden"]), select, textarea');
    (firstInput || visibleControls(dialog)[0] || dialog).focus();
  };

  window.closeModal = id => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove('open');
    syncBackground();
    const trigger = modalTriggers.get(id);
    if (trigger?.isConnected) trigger.focus();
    modalTriggers.delete(id);
  };

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    const dialog = overlay.querySelector('.modal');
    overlay.removeAttribute('role');
    overlay.removeAttribute('aria-modal');
    overlay.removeAttribute('aria-labelledby');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const title = dialog.querySelector('.modal-title');
    if (title) {
      title.id ||= `${overlay.id}-title`;
      dialog.setAttribute('aria-labelledby', title.id);
    }
    dialog.querySelectorAll('.modal-close').forEach(button => button.setAttribute('aria-label', 'Close dialog'));
  });

  document.querySelectorAll('.upload-area[onclick]').forEach(area => {
    area.tabIndex = 0;
    area.setAttribute('role', 'button');
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); area.click(); }
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const container = document.querySelector('.modal-overlay.open .modal') || (mobile.matches && sidebar.classList.contains('open') ? sidebar : null);
    if (!container) return;
    const controls = visibleControls(container);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); container.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(nav => nav.removeAttribute('aria-current'));
      item.setAttribute('aria-current', 'page');
      document.title = `${item.querySelector('span').textContent} | TechKnow`;
      const heading = document.querySelector('.page.active h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (item.dataset.page === 'dashboard' && window.storeAdminCharts) {
        requestAnimationFrame(() => Object.values(window.storeAdminCharts).forEach(chart => chart.resize()));
      }
    });
  });

  document.querySelectorAll('[data-go]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelector(`.nav-item[data-page="${button.dataset.go}"]`)?.click();
      if (button.dataset.reservationTab) {
        document.querySelector(`#page-reservations .tab[data-tab="${button.dataset.reservationTab}"]`)?.click();
      }
    });
  });

  document.querySelectorAll('.tabs, .permit-tabs').forEach(group => {
    const update = () => group.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    update();
    group.addEventListener('click', update);
  });
  document.querySelectorAll('.input-group').forEach(group => {
    const label = group.querySelector('.input-label');
    const input = group.querySelector('input, select, textarea');
    if (!label || !input?.id) return;
    if (label.tagName === 'LABEL') label.htmlFor = input.id;
    else { label.id ||= `${input.id}-label`; input.setAttribute('aria-labelledby', label.id); }
  });

  const date = document.getElementById('workspace-date');
  const now = new Date();
  date.dateTime = now.toISOString();
  date.textContent = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(now);

  window.refreshDashboard = async () => {
    const button = document.getElementById('dashboard-refresh');
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    try {
      if (typeof window.refreshStoreAdminDashboard !== 'function') throw new Error('Store data is not connected yet. Please try again in a moment.');
      await window.refreshStoreAdminDashboard();
      window.showToast('success', 'fa-circle-check', 'Dashboard refreshed', 'Your latest products, reservations, and reviews are ready.');
    } catch (error) {
      window.showToast('danger', 'fa-circle-exclamation', 'Unable to refresh', error.message || 'Please check your connection and try again.');
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    }
  };

  const emptyMessages = {
    chartReserved: ['No reservations yet', 'Your most popular products will appear here.'],
    chartWeekly: ['Your activity starts here', 'Reservation trends will appear as orders come in.'],
    chartSentiment: ['No analyzed reviews yet', 'Customer sentiment will appear when reviews are analyzed.'],
  };
  if (window.Chart && window.storeAdminCharts) {
    Chart.register({
      id: 'adminEmptyState',
      afterDraw(chart) {
        const message = emptyMessages[chart.canvas.id];
        if (!message) return;
        const hasData = chart.data.datasets.some(set => set.data.some(value => Number(value) > 0));
        if (hasData) {
          chart.canvas.setAttribute('aria-label', chart.data.labels.map((label, i) => `${label}: ${chart.data.datasets[0].data[i] || 0}`).join('; '));
          return;
        }
        chart.canvas.setAttribute('aria-label', message.join('. '));
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#eaf0fc';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 32, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7e9bcc';
        ctx.lineWidth = 3;
        [10, 19, 14].forEach((size, index) => {
          const x = width / 2 - 8 + index * 8;
          ctx.beginPath(); ctx.moveTo(x, height / 2 - 23); ctx.lineTo(x, height / 2 - 23 - size); ctx.stroke();
        });
        ctx.fillStyle = '#485b77';
        ctx.font = '600 12px "DM Sans", sans-serif';
        ctx.fillText(message[0], width / 2, height / 2 + 15, width - 20);
        ctx.fillStyle = '#65748a';
        ctx.font = '11px "DM Sans", sans-serif';
        ctx.fillText(message[1], width / 2, height / 2 + 36, width - 20);
        ctx.restore();
      },
    });
    Object.values(window.storeAdminCharts).forEach(chart => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) chart.options.animation = false;
      chart.update();
    });
  } else {
    document.querySelectorAll('.chart-wrap').forEach(wrap => {
      const message = document.createElement('p');
      message.className = 'chart-unavailable';
      message.textContent = 'Charts could not load. Check your connection and reload the page.';
      wrap.replaceChildren(message);
    });
  }
  syncBackground();
})();
