const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakeStore } = require('./helpers.cjs');
const { createCustomerReservationCreator } = require('../functions/customer-reservations.cjs');
const { createReservationExpiration } = require('../functions/reservation-expiration.cjs');
const { HOLD_DURATION_MS, PENDING_STATUSES, timestampMillis } = require('../functions/reservation-policy.cjs');

const NOW = Date.UTC(2026, 10, 1, 12);
const old = new Date(NOW - HOLD_DURATION_MS);
const reservation = (changes = {}) => ({ userId: 'customer', storeId: 's1', productId: 'p1',
  status: 'Pending', stockAdjusted: false, quantity: 1, createdAt: old, ...changes });
const pending = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) =>
  [`reservations/r${i}`, reservation({ productId: `previous-${i}` })]));

function fixture(records = {}, options) {
  const fake = fakeStore({
    'users/customer': { role: 'Customer', status: 'Active' },
    'users/other': { role: 'Customer', status: 'Active' },
    'products/p1': { name: 'Keyboard', storeId: 's1', stock: 2, price: 500, reservationCount: 0 },
    'products/p2': { name: 'Mouse', storeId: 's1', stock: 0, price: 100, reservationCount: 0 },
    'stores/s1': { name: 'Computer Shop' },
    ...records,
  }, options);
  const logs = [];
  const dependencies = { db: fake.runtime.db, timestamp: () => new Date(NOW), now: () => NOW,
    error: (code, message) => Object.assign(new Error(message), { code }),
    log: { error: (...args) => logs.push(args), info() {} } };
  const handler = createCustomerReservationCreator(dependencies);
  const create = (uid = 'customer', data = {}) => handler({
    auth: { uid, token: { email: `${uid}@example.test` } },
    data: { productId: 'p1', storeId: 's1', ...data },
  });
  return { ...fake, create, handler, logs,
    expire: createReservationExpiration(dependencies).expireUnclaimedReservations };
}

const active = (fake, uid = 'customer') => [...fake.data.entries()]
  .filter(([key, value]) => key.startsWith('reservations/') && value.userId === uid && PENDING_STATUSES.includes(value.status));

test('repeat taps cannot create a second active reservation or waiting-list entry for the same item', async () => {
  for (const productId of ['p1', 'p2']) {
    const fake = fixture();
    const first = await fake.create('customer', { productId });
    const before = structuredClone([...fake.data]);
    await assert.rejects(fake.create('customer', { productId }), { code: 'already-exists' });
    assert.deepEqual([...fake.data], before);
    assert.equal(fake.data.get(`reservations/${first.reservationId}`).status,
      productId === 'p2' ? 'Waiting List' : 'Pending');
  }
});

test('concurrent taps and existing accepted reservations cannot create duplicate active requests', async () => {
  const fake = fixture();
  const outcomes = await Promise.allSettled([fake.create(), fake.create()]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'already-exists');
  const saved = active(fake);
  assert.equal(saved.length, 1);
  fake.data.get(saved[0][0]).status = 'Accepted';
  await assert.rejects(fake.create(), { code: 'already-exists' });
  fake.data.get(saved[0][0]).status = 'Completed';
  await assert.doesNotReject(fake.create());
});

test('fifth pending request succeeds; sixth is rejected without writing inventory or a reservation', async () => {
  const fake = fixture(pending(4));
  await fake.create();
  const before = structuredClone([...fake.data]);
  await assert.rejects(fake.create('customer', { productId: 'p2' }), { code: 'resource-exhausted' });
  assert.deepEqual([...fake.data], before);
  assert.equal(active(fake).length, 5);
});

test('existing users already over the cap are blocked, including waiting-list and lowercase legacy statuses', async () => {
  const records = pending(8);
  records['reservations/r0'].status = 'Waiting List';
  records['reservations/r1'].status = 'pending';
  records['reservations/r2'].status = 'waitlisted';
  const fake = fixture(records);
  await assert.rejects(fake.create(), { code: 'resource-exhausted' });
  assert.equal(active(fake).length, 8);
});

test('accepted, rejected, and canceled statuses each release exactly one slot', async () => {
  for (const status of ['Accepted', 'Rejected', 'Cancelled', 'Canceled']) {
    const fake = fixture(pending(5));
    await assert.rejects(fake.create(), { code: 'resource-exhausted' });
    fake.data.get('reservations/r0').status = status;
    await fake.create();
    assert.equal(active(fake).length, 5);
    await assert.rejects(fake.create('customer', { productId: 'p2' }), { code: 'resource-exhausted' });
  }
});

test('capacity is per authenticated customer; request data cannot select another user', async () => {
  const fake = fixture(pending(5));
  const saved = await fake.create('other', { userId: 'customer', productId: 'p2' });
  const record = fake.data.get(`reservations/${saved.reservationId}`);
  assert.equal(record.userId, 'other');
  assert.equal(record.status, 'Waiting List');
  assert.equal(saved.waitlisted, true);
  assert.equal(active(fake, 'other').length, 1);
  await assert.rejects(fake.create('customer', { userId: 'other' }), { code: 'resource-exhausted' });
});

test('simultaneous submissions for different products admit one request under serialized transactions', async () => {
  const fake = fixture(pending(4));
  const outcomes = await Promise.allSettled([fake.create(), fake.create('customer', { productId: 'p2' })]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'resource-exhausted');
  assert.equal(active(fake).length, 5);
  assert.ok(fake.data.has('reservationLimits/customer'));
});

