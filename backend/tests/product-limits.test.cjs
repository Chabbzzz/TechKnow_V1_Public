const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeStore } = require('./helpers.cjs');
const { createOperations, SUPER_ADMIN_UID } = require('../functions/operations.cjs');
const { createStoreService } = require('../services/admin');
const adminRequest = data => ({ auth: { uid: SUPER_ADMIN_UID, token: { superAdmin: true } }, data });
const product = { name: 'Keyboard', category: 'Peripherals', price: 100, stock: 4, imagePath: null };
function fixture(options) {
  const fake = fakeStore({
    [`users/${SUPER_ADMIN_UID}`]: { role: 'Super Admin', status: 'Active' },
    'users/owner': { role: 'Store Admin', storeId: 's1', status: 'Active' },
    'stores/s1': { ownerId: 'owner', name: 'Alpha Tech Test Store', productLimit: 2 },
    'stores/s2': { ownerId: 'other', productLimit: 20 },
    'products/existing': { storeId: 's1', archived: true },
    'products/foreign': { storeId: 's2' },
  }, options);
  const accounts = new Map([
    [SUPER_ADMIN_UID, { disabled: false, customClaims: { superAdmin: true } }],
    ['owner', { disabled: false }],
  ]);
  const ops = createOperations({ auth: { getUser: async uid => accounts.get(uid) }, db: fake.runtime.db, timestamp: () => 'server-time',
    error: (code, message) => Object.assign(new Error(message), { code }) });
  const calls = [];
  fake.runtime.app = { functions: region => {
    assert.equal(region, 'us-central1');
    return { httpsCallable: name => async data => {
      calls.push({ name, data });
      return { data: await ops[name]({ auth: { uid: fake.runtime.auth.currentUser.uid }, data }) };
    } };
  } };
  return { ...fake, ops, calls, accounts, service: createStoreService(fake.runtime, { uid: 'owner', role: 'Store Admin', storeId: 's1' }) };
}
const products = fake => [...fake.data.entries()].filter(([path, record]) => path.startsWith('products/') && record.storeId === 's1');
const logs = fake => [...fake.data.entries()].filter(([path]) => path.startsWith('auditLogs/'));

test('only the designated super admin with a claim can set a store limit', async () => {
  const fake = fixture();
  for (const auth of [null, { uid: 'owner', token: { superAdmin: true } }, { uid: SUPER_ADMIN_UID, token: {} }]) {
    await assert.rejects(fake.ops.setStoreProductLimit({ auth, data: { storeId: 's1', productLimit: 5 } }), { code: 'permission-denied' });
  }
  assert.equal(fake.data.get('stores/s1').productLimit, 2);
  assert.equal(logs(fake).length, 0);
});

test('limits persist per store with an atomic audit; zero and unlimited are supported', async () => {
  const fake = fixture();
  for (const productLimit of [10, 0, null]) {
    await fake.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit }));
    assert.equal(fake.data.get('stores/s1').productLimit, productLimit);
    assert.equal(fake.data.get('stores/s2').productLimit, 20);
  }
  assert.equal(logs(fake).length, 3);
  assert.equal(logs(fake)[0][1].previousLimit, 2);
  assert.equal(logs(fake)[0][1].productLimit, 10);
  assert.equal(products(fake).length, 1);
  const failure = fixture({ failCommit: true });
  await assert.rejects(failure.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit: 5 })));
  assert.equal(failure.data.get('stores/s1').productLimit, 2);
  assert.equal(logs(failure).length, 0);
});

test('invalid limits and missing stores cannot be saved', async () => {
  const fake = fixture();
  for (const productLimit of [-1, 1.5, '10', undefined, Infinity, Number.MAX_SAFE_INTEGER + 1, true]) {
    await assert.rejects(fake.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit })), { code: 'invalid-argument' });
  }
  await assert.rejects(fake.ops.setStoreProductLimit(adminRequest({ storeId: 'missing', productLimit: 5 })), { code: 'not-found' });
  assert.equal(logs(fake).length, 0);
});

