const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../../web/superadmin-data.js'), 'utf8');

function view() {
  const elements = new Map();
  const listeners = new Map();
  const subscriptions = new Map();
  const db = { collection: name => ({ name, orderBy() { return this; }, limit() { return this; }, where(field, operator, value) { this.filter = { field, operator, value }; return this; } }) };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', classList: { toggle() {} },
      addEventListener: (event, handler) => listeners.set(id + ':' + event, handler),
    });
    return elements.get(id);
  };
  let refreshPresence;
  const presenceCells = [];
  const functionCalls = [];
  let accountModal;
  let functionFailure;
  const window = {
    techKnowReservations: require('../domain/reservations'),
    techKnowPermits: require('../services/permits'),
    techKnowReviewModeration: { createService: () => ({}) },
    techKnowPresence: require('../services/presence'),
    setInterval(callback) { refreshPresence = callback; return 1; },
    clearInterval() {}, addEventListener() {},
    prompt: () => 'Test moderation reason',
    openPlatformAccountModal(options) { accountModal = options; },
    techKnowFirebase: {
      db,
      app: { functions(region) {
        assert.equal(region, 'us-central1');
        return { httpsCallable: name => async data => {
          functionCalls.push({ name, data });
          if (functionFailure) throw functionFailure;
          return { data: { uid: data.uid, status: data.action === 'Suspend' ? 'Suspended' : 'Active' } };
        } };
      } },
    },
  };
  vm.runInNewContext(code, { window, document: {
    getElementById: element,
    querySelectorAll: selector => selector === '[data-presence-user]' ? presenceCells : [],
  } });
  const options = {
    db, session: { uid: 'techknow-superadmin' },
    escapeHTML: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    subscribe: (reference, onData, onError) => subscriptions.set(reference.name, { onData, onError, filter: reference.filter }),
  };
  window.mountSuperAdmin(options);
  const emit = (name, docs) => subscriptions.get(name).onData({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });
  return { elements, listeners, subscriptions, emit, mount: window.mountSuperAdmin, options,
    refreshPresence: () => refreshPresence(), presenceCells, functionCalls,
    accountModal: () => accountModal, failFunctions: error => { functionFailure = error; } };
}

test('authenticated management view shows approved reviews and pending store reports', () => {
  const fixture = view();
  assert.deepEqual([...fixture.subscriptions.keys()], ['stores', 'users', 'products', 'reviews', 'permitSubmissions', 'auditLogs']);
  assert.equal(fixture.subscriptions.get('reviews').filter, undefined);
  fixture.emit('stores', [{ id: 's1', name: 'Shop' }]);
  fixture.emit('users', [{ id: 'u1', email: 'customer@example.test', role: 'Customer', status: 'Active' }]);
  fixture.emit('products', [{ id: 'p1', name: 'Product', storeId: 's1', stock: 3 }]);
  fixture.emit('reviews', [
    { id: 'r1', review: '<script>untrusted</script>', storeId: 's1', status: 'Pending', reviewReport: { status: 'pending', target: 'proof', reason: 'Blurry receipt' } },
    { id: 'approved', review: 'Already approved', storeId: 's1', status: 'Approved' },
    { id: 'unreported', review: 'Awaiting store', storeId: 's1', status: 'Pending' },
  ]);
  fixture.emit('permitSubmissions', []);
  fixture.emit('auditLogs', []);
  assert.equal(fixture.elements.get('stat-shops').textContent, 1);
  assert.equal(fixture.elements.get('stat-users').textContent, 1);
  assert.match(fixture.elements.get('accounts-body').innerHTML, /customer@example.test/);
  assert.match(fixture.elements.get('accounts-body').innerHTML, />Inactive<\/td>/);
  assert.match(fixture.elements.get('all-reviews-body').innerHTML, /&lt;script&gt;/);
  assert.match(fixture.elements.get('all-reviews-body').innerHTML, /Already approved/);
  assert.doesNotMatch(fixture.elements.get('all-reviews-body').innerHTML, /Awaiting store/);
  assert.equal(fixture.elements.get('stat-reported-reviews').textContent, 1);
  assert.equal(fixture.elements.get('stat-approved-reviews').textContent, 1);
  assert.match(fixture.elements.get('accounts-body').innerHTML, /data-account-id="u1"/);
  assert.match(fixture.elements.get('all-reviews-body').innerHTML, /data-review-details="r1"/);
});