test('transaction retry rechecks the pending cap against newly committed requests', async () => {
  const fake = fixture(pending(4), { retryOnce(data) { data.set('reservations/concurrent', reservation({ productId: 'another-product' })); } });
  await assert.rejects(fake.create(), { code: 'resource-exhausted' });
  assert.equal(active(fake).length, 5);
  assert.equal(fake.data.get('products/p1').reservationCount, 0);
  assert.equal(fake.data.has('reservationLimits/customer'), false);
});

test('unauthenticated and restricted customers cannot create requests', async () => {
  const fake = fixture();
  await assert.rejects(fake.handler({ data: {} }), { code: 'unauthenticated' });
  fake.data.get('users/customer').status = 'Suspended';
  await assert.rejects(fake.create(), { code: 'permission-denied' });
  assert.equal(active(fake).length, 0);
});

test('pending and waiting requests expire at 24 hours from creation, without adding stock', async () => {
  const fake = fixture({
    'reservations/pending': reservation(),
    'reservations/waiting': reservation({ status: 'Waiting List', productId: 'p2' }),
    'reservations/recent': reservation({ createdAt: new Date(NOW - HOLD_DURATION_MS + 1) }),
  });
  assert.equal(await fake.expire(), 2);
  assert.equal(fake.data.get('reservations/pending').status, 'Rejected');
  assert.equal(fake.data.get('reservations/pending').rejectionReason, 'unclaimed-after-24-hours');
  assert.ok(fake.data.get('reservations/pending').rejectedAt);
  assert.equal(fake.data.get('reservations/waiting').status, 'Rejected');
  assert.equal(fake.data.get('reservations/recent').status, 'Pending');
  assert.equal(fake.data.get('products/p1').stock, 2);
  assert.equal(fake.data.get('products/p2').stock, 0);
  assert.equal(await fake.expire(), 0);
});

test('acceptance does not restart the timer; unclaimed stock is restored once across overlapping runs', async () => {
  const fake = fixture({ 'reservations/accepted': reservation({ status: 'Accepted', stockAdjusted: true,
    acceptedAt: new Date(NOW - 1000) }) });
  const counts = await Promise.all([fake.expire(), fake.expire()]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 1);
  assert.equal(fake.data.get('products/p1').stock, 3);
  assert.equal(fake.data.get('products/p1').status, 'Low Stock');
  assert.equal(fake.data.get('reservations/accepted').status, 'Rejected');
  assert.equal(fake.data.get('reservations/accepted').stockAdjusted, false);
  assert.equal(await fake.expire(), 0);
  assert.equal(fake.data.get('products/p1').stock, 3);
});

test('completed, rejected, and canceled records are never expired or restocked', async () => {
  const records = Object.fromEntries(['Completed', 'Rejected', 'Cancelled', 'Canceled'].map(status =>
    [`reservations/${status}`, reservation({ status, stockAdjusted: true })]));
  const fake = fixture(records);
  assert.equal(await fake.expire(), 0);
  assert.equal(fake.data.get('products/p1').stock, 2);
});

test('a pickup committed during expiry wins when the expiration transaction retries', async () => {
  const fake = fixture({ 'reservations/r1': reservation({ status: 'Accepted', stockAdjusted: true }) }, {
    retryOnce(data) { data.get('reservations/r1').status = 'Completed'; },
  });
  assert.equal(await fake.expire(), 0);
  assert.equal(fake.data.get('reservations/r1').status, 'Completed');
  assert.equal(fake.data.get('products/p1').stock, 2);
});

test('failed commits do not reject a reservation or restore stock partially', async () => {
  const fake = fixture({ 'reservations/r1': reservation({ status: 'Accepted', stockAdjusted: true }) }, { failCommit: true });
  assert.equal(await fake.expire(), 0);
  assert.equal(fake.logs.length, 1);
  assert.equal(fake.data.get('reservations/r1').status, 'Accepted');
  assert.equal(fake.data.get('products/p1').stock, 2);
});

test('deleted products do not prevent expiry; missing held inventory is recorded without recreating a product', async () => {
  const fake = fixture({
    'reservations/pending': reservation({ productId: 'deleted' }),
    'reservations/accepted': reservation({ productId: 'deleted', status: 'Accepted', stockAdjusted: true }),
  });
  assert.equal(await fake.expire(), 2);
  assert.equal(fake.data.has('products/deleted'), false);
  assert.equal(fake.data.get('reservations/accepted').stockRestorationIssue, 'product-missing');
});

test('expiry paginates past more than 100 records and continues after an invalid record', async () => {
  const records = pending(102);
  records['reservations/0000-broken'] = reservation({ status: 'Accepted', stockAdjusted: true, storeId: 'wrong-store' });
  const fake = fixture(records);
  assert.equal(await fake.expire(), 102);
  assert.equal(fake.logs.length, 1);
  assert.equal(fake.data.get('reservations/0000-broken').status, 'Accepted');
  assert.equal(active(fake).length, 0);
  assert.equal(fake.data.get('products/p1').stock, 2);
});

test('automatic rejection releases capacity for another reservation', async () => {
  const fake = fixture(pending(5));
  await assert.rejects(fake.create(), { code: 'resource-exhausted' });
  assert.equal(await fake.expire(), 5);
  await fake.create();
  assert.equal(active(fake).length, 1);
});

test('packaged policy matches shared source and invalid timestamps cannot be treated as expired', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../functions/shared/reservations.cjs'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../domain/reservations.js'), 'utf8'));
  assert.equal(timestampMillis({ seconds: 123, nanoseconds: 500000000 }), 123500);
  for (const value of [null, undefined, {}, 'invalid']) assert.ok(Number.isNaN(timestampMillis(value)));
});
