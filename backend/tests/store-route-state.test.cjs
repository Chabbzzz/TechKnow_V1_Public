const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const routing = require('../services/store-routing.js');
const A = { id: 'a', address: 'Fixture Street, Test City' }, B = { id: 'b', address: 'Second Fixture Street, Test City' };
const location = { latitude: 10.7, longitude: 122.95 };
const result = { origin: location, destination: { ...location, label: 'Fixture Street' }, mode: 'walking', savedAt: Date.now(),
  routes: [{ id: '0', distanceKm: 1, durationSeconds: 600, geometry: { type: 'LineString', coordinates: [[122.95, 10.7], [122.96, 10.7]] }, steps: [{ instruction: 'Head on Fixture Street', distanceMeters: 1000 }] }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

function harness({ service = {}, saved = new Map(), failSave = false } = {}) {
  const slots = [], effects = [];
  let cursor = 0, args = [A, location], value;
  const react = {
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState: initial => {
      const i = cursor++; slots[i] ||= { value: initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useEffect: (callback, deps) => {
      const i = cursor++;
      if (!slots[i] || deps.some((dep, index) => dep !== slots[i].deps[index])) {
        slots[i]?.cleanup?.(); const entry = slots[i] = { deps };
        effects.push(() => { entry.cleanup = callback(); });
      }
    },
  };
  const mocks = {
    react, 'react-native': { Platform: { OS: 'web' } },
    '@react-native-async-storage/async-storage': {
      getItem: async key => saved.get(key) || null,
      setItem: async (key, item) => { if (failSave) throw new Error('disk full'); saved.set(key, item); },
      removeItem: async key => saved.delete(key),
    },
    '../backend/services/store-routing': { ...routing, createRoutingService: () => service },
  };
  const filename = require('node:path').resolve(__dirname, '../../hooks/useStoreRoute.js');
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'] });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, require: id => { assert.ok(mocks[id], id); return mocks[id]; } });
  const render = (...next) => { if (next.length) args = next; cursor = 0; value = module.exports.useStoreRoute(...args); effects.splice(0).forEach(effect => effect()); return value; };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  return { render, flush, saved, get value() { return value; } };
}

test('offline route restoration keeps directions readable and ignores a changed store address', async () => {
  const saved = new Map([['techknow.route.v1:a', JSON.stringify({ ...result, address: A.address })]]);
  const h = harness({ saved }); h.render(A, null); await h.flush();
  assert.equal(h.value.saved, true); assert.equal(h.value.restored, true); assert.equal(h.value.stale, true);
  assert.equal(h.value.result.routes[0].steps.length, 1);
  h.render({ ...A, address: 'New address' }, null); await h.flush();
  assert.equal(h.value.result, null);
});

test('a slow route for a previous shop cannot overwrite the newly selected shop', async () => {
  const pending = deferred(); let signal;
  const h = harness({ service: { getRoutes: (_, __, requestSignal) => { signal = requestSignal; return pending.promise; } } });
  h.render(); await h.flush();
  const request = h.value.getRoute(result.destination);
  h.render(B, location); await h.flush();
  assert.equal(signal.aborted, true);
  pending.resolve(result); await request; await h.flush();
  assert.equal(h.value.result, null); assert.equal(h.saved.size, 0);
});

test('a failed refresh preserves saved directions and failed storage is disclosed', async () => {
  const saved = new Map([['techknow.route.v1:a', JSON.stringify({ ...result, address: A.address })]]);
  const h = harness({ saved, service: { getRoutes: async () => { throw new Error('No connection'); } } });
  h.render(); await h.flush(); await h.value.getRoute(result.destination); await h.flush();
  assert.equal(h.value.result.routes[0].distanceKm, 1); assert.equal(h.value.error, 'No connection');
  const full = harness({ failSave: true, service: { getRoutes: async () => result } });
  full.render(); await full.flush(); await full.value.getRoute(result.destination); await full.flush();
  assert.equal(full.value.saved, false); assert.match(full.value.error, /could not save/);
});