test('online account becomes inactive after its last heartbeat expires without a new snapshot', () => {
  const fixture = view();
  let heartbeat = Date.now();
  fixture.emit('stores', [{ id: 'shop', ownerId: 'owner', name: 'Online Shop' }]);
  fixture.emit('users', [{ id: 'owner', role: 'Store Admin', storeId: 'shop', presenceSessions: { device: { toMillis: () => heartbeat } } }]);
  assert.match(fixture.elements.get('accounts-body').innerHTML, />Active<\/td>/);
  // Catalog usage now displays listing counts; account presence belongs in Accounts.
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /Online Shop/);
  assert.doesNotMatch(fixture.elements.get('accounts-body').innerHTML, /Not recorded/);
  const cell = { dataset: { presenceUser: 'owner' }, textContent: 'Active' };
  fixture.presenceCells.push(cell);
  heartbeat -= 96000;
  fixture.refreshPresence();
  assert.equal(cell.textContent, 'Inactive');
});

test('the designated super-admin is excluded from account totals and the account table', () => {
  const fixture = view();
  fixture.emit('users', [
    { id: 'techknow-superadmin', email: 'superadmin@example.test', role: 'Super Admin', presenceSessions: { a: Date.now() } },
    { id: 'customer', email: 'customer@example.test', role: 'Customer' },
  ]);
  assert.equal(fixture.elements.get('stat-users').textContent, 1);
  assert.doesNotMatch(fixture.elements.get('accounts-body').innerHTML, /superadmin@example\.test|Super Admin/);
  assert.match(fixture.elements.get('accounts-body').innerHTML, /customer@example\.test/);
  assert.doesNotMatch(fixture.elements.get('accounts-body').innerHTML, /<th>Shop<\/th>/);
});

test('management rendering requires a session and read errors remain visible', () => {
  const fixture = view();
  assert.throws(() => fixture.mount({ ...fixture.options, session: null }), /validated admin session/);
  fixture.subscriptions.get('users').onError(new Error('Permission denied by database rules'));
  assert.match(fixture.elements.get('platform-notice').textContent, /Permission denied/);
  assert.equal(fixture.elements.get('platform-notice').hidden, false);
});

test('account action waits for modal confirmation and uses the isolated portal Functions instance', async () => {
  const fixture = view();
  fixture.emit('users', [{ id: 'customer', fullName: 'Test Customer', status: 'Active', role: 'Customer' }]);
  const button = { dataset: { accountId: 'customer', action: 'Suspend' }, textContent: 'Suspend' };
  await fixture.listeners.get('main-content:click')({ target: {
    closest: selector => selector === '[data-permit-id]' ? null : button,
  } });
  assert.equal(fixture.functionCalls.length, 0);
  assert.equal(fixture.accountModal().name, 'Test Customer');
  assert.equal(fixture.accountModal().action, 'Suspend');
  await fixture.accountModal().onConfirm('Test moderation reason');
  assert.equal(fixture.functionCalls.length, 1);
  assert.equal(fixture.functionCalls[0].name, 'setPlatformAccountStatus');
  assert.equal(fixture.functionCalls[0].data.uid, 'customer');
  assert.equal(fixture.functionCalls[0].data.action, 'Suspend');
  assert.equal(fixture.functionCalls[0].data.reason, 'Test moderation reason');
  assert.match(fixture.elements.get('accounts-body').innerHTML, /data-action="Restore"/);
});

test('suspended accounts open a Restore modal even when the clicked action is stale', async () => {
  const fixture = view();
  fixture.emit('users', [{ id: 'customer', status: 'Suspended', role: 'Customer' }]);
  const button = { dataset: { accountId: 'customer', action: 'Suspend' } };
  await fixture.listeners.get('main-content:click')({ target: {
    closest: selector => selector === '[data-permit-id]' ? null : button,
  } });
  assert.equal(fixture.accountModal().action, 'Restore');
  await fixture.accountModal().onConfirm('Resolved');
  assert.equal(fixture.functionCalls[0].data.action, 'Restore');
  assert.match(fixture.elements.get('accounts-body').innerHTML, /data-action="Suspend"/);
});

