const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const nearby = require('../../constants/nearby.js');
const filename = require('node:path').resolve(__dirname, '../services/current-location.js');
const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
});
const flush = () => new Promise(resolve => setImmediate(resolve));

function session(overrides = {}, initialLocation = null, { requestEnableServices } = {}) {
  const timers = new Map();
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Date,
    require: id => { assert.equal(id, '../../constants/nearby'); return nearby; },
    setTimeout: (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  }, { filename });
  const locations = [], messages = [], statuses = [];
  let receive, fail, removed = 0, watches = 0, options;
  const provider = {
    Accuracy: { Highest: 6 },
    requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    hasServicesEnabledAsync: async () => true,
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => null,
    watchPositionAsync: async (settings, callback, error) => {
      watches++; options = settings; receive = callback; fail = error;
      return { remove: () => { removed++; } };
    },
    ...overrides,
  };
  const stop = module.exports.subscribeToCurrentLocation({
    provider, initialLocation,
    onLocation: value => locations.push(value),
    onMessage: value => messages.push(value),
    onStatus: value => statuses.push(value),
    requestEnableServices,
  });
  return {
    locations, messages, statuses, timers, stop, normalize: module.exports.normalizeLocationReading,
    emit: value => receive(value), fail: () => fail('GPS failed'),
    get removed() { return removed; }, get watches() { return watches; }, get options() { return options; },
  };
}
const fix = (latitude, accuracy = 12, timestamp = Date.now()) => ({
  coords: { latitude, longitude: 122.95, accuracy }, timestamp,
});

test('live GPS replaces the initial fix, keeps accuracy, and updates calculated distances', async () => {
  const s = session();
  await flush();
  assert.equal(s.options.accuracy, 6);
  s.emit(fix(10.735));
  const first = s.locations.at(-1);
  assert.equal(first.accuracy, 12);
  const shop = { latitude: 10.6752692, longitude: 122.9526878 };
  s.emit(fix(10.69, 7, Date.now() + 1));
  assert.ok(nearby.distanceBetweenKm(s.locations.at(-1), shop) < nearby.distanceBetweenKm(first, shop));
  assert.match(s.messages.at(-1), /7 m/);
  s.stop();
  assert.equal(s.removed, 1);
  const count = s.locations.length;
  s.emit(fix(10.7));
  assert.equal(s.locations.length, count);
  assert.equal(s.timers.size, 0);
});

test('denied permission clears any passed location and starts no GPS subscription', async () => {
  const s = session({ requestForegroundPermissionsAsync: async () => ({ status: 'denied' }) },
    { latitude: 10.7, longitude: 122.95, timestamp: Date.now(), accuracy: 10 });
  await flush();
  assert.equal(s.locations.at(-1), null);
  assert.equal(s.watches, 0);
  assert.match(s.messages.at(-1), /Allow location access/);
  assert.equal(s.timers.size, 0);
  s.stop();
});

test('a failed cached-location lookup does not prevent live GPS', async () => {
  const s = session({ getLastKnownPositionAsync: async () => { throw new Error('cache failed'); } });
  await flush();
  assert.equal(s.watches, 1);
  s.emit(fix(10.7));
  assert.equal(s.locations.at(-1).latitude, 10.7);
  s.stop();
});

test('stale, invalid and out-of-order fixes never replace a newer reading', async () => {
  const s = session();
  await flush();
  s.emit(fix(10.7, 8));
  const fresh = s.locations.at(-1);
  s.emit(fix(10.8, 8, fresh.timestamp - 1000));
  s.emit(fix(10.8, 8, Date.now() - 61000));
  s.emit(fix(91));
  assert.equal(s.locations.at(-1), fresh);
  const expiry = [...s.timers.values()].find(timer => timer.delay > 15000);
  assert.ok(expiry);
  expiry.callback();
  assert.equal(s.locations.at(-1), null);
  assert.match(s.messages.at(-1), /expired/);
  s.stop();
});

test('poor GPS accuracy is disclosed and service errors clear distances', async () => {
  const s = session();
  await flush();
  s.emit(fix(10.7, 1800));
  assert.match(s.messages.at(-1), /1800 m.*Approximate/);
  s.fail();
  assert.equal(s.locations.at(-1), null);
  assert.equal(s.timers.size, 0);
  s.stop();
});

