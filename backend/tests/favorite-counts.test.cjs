const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeStore } = require('./helpers.cjs');
const { createOperations } = require('../functions/operations.cjs');
const { createStoreService } = require('../services/admin');

function fixture() {
  const fake = fakeStore({
    'users/owner': { role: 'Store Admin', storeId: 'shop', status: 'Active' },
    'stores/shop': { ownerId: 'owner', status: 'Active' },
    'products/p1': { storeId: 'shop', name: 'Keyboard', favorites: 999 },
    'products/p2': { storeId: 'shop', name: 'Keyboard', favorites: 999 },
    'products/empty': { storeId: 'shop', favorites: 999 },
    'products/archived': { storeId: 'shop', archived: true },
    'products/foreign': { storeId: 'otherShop' },
    'favorites/customer_p1': { userId: 'customer', productId: 'p1' },
    'favorites/other_p1': { userId: 'other', productId: 'p1' },
    'favorites/customer_p2': { userId: 'customer', productId: 'p2' },
    'favorites/customer_archived': { userId: 'customer', productId: 'archived' },
    'favorites/customer_foreign': { userId: 'customer', productId: 'foreign' },
    'favorites/customer_deleted': { userId: 'customer', productId: 'deleted' },
  });
  const account = { disabled: false };
  const ops = createOperations({ auth: { getUser: async () => account }, db: fake.runtime.db,
    error: (code, message) => Object.assign(new Error(message), { code }) });
  fake.runtime.app = { functions: region => {
    assert.equal(region, 'us-central1');
    return { httpsCallable: name => async data => {
      assert.equal(name, 'getStoreFavoriteCounts');
      return { data: await ops[name]({ auth: { uid: fake.runtime.auth.currentUser.uid }, data }) };
    } };
  } };
  return { ...fake, account, ops, service: createStoreService(fake.runtime, { uid: 'owner', role: 'Store Admin', storeId: 'shop' }) };
}

test('portal counts actual saved favorites by ID, including legacy records without storeId', async () => {
  const fake = fixture();
  assert.deepEqual(await fake.service.getFavoriteCounts(), [
    { productId: 'empty', count: 0 }, { productId: 'p1', count: 2 }, { productId: 'p2', count: 1 },
  ]);
  fake.data.delete('favorites/other_p1');
  fake.data.set('favorites/other_p2', { userId: 'other', productId: 'p2' });
  assert.deepEqual(await fake.service.getFavoriteCounts(), [
    { productId: 'empty', count: 0 }, { productId: 'p1', count: 1 }, { productId: 'p2', count: 2 },
  ]);
});

test('callers cannot choose another store or receive customer records', async () => {
  const { ops } = fixture();
  const result = await ops.getStoreFavoriteCounts({ auth: { uid: 'owner' }, data: { storeId: 'otherShop', productIds: ['foreign'] } });
  assert.equal(result.counts.some(item => item.productId === 'foreign'), false);
  for (const item of result.counts) assert.deepEqual(Object.keys(item).sort(), ['count', 'productId']);
});

test('favorite analytics rejects signed-out, revoked, restricted, and non-owner sessions', async () => {
  await assert.rejects(fixture().ops.getStoreFavoriteCounts({}), { code: 'unauthenticated' });
  for (const mutate of [
    fake => { fake.account.disabled = true; },
    fake => { fake.account.tokensValidAfterTime = '2026-11-01T00:00:00Z'; },
    fake => fake.data.delete('users/owner'),
    fake => fake.data.set('users/owner', { role: 'Customer', storeId: 'shop' }),
    fake => { fake.data.get('users/owner').status = 'Suspended'; },
    fake => { fake.data.get('users/owner').adminOperationId = 'pending'; },
    fake => fake.data.delete('stores/shop'),
    fake => { fake.data.get('stores/shop').status = 'Disabled'; },
    fake => { fake.data.get('stores/shop').adminOperationId = 'pending'; },
    fake => { fake.data.get('stores/shop').ownerId = 'someone-else'; },
  ]) {
    const fake = fixture();
    mutate(fake);
    await assert.rejects(fake.ops.getStoreFavoriteCounts({ auth: { uid: 'owner' } }), { code: 'permission-denied' });
  }
  const fake = fixture();
  fake.runtime.auth.currentUser = null;
  await assert.rejects(fake.service.getFavoriteCounts(), { code: 'permission-denied' });
});

test('empty catalogs return no counts and query failures are not converted to zero', async () => {
  const fake = fixture();
  for (const key of fake.data.keys()) if (key.startsWith('products/')) fake.data.delete(key);
  assert.deepEqual(await fake.service.getFavoriteCounts(), []);
  fake.data.set('products/p1', { storeId: 'shop' });
  const collection = fake.runtime.db.collection;
  fake.runtime.db.collection = name => {
    if (name === 'favorites') throw new Error('Database unavailable');
    return collection(name);
  };
  await assert.rejects(fake.service.getFavoriteCounts(), /Database unavailable/);
});