test('product creation uses the portal callable and counts archived products only in that store', async () => {
  const fake = fixture();
  const reference = await fake.service.createProduct({ ...product, storeId: 's2', views: 900 });
  assert.equal(fake.calls[0].name, 'createStoreProduct');
  const record = fake.data.get(reference.path);
  assert.equal(record.storeId, 's1');
  assert.equal(record.storeName, 'Alpha Tech Test Store');
  assert.equal(record.views, 0);
  assert.equal(record.status, 'Low Stock');
  assert.equal(record.imagePath, null);
  await assert.rejects(fake.service.createProduct(product), { code: 'resource-exhausted' });
  assert.equal(products(fake).length, 2);
});

test('product attribution ignores forged shop names and supports legacy store names', async () => {
  const fake = fixture();
  const store = fake.data.get('stores/s1');
  delete store.name;
  store.storeName = 'Alpha Tech Test Store';
  const { productId } = await fake.ops.createStoreProduct({
    auth: { uid: 'owner' },
    data: { ...product, storeId: 's2', storeName: 'Impersonated shop' },
  });
  const record = fake.data.get(`products/${productId}`);
  assert.equal(record.storeId, 's1');
  assert.equal(record.storeName, 'Alpha Tech Test Store');
  await fake.service.updateProduct(productId, { name: 'Updated keyboard', storeName: 'Impersonated shop' });
  assert.equal(fake.data.get(`products/${productId}`).storeName, 'Alpha Tech Test Store');
});

test('simultaneous product additions cannot both take the last slot', async () => {
  const fake = fixture();
  const results = await Promise.allSettled([fake.service.createProduct(product), fake.service.createProduct(product)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(products(fake).length, 2);
});

test('lowering a limit keeps existing products and blocks additions until capacity returns', async () => {
  const fake = fixture();
  await fake.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit: 0 }));
  await assert.rejects(fake.service.createProduct(product), { code: 'resource-exhausted' });
  assert.equal(products(fake).length, 1);
  await fake.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit: 1 }));
  await fake.service.deleteProduct('existing');
  await fake.service.createProduct(product);
  assert.equal(products(fake).length, 1);
  await fake.ops.setStoreProductLimit(adminRequest({ storeId: 's1', productLimit: null }));
  await fake.service.createProduct(product);
  assert.equal(products(fake).length, 2);
});

test('product transaction retries recheck a changed limit and failures leave no partial writes', async () => {
  const fake = fixture({ retryOnce: data => { data.get('stores/s1').productLimit = 0; } });
  await assert.rejects(fake.service.createProduct(product), { code: 'resource-exhausted' });
  assert.equal(products(fake).length, 1);
  const failure = fixture({ failCommit: true });
  await assert.rejects(failure.service.createProduct(product));
  assert.equal(products(failure).length, 1);
  assert.equal(failure.data.get('stores/s1').productUsageUpdatedAt, undefined);
});

test('server rejects unauthenticated, restricted, wrong-role and wrong-owner product creation', async () => {
  const fake = fixture();
  await assert.rejects(fake.ops.createStoreProduct({ data: product }), { code: 'unauthenticated' });
  for (const mutate of [
    f => { f.data.get('users/owner').role = 'Customer'; },
    f => { f.data.get('users/owner').status = 'Suspended'; },
    f => { f.data.get('stores/s1').status = 'Disabled'; },
    f => { f.data.get('stores/s1').ownerId = 'other'; },
    f => { f.accounts.get('owner').disabled = true; },
    f => { f.accounts.get('owner').tokensValidAfterTime = '2026-10-29T00:00:00Z'; },
    f => { f.data.get('users/owner').adminOperationId = 'pending-suspension'; },
  ]) {
    const restricted = fixture(); mutate(restricted);
    await assert.rejects(restricted.service.createProduct(product), { code: 'permission-denied' });
    assert.equal(products(restricted).length, 1);
  }
});

test('server validates product data independently of the client', async () => {
  const fake = fixture();
  for (const changes of [{ name: '' }, { name: 'x'.repeat(201) }, { description: 'x'.repeat(5001) }, { category: null }, { price: -1 }, { stock: 11 }, { stock: 1.5 }, { imageUrl: {} }]) {
    await assert.rejects(fake.ops.createStoreProduct({ auth: { uid: 'owner' }, data: { ...product, ...changes } }), { code: 'invalid-argument' });
  }
  assert.equal(products(fake).length, 1);
});