test('disabled location services never start a GPS watch', async () => {
  const s = session({ hasServicesEnabledAsync: async () => false });
  await flush();
  assert.equal(s.watches, 0);
  assert.equal(s.locations.at(-1), null);
  assert.match(s.messages.at(-1), /Turn on location services/);
  assert.equal(s.statuses.at(-1), 'services-disabled');
  s.stop();
});

test('opening the map with location off can enable services and obtain a native fix', async () => {
  let enabled = false, prompts = 0, currentRequests = 0;
  const s = session({
    hasServicesEnabledAsync: async () => enabled,
    getCurrentPositionAsync: async () => { currentRequests++; return fix(10.735); },
  }, null, { requestEnableServices: async () => { prompts++; enabled = true; } });
  await flush();
  assert.equal(prompts, 1);
  assert.equal(currentRequests, 1);
  assert.equal(s.watches, 1);
  assert.equal(s.locations.at(-1).latitude, 10.735);
  assert.equal(s.statuses.at(-1), 'ready');
  s.stop();
});

test('cancelling the enable-location dialog leaves a recoverable disabled state', async () => {
  const s = session({ hasServicesEnabledAsync: async () => false }, null, {
    requestEnableServices: async () => { throw new Error('User cancelled'); },
  });
  await flush();
  assert.equal(s.watches, 0);
  assert.equal(s.locations.at(-1), null);
  assert.equal(s.statuses.at(-1), 'services-disabled');
  assert.equal(s.timers.size, 0);
  s.stop();
});

test('permanently denied permission requests settings instead of starting GPS', async () => {
  const s = session({ requestForegroundPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }) });
  await flush();
  assert.equal(s.statuses.at(-1), 'permission-blocked');
  assert.equal(s.watches, 0);
  s.stop();
});

test('globally disabled location services take priority over iOS permission denial', async () => {
  const s = session({
    requestForegroundPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }),
    hasServicesEnabledAsync: async () => false,
  });
  await flush();
  assert.equal(s.statuses.at(-1), 'services-disabled');
  assert.equal(s.watches, 0);
  s.stop();
});

test('a slow one-shot fix does not delay the live watch and cannot update after leaving the map', async () => {
  let resolveCurrent;
  const s = session({ getCurrentPositionAsync: () => new Promise(resolve => { resolveCurrent = resolve; }) });
  await flush();
  assert.equal(s.watches, 1);
  s.emit(fix(10.7));
  assert.equal(s.locations.at(-1).latitude, 10.7);
  s.stop();
  const count = s.locations.length;
  resolveCurrent(fix(10.8));
  await flush();
  assert.equal(s.locations.length, count);
  assert.equal(s.timers.size, 0);
});

test('a failed one-shot fix does not prevent live GPS recovery', async () => {
  const s = session({ getCurrentPositionAsync: async () => { throw new Error('GPS timeout'); } });
  await flush();
  assert.equal(s.watches, 1);
  s.emit(fix(10.7));
  assert.equal(s.locations.at(-1).latitude, 10.7);
  assert.equal(s.statuses.at(-1), 'ready');
  s.stop();
});

test('leaving the map during the enable-location prompt cancels subsequent GPS work', async () => {
  let finishPrompt;
  const s = session({ hasServicesEnabledAsync: async () => false }, null, {
    requestEnableServices: () => new Promise(resolve => { finishPrompt = resolve; }),
  });
  await flush();
  assert.equal(s.statuses.at(-1), 'enabling-services');
  s.stop();
  finishPrompt();
  await flush();
  assert.equal(s.watches, 0);
  assert.equal(s.timers.size, 0);
});

test('a subscription that finishes after navigation away is removed immediately', async () => {
  let resolveWatch, removed = 0;
  const s = session({ watchPositionAsync: () => new Promise(resolve => { resolveWatch = resolve; }) });
  await flush();
  s.stop();
  resolveWatch({ remove: () => removed++ });
  await flush();
  assert.equal(removed, 1);
  assert.equal(s.timers.size, 0);
});

test('old or incomplete navigation parameters cannot masquerade as current GPS', () => {
  const s = session();
  const now = Date.now();
  assert.equal(s.normalize({ latitude: 10.7, longitude: 122.95 }), null);
  assert.equal(s.normalize({ latitude: 10.7, longitude: 122.95, timestamp: now - 61000 }), null);
  const parsed = s.normalize({ latitude: ['10.7'], longitude: '122.95', timestamp: String(now), accuracy: '8' });
  assert.equal(parsed.accuracy, 8);
  assert.equal(parsed.latitude, 10.7);
  s.stop();
});
