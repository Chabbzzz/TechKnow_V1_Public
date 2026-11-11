/* Shared live tables. Privileged controls are enabled only for validated sessions. */
window.mountSuperAdmin = function ({ db, session, subscribe, escapeHTML: escape }) {
  if (!session?.uid) throw new Error('A validated admin session is required for management.');
  const records = { stores: [], users: [], products: [], reviews: [], permitSubmissions: [], auditLogs: [] };
  let accountFilter = 'All';
  let reviewFilter = 'All';
  let permitFilter = 'all';
  let permitState = 'loading';
  const { submissionStatus, submissionTime } = window.techKnowPermits;
  const permitService = window.techKnowPermits.createPermitService(window.techKnowFirebase);
  const pending = new Set();
  let activeReviewId = null;
  const limitDrafts = new Map();
  const limitFeedback = new Map();
  let catalogFilter = 'all';
  let catalogSearch = '';
  let catalogShop = '';
  let catalogCategory = '';
  const { accountStatus, storeStatus } = window.techKnowPresence;
  const isSuperAdmin = user => user.id === 'techknow-superadmin' || user.role === 'Super Admin';
  const functions = window.techKnowFirebase.app.functions('us-central1');
  const reviewModeration = window.techKnowReviewModeration.createService(window.techKnowFirebase, session);
  const notice = document.getElementById('platform-notice');
  function message(text, failed = false) {
    notice.hidden = false;
    notice.textContent = text;
    notice.classList.toggle('platform-error', failed);
  }
  const shopName = id => {
    const store = records.stores.find(store => store.id === id);
    return store?.name || store?.storeName || store?.businessName || id || 'Unassigned';
  };
  const storeIsCustomerVisible = store => {
    const id = String(store?.id || '');
    const name = String(store?.name || store?.storeName || store?.businessName || '').trim();
    return Boolean(id && !/^\d+$/.test(id) && name && (store.ownerId || store.ownerUid || store.uid || store.email || store.businessEmail || store.username));
  };
  const customerCanSeeProduct = product => product.archived !== true
    && !String(product.id || '').startsWith('presentation-product-')
    && storeIsCustomerVisible(records.stores.find(store => store.id === product.storeId));
  function productIssues(product) {
    const issues = [];
    if (typeof product.name !== 'string' || !product.name.trim()) issues.push('Add a product name.');
    if (typeof product.category !== 'string' || !product.category.trim()) issues.push('Choose a product category.');
    const price = product.price == null || String(product.price).trim() === '' ? NaN : Number(product.price);
    if (!Number.isFinite(price) || price < 0) issues.push('Enter a valid non-negative price.');
    const stock = product.stock == null || String(product.stock).trim() === '' ? NaN : Number(product.stock);
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 10) issues.push('Check the stock quantity (0–10).');
    if (Number.isSafeInteger(stock) && stock >= 0 && stock <= 10) {
      const expected = window.techKnowReservations.productStatus(stock).toLowerCase();
      if (String(product.status || '').trim().toLowerCase() !== expected) issues.push('Stock label does not match quantity.');
    }
    if (!product.storeId) issues.push('Assign this listing to a shop.');
    else if (!records.stores.some(store => store.id === product.storeId)) issues.push('Shop record could not be found.');
    return issues;
  }
  function renderProducts() {
    document.getElementById('catalog-total').textContent = records.products.length;
    document.getElementById('catalog-visible').textContent = records.products.filter(customerCanSeeProduct).length;
    document.getElementById('catalog-archived').textContent = records.products.filter(product => product.archived === true).length;
    document.getElementById('catalog-attention').textContent = records.products.filter(product => productIssues(product).length > 0).length;
    document.getElementById('catalog-filter').value = catalogFilter;
    document.querySelectorAll('[data-catalog-filter]').forEach(button => button.classList.toggle('active', button.dataset.catalogFilter === catalogFilter));
    const shopFilter = document.getElementById('catalog-shop-filter');
    const categoryFilter = document.getElementById('catalog-category-filter');
    const shops = [...new Map(records.stores.map(store => [store.id, shopName(store.id)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));
    shopFilter.innerHTML = '<option value="">All shops</option>' + shops.map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join('');
    categoryFilter.innerHTML = '<option value="">All categories</option>' + [...new Set(records.products.map(product => String(product.category || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)).map(category => `<option value="${escape(category)}">${escape(category)}</option>`).join('');
    shopFilter.value = catalogShop;
    categoryFilter.value = catalogCategory;
    const search = catalogSearch.trim().toLocaleLowerCase();
    const filtered = records.products.filter(product => {
      const issues = productIssues(product);
      const customerVisible = customerCanSeeProduct(product);
      const stock = Number(product.stock);
      const stockFilter = stock === 0 ? 'out-of-stock' : stock >= 1 && stock <= 4 ? 'low-stock' : stock >= 5 ? 'available' : '';
      const matchesFilter = catalogFilter === 'all'
        || (catalogFilter === 'visible' && customerVisible)
        || (catalogFilter === 'hidden' && !customerVisible)
        || (catalogFilter === 'archived' && product.archived === true)
        || (catalogFilter === 'attention' && issues.length > 0)
        || catalogFilter === stockFilter;
      const name = String(product.name || product.id || '').toLocaleLowerCase();
      const shop = shopName(product.storeId).toLocaleLowerCase();
      return matchesFilter && (!catalogShop || product.storeId === catalogShop)
        && (!catalogCategory || product.category === catalogCategory)
        && (!search || name.includes(search) || shop.includes(search));
    });
    rows('platform-products-body', filtered, 8, product => {
      const archived = product.archived === true;
      const customerVisible = customerCanSeeProduct(product);
      const issues = productIssues(product);
      const stock = product.stock == null || String(product.stock).trim() === '' ? NaN : Number(product.stock);
      const stockLabel = !Number.isSafeInteger(stock) || stock < 0 || stock > 10 ? 'Needs review'
        : stock === 0 ? 'Out of stock · waitlist available' : stock <= 4 ? 'Low stock' : 'In stock';
      const numericPrice = product.price == null || String(product.price).trim() === '' ? NaN : Number(product.price);
      const price = Number.isFinite(numericPrice) && numericPrice >= 0 ? `₱${numericPrice.toLocaleString('en-PH', { maximumFractionDigits: 2 })}` : 'Needs review';
      const store = records.stores.find(item => item.id === product.storeId);
      const reason = archived ? 'Archived listing' : !product.storeId ? 'No shop assigned'
        : !store ? 'Shop record missing' : !storeIsCustomerVisible(store) ? 'Shop details incomplete'
          : String(product.id || '').startsWith('presentation-product-') ? 'Preview listing' : '';
      const notes = issues.length ? issues.map(issue => `<span class="catalog-issue">${escape(issue)}</span>`).join('') : '<span class="catalog-clear">Details look complete</span>';
      return `<tr><td><strong>${escape(product.name || 'Unnamed product')}</strong><small>${escape(product.id)}</small></td><td>${escape(shopName(product.storeId))}</td><td>${escape(product.category || 'Missing category')}</td><td>${escape(price)}</td><td>${escape(stockLabel)}</td><td><span class="catalog-state ${archived ? 'is-archived' : 'is-active'}">${archived ? 'Archived' : 'Active'}</span></td><td><span class="catalog-state ${customerVisible ? 'is-visible' : 'is-hidden'}">${customerVisible ? 'Visible' : 'Hidden'}</span>${reason ? `<small>${escape(reason)}</small>` : ''}</td><td><div class="catalog-issues">${notes}</div></td></tr>`;
    });
  }
  const date = value => {
    const parsed = value?.toDate ? value.toDate() : new Date(value || 0);
    return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'Pending timestamp';
  };
  function rows(id, values, columns, render, emptyMessage = 'No matching records.') {
    document.getElementById(id).innerHTML = values.length ? values.map(render).join('') : `<tr><td colspan="${columns}" class="empty-table">${emptyMessage}</td></tr>`;
  }
  function renderPermits() {
    const body = document.getElementById('platform-permits-body');
    const count = document.getElementById('permit-count');
    if (permitState !== 'ready') {
      count.textContent = permitState === 'loading' ? 'Loading...' : 'Unavailable';
      body.innerHTML = `<tr><td colspan="6" class="empty-table">${permitState === 'loading' ? 'Loading permit submissions...' : 'Permit submissions could not load. Check your connection and reload.'}</td></tr>`;
      return;
    }
    const permits = records.permitSubmissions.filter(p => permitFilter === 'all' || submissionStatus(p) === permitFilter)
      .sort((a, b) => submissionTime(b) - submissionTime(a) || a.id.localeCompare(b.id));
    count.textContent = `${permits.length} of ${records.permitSubmissions.length}`;
    rows('platform-permits-body', permits, 6, permit => {
      const admin = records.users.find(user => user.id === (permit.uid || permit.storeId));
      const status = submissionStatus(permit);
      const labels = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', uploading: 'Uploading', upload_failed: 'Upload failed' };
      const documents = Array.isArray(permit.documents) ? permit.documents : [];
      const files = documents.map((file, index) => {
        const name = escape(file.fileName || `Document ${index + 1}`);
        return !file.storagePath ? `<span>${name}</span>` : `<button type="button" class="btn btn-outline btn-sm" data-permit-id="${escape(permit.id)}" data-document-index="${index}"><i class="fa fa-file-arrow-down" aria-hidden="true"></i> ${name}</button>`;
      }).join('');
      return `<tr><td><strong>${escape(permit.permitType || 'Store verification')}</strong><small>${escape(permit.permitNumber || permit.id)}</small>${permit.issuingAuthority ? `<small>${escape(permit.issuingAuthority)}</small>` : ''}</td><td>${escape(records.stores.some(store => store.id === permit.storeId) ? shopName(permit.storeId) : permit.storeName || shopName(permit.storeId))}</td><td>${escape(admin?.fullName || admin?.email || permit.uid || 'Not recorded')}<small>${escape(admin?.email || '')}</small></td><td><div class="permit-documents">${files || '<span>No documents uploaded yet.</span>'}</div></td><td>${escape(date(permit.submittedAt || permit.createdAt))}</td><td><span class="permit-status ${Object.hasOwn(labels, status) ? status : ''}">${escape(labels[status] || status)}</span></td></tr>`;
    });
    if (!permits.length) body.innerHTML = `<tr><td colspan="6" class="empty-table">${records.permitSubmissions.length ? 'No submissions match this status.' : 'No permit submissions yet. Documents submitted by store admins will appear here.'}</td></tr>`;
  }
  function render() {
    document.getElementById('stat-shops').textContent = records.stores.length;
    const visibleAccounts = records.users.filter(user => !isSuperAdmin(user));
    document.getElementById('stat-users').textContent = visibleAccounts.length;
    document.getElementById('stat-products').textContent = records.products.length;
    document.getElementById('stat-reported-reviews').textContent = records.reviews.filter(review => review.reviewReport?.status === 'pending').length;
    document.getElementById('stat-approved-reviews').textContent = records.reviews.filter(review => ['approved', 'published'].includes(String(review.status || '').toLowerCase())).length;
    renderProducts();
    const focusedLimit = document.activeElement?.dataset?.limitInput;
    rows('shop-usage-body', records.stores, 7, store => {
      const storeProducts = records.products.filter(product => product.storeId === store.id);
      const count = storeProducts.length;
      const activeCount = storeProducts.filter(product => product.archived !== true).length;
      const archivedCount = count - activeCount;
      const issueCount = storeProducts.filter(product => productIssues(product).length > 0).length;
      const limit = Number(store.productLimit);
      const hasLimit = store.productLimit != null && Number.isSafeInteger(limit) && limit >= 0;
      const draft = limitDrafts.has(store.id) ? limitDrafts.get(store.id) : hasLimit ? String(limit) : '';
      const saving = pending.has('limit:' + store.id);
      const feedback = limitFeedback.get(store.id);
      const usage = !hasLimit ? 'Unlimited' : limit === 0 ? 'New products blocked' : `${Math.round(count / limit * 100)}%${count > limit ? ' · Over limit' : count === limit ? ' · At limit' : ''}`;
      return `<tr><td><strong>${escape(shopName(store.id))}</strong><small>${escape(store.id)}</small></td><td>${count}</td><td>${activeCount}</td><td>${archivedCount}</td><td>${issueCount ? `<span class="catalog-issue-count">${issueCount} flagged</span>` : '0'}</td><td><form class="product-limit-form" data-limit-store="${escape(store.id)}"><input type="number" min="0" max="9007199254740991" step="1" inputmode="numeric" aria-label="Product limit for ${escape(shopName(store.id))}" data-limit-input="${escape(store.id)}" value="${escape(draft)}" placeholder="Unlimited" ${saving ? 'disabled' : ''}><button type="submit" class="btn btn-outline btn-sm" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save'}</button></form><small class="product-limit-feedback${feedback?.failed ? ' is-error' : ''}" role="status">${escape(feedback?.text || '')}</small></td><td>${usage}</td></tr>`;
    });
    if (focusedLimit) {
      [...document.querySelectorAll('[data-limit-input]')].find(input => input.dataset.limitInput === focusedLimit)?.focus({ preventScroll: true });
    }
    document.getElementById('catalog-filter').value = catalogFilter;
    document.querySelectorAll('[data-catalog-filter]').forEach(button => button.classList.toggle('active', button.dataset.catalogFilter === catalogFilter));
    document.getElementById('catalog-shop-filter').value = catalogShop;
    document.getElementById('catalog-category-filter').value = catalogCategory;
    const users = visibleAccounts.filter(user => accountFilter === 'All'
      || (accountFilter === 'Shops' ? user.role === 'Store Admin' : user.role !== 'Store Admin'));
    rows('accounts-body', users, 4, user => {
      const protectedAccount = user.id === session?.uid || user.role === 'Super Admin';
      const action = user.status === 'Suspended' ? 'Restore' : 'Suspend';
      return `<tr><td><strong>${escape(user.fullName || user.email || user.id)}</strong><small>${escape(user.email)}</small></td><td>${escape(user.role || 'Customer')}</td><td data-presence-user="${escape(user.id)}">${accountStatus(user)}</td><td>${protectedAccount ? 'Protected account' : user.adminOperationId ? 'Action pending — see logs' : `<button type="button" class="btn btn-outline btn-sm" data-account-id="${escape(user.id)}" data-action="${action}" ${pending.has('account:' + user.id) ? 'disabled' : ''}>${action}</button>`}</td></tr>`;
    });
    const reviews = records.reviews.filter(review => {
      const reported = review.reviewReport?.status === 'pending';
      const approved = ['approved', 'published'].includes(String(review.status || '').toLowerCase());
      return (reported || approved || review.authorModerationId) && (reviewFilter === 'All' || (reviewFilter === 'Reported' ? reported : approved));
    });
    rows('all-reviews-body', reviews, 9, review => {
      const report = review.reviewReport;
      const proof = review.proofFileUrl || review.proofFile || '';
      const proofLink = /^(https?:\/\/|data:image\/)/i.test(String(proof))
        ? `<a class="btn btn-outline btn-sm" href="${escape(proof)}" target="_blank" rel="noopener noreferrer">View image</a>` : 'No proof';
      return `<tr><td>${escape(review.review || review.text || '')}</td><td>${escape(shopName(review.storeId))}</td><td>${escape(review.user || review.userId)}</td><td>${escape(review.rating ?? '—')}/5</td><td>${escape(review.status || 'Pending')}</td><td>${escape(review.risk || 'Not assessed')}</td><td>${report?.status === 'pending' ? `<strong class="report-pending">Pending</strong><small>${escape(report.target === 'proof' ? 'Proof image' : 'Review text')}: ${escape(report.reason)}</small>` : report?.status ? escape(report.status) : 'No report'}</td><td>${proofLink}</td><td><button type="button" class="btn btn-outline btn-sm" data-review-details="${escape(review.id)}">Review details</button></td></tr>`;
    }, 'No reviews match this filter.');
    renderPermits();
    rows('logs-body', records.auditLogs, 6, log => `<tr><td>${escape(date(log.createdAt))}</td><td>${escape(log.action)}</td><td>${escape(log.targetEmail || log.target)}</td><td>${escape(log.reason)}</td><td>${escape(log.adminUid)}</td><td>${escape(log.status)}</td></tr>`);
    const activeReview = records.reviews.find(review => String(review.id) === activeReviewId);
    if (activeReview && document.getElementById('platform-review-modal').open) refreshReviewActions(activeReview);
  }
  function openReviewDetails(id) {
    const review = records.reviews.find(item => String(item.id) === String(id));
    if (!review || (!review.authorModerationId && review.reviewReport?.status !== 'pending'
      && !['approved', 'published'].includes(String(review.status || '').toLowerCase()))) return;
    activeReviewId = String(id);
    const report = review.reviewReport;
    const candidate = review.proofFileUrl || review.proofFile || '';
    const proofURL = /^(https?:\/\/|data:image\/)/i.test(String(candidate)) ? String(candidate) : '';
    const modal = document.getElementById('platform-review-modal');
    const author = records.users.find(user => user.id === review.userId);
    document.getElementById('platform-review-author').textContent = author?.fullName || author?.email || review.user || review.userEmail || 'Customer';
    document.getElementById('platform-review-shop').textContent = shopName(review.storeId);
    document.getElementById('platform-review-rating').textContent = `${review.rating ?? 'Not rated'} / 5`;
    document.getElementById('platform-review-text').textContent = review.review || review.text || 'No written feedback.';
    const reportBox = document.getElementById('platform-review-report');
    reportBox.hidden = !report;
    reportBox.textContent = report ? `Store report (${report.status || 'submitted'}): ${report.target === 'proof' ? 'Proof image' : 'Review text'} — ${report.reason || 'No reason provided.'}` : '';
    const image = document.getElementById('platform-review-image');
    const proofEmpty = document.getElementById('platform-review-proof-empty');
    image.hidden = !proofURL;
    proofEmpty.textContent = 'No proof image attached.';
    proofEmpty.hidden = Boolean(proofURL);
    image.onerror = () => { image.hidden = true; proofEmpty.hidden = false; proofEmpty.textContent = 'The proof image could not be loaded.'; };
    if (proofURL) image.src = proofURL;
    else image.removeAttribute('src');
    document.getElementById('platform-review-reason').value = '';
    document.getElementById('platform-review-action-status').textContent = '';
    refreshReviewActions(review);
    modal.showModal();
  }
  function refreshReviewActions(review) {
    const busy = pending.has('review-action:' + String(review.id));
    const eligible = review.authorModerationId || review.reviewReport?.status === 'pending'
      || ['approved', 'published'].includes(String(review.status || '').toLowerCase());
    const author = records.users.find(user => user.id === review.userId);
    const restricted = !author || (author.role || 'Customer') !== 'Customer'
      || ['suspended', 'banned', 'disabled'].includes(String(author.status || '').toLowerCase()) || author.adminOperationId;
    document.querySelectorAll('[data-platform-review-action]').forEach(button => {
      button.disabled = busy || !eligible || Boolean(restricted)
        || (button.dataset.platformReviewAction === 'warning' && Boolean(review.authorModerationId));
    });
    document.getElementById('platform-review-reason').disabled = busy;
    document.querySelectorAll('[data-review-close]').forEach(button => { button.disabled = busy; });
    if (!busy && restricted) document.getElementById('platform-review-action-status').textContent = author ? 'This account is already restricted or is not a customer account.' : 'The author account could not be found.';
  }
  document.getElementById('main-content').addEventListener('click', event => {
    const button = event.target.closest('[data-review-details]');
    if (button) openReviewDetails(button.dataset.reviewDetails);
  });
  document.getElementById('platform-review-modal').addEventListener('click', async event => {
    if (pending.has('review-action:' + activeReviewId)) return;
    if (event.target.closest('[data-review-close]')) {
      document.getElementById('platform-review-modal').close();
      return;
    }
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
      return;
    }
    const button = event.target.closest('[data-platform-review-action]');
    if (!button || button.disabled || !activeReviewId) return;
    const action = button.dataset.platformReviewAction;
    if (!['warning', 'suspend'].includes(action)) return;
    const reason = document.getElementById('platform-review-reason').value.trim();
    if (!reason) {
      document.getElementById('platform-review-action-status').textContent = 'Enter a reason before taking this action.';
      document.getElementById('platform-review-reason').focus();
      return;
    }
    const id = activeReviewId;
    const key = 'review-action:' + id;
    if (pending.has(key)) return;
    pending.add(key);
    const status = document.getElementById('platform-review-action-status');
    status.textContent = 'Saving action...';
    refreshReviewActions(records.reviews.find(review => String(review.id) === id));
    try {
      const result = await reviewModeration.moderate(id, action, reason);
      const updated = records.reviews.find(review => String(review.id) === id);
      const handledReport = updated?.reviewReport?.status === 'pending';
      if (updated) {
        updated.authorModerationId = result.notificationId;
        if (action === 'suspend') {
          const author = records.users.find(user => user.id === result.userId);
          if (author) author.status = 'Suspended';
        }
        if (updated.reviewReport?.status === 'pending') updated.reviewReport = { ...updated.reviewReport, status: 'actioned' };
        refreshReviewActions(updated);
      }
      status.textContent = handledReport ? 'Report handled. The audit trail has been updated.' : 'Review updated. The audit trail has been updated.';
      message(action === 'warning' ? 'Warning sent to the customer who wrote this review.' : 'Customer suspended. Their next sign-in will show the suspension reason.', false);
      document.getElementById('platform-review-modal').close();
    } catch (error) {
      status.textContent = error.message || 'The action could not be completed.';
      message(error.message || 'The action could not be completed.', true);
    } finally {
      pending.delete(key);
      const updated = records.reviews.find(review => String(review.id) === id);
      if (updated) refreshReviewActions(updated);
      render();
    }
  });
  document.getElementById('platform-review-modal').addEventListener('cancel', event => {
    if (pending.has('review-action:' + activeReviewId)) event.preventDefault();
  });
  document.querySelectorAll('#accounts .report-filter, #reviews .report-filter').forEach(button => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    if (button.closest('#accounts')) accountFilter = button.textContent.trim();
    else reviewFilter = button.textContent.trim();
    render();
  }));
  document.querySelectorAll('[data-review-reports], [data-review-approved]').forEach(button => button.addEventListener('click', () => {
    reviewFilter = button.hasAttribute('data-review-approved') ? 'Approved' : 'Reported';
    document.querySelectorAll('#reviews .report-filter').forEach(filter => filter.classList.toggle('active', filter.textContent.trim() === reviewFilter));
    render();
  }));
  document.querySelectorAll('[data-permit-filter]').forEach(button => button.addEventListener('click', () => {
    permitFilter = button.dataset.permitFilter;
    button.parentElement.querySelectorAll('button').forEach(item => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderPermits();
  }));
  document.getElementById('catalog-search').addEventListener('input', event => {
    catalogSearch = event.target.value;
    renderProducts();
  });
  document.getElementById('catalog-filter').addEventListener('change', event => {
    catalogFilter = event.target.value;
    renderProducts();
    document.querySelectorAll('[data-catalog-filter]').forEach(button => button.classList.toggle('active', button.dataset.catalogFilter === catalogFilter));
  });
  document.getElementById('catalog-shop-filter').addEventListener('change', event => {
    catalogShop = event.target.value;
    renderProducts();
  });
  document.getElementById('catalog-category-filter').addEventListener('change', event => {
    catalogCategory = event.target.value;
    renderProducts();
  });
  document.querySelectorAll('[data-catalog-filter]').forEach(button => button.addEventListener('click', () => {
    catalogFilter = button.dataset.catalogFilter;
    renderProducts();
  }));
  document.getElementById('main-content').addEventListener('input', event => {
    const id = event.target.dataset?.limitInput;
    if (id) limitDrafts.set(id, event.target.value);
  });
  document.getElementById('main-content').addEventListener('submit', async event => {
    const form = event.target.closest('[data-limit-store]');
    if (!form) return;
    event.preventDefault();
    const id = form.dataset.limitStore;
    const key = 'limit:' + id;
    if (pending.has(key)) return;
    const input = form.querySelector('[data-limit-input]');
    const raw = input.value.trim();
    const productLimit = raw === '' ? null : Number(raw);
    limitDrafts.set(id, raw);
    if (productLimit !== null && (!Number.isSafeInteger(productLimit) || productLimit < 0)) {
      limitFeedback.set(id, { text: 'Enter a whole number of 0 or more.', failed: true });
      render();
      return;
    }
    pending.add(key);
    limitFeedback.delete(id);
    render();
    try {
      await functions.httpsCallable('setStoreProductLimit')({ storeId: id, productLimit });
      records.stores = records.stores.map(store => store.id === id ? { ...store, productLimit } : store);
      limitDrafts.delete(id);
      limitFeedback.set(id, { text: productLimit === null ? 'Saved: unlimited.' : `Saved: ${productLimit} products.` });
    } catch (error) {
      // Missing callable endpoints can surface as INTERNAL when their response
      // is not callable JSON or the browser blocks it during the CORS check.
      limitFeedback.set(id, { text: ['functions/not-found', 'functions/unavailable', 'functions/internal', 'functions/unknown'].includes(error.code)
        ? 'The limit service is unavailable. Check deployment and connection, then retry.'
        : error.message || 'The limit could not be saved. Try again.', failed: true });
    } finally {
      pending.delete(key);
      render();
    }
  });
  document.getElementById('main-content').addEventListener('click', async event => {
    const documentButton = event.target.closest('[data-permit-id]');
    if (documentButton) {
      const permit = records.permitSubmissions.find(p => p.id === documentButton.dataset.permitId);
      if (!permit) return message('This submission is no longer available.', true);
      const tab = window.open('', '_blank');
      if (!tab) return message('Allow pop-ups for this site to open the document.', true);
      tab.opener = null;
      try {
        const url = await permitService.documentURL(permit, Number(documentButton.dataset.documentIndex));
        tab.location.replace(url);
      } catch (error) { tab.close(); message(`The document could not open: ${error.message}`, true); }
      return;
    }
    const button = event.target.closest('[data-account-id], [data-review-id]');
    if (!button || button.disabled) return;
    const account = Boolean(button.dataset.accountId);
    const id = button.dataset.accountId || button.dataset.reviewId;
    const key = (account ? 'account:' : 'review:') + id;
    if (pending.has(key)) return;
    if (account) {
      const user = records.users.find(user => user.id === id);
      if (!user || isSuperAdmin(user) || user.id === session.uid) return message('This account cannot be changed here.', true);
      if (user.adminOperationId) return message('An account action is already pending. Review the audit trail.', true);
      const action = user.status === 'Suspended' ? 'Restore' : 'Suspend';
      window.openPlatformAccountModal({
        action,
        name: user.fullName || user.email || user.id,
        email: user.email,
        isStore: user.role === 'Store Admin',
        restoreFocus: () => {
          const currentButton = [...document.querySelectorAll('[data-account-id]')].find(item => item.dataset.accountId === id);
          (currentButton || document.getElementById('main-content')).focus({ preventScroll: true });
        },
        onConfirm: async reason => {
          const latest = records.users.find(item => item.id === id);
          if (!latest || isSuperAdmin(latest) || pending.has(key) || latest.adminOperationId
            || (latest.status === 'Suspended' ? 'Restore' : 'Suspend') !== action) {
            throw new Error('This account has changed or an action is pending. Close this dialog and review the account or audit trail.');
          }
          pending.add(key);
          render();
          try {
            const result = await functions.httpsCallable('setPlatformAccountStatus')({ uid: id, action, reason });
            if (result?.data?.uid === id && typeof result.data.status === 'string') {
              records.users = records.users.map(item => item.id === id
                ? { ...item, status: result.data.status, adminOperationId: null } : item);
            }
            message(`${action === 'Suspend' ? 'Account suspended' : 'Account restored'}. The audit trail will update automatically.`);
          } catch (error) {
            throw new Error(['functions/not-found', 'functions/unavailable'].includes(error.code)
              ? 'The management service is unavailable. Check deployment and connection before retrying.'
              : error.message || 'The account could not be updated.');
          } finally {
            pending.delete(key);
            render();
          }
        },
      });
      return;
    }
    const reason = window.prompt(`Reason for ${button.textContent.trim().toLowerCase()} (required):`);
    if (!reason?.trim()) return;
    if (reason.length > 1000) return message('Keep the reason within 1000 characters.', true);
    pending.add(key);
    render();
    message('Saving action…');
    try {
      await functions.httpsCallable('setPlatformReviewFlag')({ reviewId: id, flagged: button.dataset.flagged === 'true', reason });
      message('Action saved. The audit trail and connected records will update automatically.');
    } catch (error) {
      message(['functions/not-found', 'functions/unavailable'].includes(error.code)
        ? 'The management service is unavailable. Check deployment and connection before retrying.'
        : error.message || 'The action could not be completed.', true);
    } finally { pending.delete(key); render(); }
  });
  const auditQuery = db.collection('auditLogs').orderBy('createdAt', 'desc').limit(200);
  document.getElementById('refresh-system-logs').addEventListener('click', async () => {
    try {
      const snapshot = await auditQuery.get({ source: 'server' });
      records.auditLogs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      render();
      message('Latest 200 audit records refreshed.');
    } catch (error) { message(`Audit records could not load: ${error.message}`, true); }
  });
  Object.keys(records).forEach(name => subscribe(name === 'auditLogs' ? auditQuery : db.collection(name), snapshot => {
    records[name] = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    if (name === 'permitSubmissions') permitState = 'ready';
    render();
  }, error => {
    if (name === 'permitSubmissions') { permitState = 'error'; renderPermits(); }
    message(`${name === 'permitSubmissions' ? 'Permit submissions' : name} could not load: ${error.message}`, true);
  }));
  // Expire crashed/disconnected sessions even when Firestore sends no new snapshot.
  const presenceTimer = window.setInterval(() => {
    document.querySelectorAll('[data-presence-user]').forEach(cell => {
      cell.textContent = accountStatus(records.users.find(user => user.id === cell.dataset.presenceUser));
    });
    document.querySelectorAll('[data-presence-store]').forEach(cell => {
      const store = records.stores.find(store => store.id === cell.dataset.presenceStore);
      cell.textContent = store ? storeStatus(store, records.users) : 'Inactive';
    });
  }, 5000);
  window.addEventListener('pagehide', () => window.clearInterval(presenceTimer), { once: true });
};