test('account changes while a modal is open block a stale confirmation', async () => {
  const fixture = view();
  fixture.emit('users', [{ id: 'customer', status: 'Active', role: 'Customer' }]);
  const button = { dataset: { accountId: 'customer', action: 'Suspend' } };
  await fixture.listeners.get('main-content:click')({ target: {
    closest: selector => selector === '[data-permit-id]' ? null : button,
  } });
  fixture.emit('users', [{ id: 'customer', status: 'Suspended', role: 'Customer' }]);
  await assert.rejects(fixture.accountModal().onConfirm('Reason'), /account has changed/);
  assert.equal(fixture.functionCalls.length, 0);
});

test('unavailable account service returns an error to the modal without changing the account', async () => {
  const fixture = view();
  fixture.emit('users', [{ id: 'customer', status: 'Active', role: 'Customer' }]);
  fixture.failFunctions({ code: 'functions/not-found' });
  const button = { dataset: { accountId: 'customer', action: 'Suspend' } };
  await fixture.listeners.get('main-content:click')({ target: {
    closest: selector => selector === '[data-permit-id]' ? null : button,
  } });
  await assert.rejects(fixture.accountModal().onConfirm('Reason'), /management service is unavailable/);
  assert.match(fixture.elements.get('accounts-body').innerHTML, /data-action="Suspend"/);
  assert.doesNotMatch(fixture.elements.get('accounts-body').innerHTML, /data-action="Restore"/);
});

function submitLimit(fixture, id, value) {
  const form = { dataset: { limitStore: id }, querySelector: () => ({ value }) };
  return fixture.listeners.get('main-content:submit')({ preventDefault() {}, target: { closest: () => form } });
}

test('store limits save independently, update usage, and support zero and unlimited', async () => {
  const fixture = view();
  fixture.emit('stores', [{ id: 's1', name: 'Shop', productLimit: 10 }, { id: 's2', name: 'Other', productLimit: 30 }]);
  fixture.emit('products', [{ id: 'p1', storeId: 's1', archived: true }]);
  await submitLimit(fixture, 's1', '1');
  assert.equal(fixture.functionCalls[0].name, 'setStoreProductLimit');
  assert.equal(fixture.functionCalls[0].data.storeId, 's1');
  assert.equal(fixture.functionCalls[0].data.productLimit, 1);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /100% · At limit/);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /value="30"/);
  await submitLimit(fixture, 's1', '0');
  assert.equal(fixture.functionCalls[1].data.productLimit, 0);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /New products blocked/);
  await submitLimit(fixture, 's1', '');
  assert.equal(fixture.functionCalls[2].data.productLimit, null);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /Saved: unlimited/);
});

test('invalid limit values never call the server and unsaved drafts survive live updates', async () => {
  const fixture = view();
  fixture.emit('stores', [{ id: 's1', productLimit: 10 }]);
  for (const value of ['-1', '1.5', 'invalid', '9007199254740992']) {
    await submitLimit(fixture, 's1', value);
  }
  assert.equal(fixture.functionCalls.length, 0);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /Enter a whole number/);
  fixture.listeners.get('main-content:input')({ target: { dataset: { limitInput: 's1' }, value: '25' } });
  fixture.emit('products', [{ id: 'p1', storeId: 's1' }]);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /value="25"/);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /10%/);
});

test('failed limit save retains the draft and saved usage for retry', async () => {
  const fixture = view();
  fixture.emit('stores', [{ id: 's1', productLimit: 10 }]);
  fixture.emit('products', [{ id: 'p1', storeId: 's1' }]);
  fixture.failFunctions({ code: 'functions/unavailable' });
  await submitLimit(fixture, 's1', '20');
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /value="20"/);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /limit service is unavailable/);
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /10%/);
  assert.doesNotMatch(fixture.elements.get('shop-usage-body').innerHTML, /disabled|Saved:/);
  fixture.failFunctions(null);
  await submitLimit(fixture, 's1', '20');
  assert.match(fixture.elements.get('shop-usage-body').innerHTML, /5%/);
});

test('a missing callable reported as INTERNAL shows a useful failure and never reports saved', async () => {
  const fixture = view();
  fixture.emit('stores', [{ id: 's1', productLimit: 10 }]);
  fixture.emit('products', [{ id: 'p1', storeId: 's1' }]);
  fixture.failFunctions({ code: 'functions/internal', message: 'internal' });
  await submitLimit(fixture, 's1', '20');
  const html = fixture.elements.get('shop-usage-body').innerHTML;
  assert.match(html, /The limit service is unavailable\. Check deployment and connection, then retry\./);
  assert.match(html, /value="20"/);
  assert.match(html, /10%/);
  assert.doesNotMatch(html, /internal|Saved:|disabled/);
});
