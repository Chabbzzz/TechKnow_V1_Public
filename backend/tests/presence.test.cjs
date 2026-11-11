const test = require('node:test');
const assert = require('node:assert/strict');
const { accountStatus, storeStatus, createWriter, createTracker, EXPIRES_MS } = require('../services/presence');
const now = Date.parse('2026-10-26T12:00:00Z');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('missing, legacy, stale and invalid presence all display Inactive', () => {
  for (const user of [null, {}, { status: 'Active' }, { presenceSessions: { a: null } },
    { presenceSessions: { a: now - EXPIRES_MS } }, { presenceSessions: { a: now + 60000 } }]) {
    assert.equal(accountStatus(user, now), 'Inactive');
  }
});

test('any live device keeps an account Active, but restricted accounts are Inactive', () => {
  const presenceSessions = { old: now - EXPIRES_MS, online: { toMillis: () => now } };
  assert.equal(accountStatus({ presenceSessions }, now), 'Active');
  assert.equal(accountStatus({ presenceSessions: { online: new Date(now).toISOString() } }, now), 'Active');
  for (const status of ['Suspended', 'Disabled', 'Banned']) {
    assert.equal(accountStatus({ status, presenceSessions }, now), 'Inactive');
  }
});

test('shop presence follows its owner or assigned store admin, never an unrelated user', () => {
  const user = { id: 'owner', role: 'Store Admin', storeId: 'shop', presenceSessions: { a: now } };
  assert.equal(storeStatus({ id: 'shop', ownerUid: 'owner' }, [user], now), 'Active');
  assert.equal(storeStatus({ id: 'shop' }, [user], now), 'Active');
  assert.equal(storeStatus({ id: 'another' }, [user], now), 'Inactive');
  assert.equal(storeStatus({ id: 'shop', status: 'Suspended' }, [user], now), 'Inactive');
});

test('heartbeat and logout only change presence fields and preserve other live devices', async () => {
  let changes;
  const profile = { status: 'Active', role: 'Customer', presenceSessions: { other: now, expired: now - EXPIRES_MS } };
  const write = createWriter({
    reference: uid => uid, now: () => now, timestamp: () => 'server-time', remove: () => 'delete-field',
    transaction: callback => callback({
      get: async ref => { assert.equal(ref, 'user'); return { exists: () => true, data: () => profile }; },
      update: (_ref, fields) => { changes = fields; },
    }),
  });
  await write('user', 'thisDevice', true);
  assert.deepEqual(changes, { 'presenceSessions.expired': 'delete-field', 'presenceSessions.thisDevice': 'server-time' });
  await write('user', 'thisDevice', false);
  assert.equal(changes['presenceSessions.thisDevice'], 'delete-field');
  assert.equal(Object.hasOwn(changes, 'presenceSessions.other'), false);
  assert.equal(Object.hasOwn(changes, 'status'), false);
  profile.status = 'Suspended';
  await write('user', 'thisDevice', true);
  assert.equal(changes['presenceSessions.thisDevice'], 'delete-field');
});

test('heartbeat never creates a missing user profile', async () => {
  const write = createWriter({
    reference: uid => uid, timestamp: () => now, remove: () => null,
    transaction: callback => callback({
      get: async () => ({ exists: false }),
      update: () => assert.fail('Must not create or update a missing profile'),
    }),
  });
  await write('new-user', 'device', true);
});

function trackerFixture(write) {
  const calls = [];
  let beat;
  let cancelled = false;
  const tracker = createTracker({
    sessionId: 'device', write: write || (async (...args) => { calls.push(args); }), report: () => {},
    every: callback => { beat = callback; return 1; }, cancel: () => { cancelled = true; },
  });
  return { tracker, calls, beat: () => beat(), cancelled: () => cancelled };
}

test('login, heartbeat, background, resume and logout publish the correct session state', async () => {
  const { tracker, calls, beat, cancelled } = trackerFixture();
  tracker.setUser({ uid: 'customer' });
  await flush();
  beat();
  await flush();
  tracker.setAvailable(false);
  await flush();
  beat();
  await flush();
  assert.equal(calls.length, 3); // No heartbeat while backgrounded/offline.
  tracker.setAvailable(true);
  await flush();
  await tracker.leave();
  assert.deepEqual(calls.map(call => call[2]), [true, true, false, true, false]);
  await tracker.dispose();
  assert.equal(cancelled(), true);
  beat();
  assert.equal(calls.length, 5);
});

test('account switch removes the old session before activating the new user', async () => {
  const { tracker, calls } = trackerFixture();
  tracker.setUser({ uid: 'first' });
  tracker.setUser({ uid: 'second' });
  await flush();
  assert.deepEqual(calls, [['first', 'device', true], ['first', 'device', false], ['second', 'device', true]]);
  await tracker.dispose();
});

test('failed writes retry on the next heartbeat and do not block logout', async () => {
  let attempts = 0;
  const { tracker, beat } = trackerFixture(async () => { attempts++; throw new Error('Offline'); });
  tracker.setUser({ uid: 'customer' });
  await flush();
  beat();
  await flush();
  assert.equal(attempts, 2);
  await tracker.leave();
  assert.equal(attempts, 3);
  await tracker.dispose();
});

test('slow heartbeats do not pile up duplicate writes', async () => {
  let resolve;
  let calls = 0;
  const { tracker, beat } = trackerFixture(() => {
    calls++;
    return new Promise(done => { resolve = done; });
  });
  tracker.setUser({ uid: 'customer' });
  await flush();
  beat(); beat(); beat();
  assert.equal(calls, 1);
  resolve();
  await flush();
  const leaving = tracker.dispose();
  await flush();
  resolve();
  await leaving;
});
