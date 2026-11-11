const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const nearby = require('../../constants/nearby.js');
const origin = { latitude: 10.7, longitude: 122.95 };
const shops = [{ id: 'a', latitude: 10.76, longitude: 122.95 }, { id: 'b', latitude: 10.77, longitude: 122.95 }];
const result = { routes: [{ id: '0', distanceKm: 8, durationSeconds: 500, geometry: { type: 'LineString', coordinates: [[122.95, 10.7], [122.95, 10.76]] } }] };

function harness(service) {
  const slots = [], effects = [];
  let cursor = 0, args = [origin, shops];
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; slots[i] ||= { value: initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, index) => dep !== slots[i].deps[index])) slots[i] = { deps, callback }; return slots[i].callback; },
  };
  const focus = callback => { const i = cursor++; if (slots[i]?.callback !== callback) { slots[i]?.cleanup?.(); const entry = slots[i] = { callback }; effects.push(() => { entry.cleanup = callback(); }); } };
  const mocks = { react, 'expo-router': { useFocusEffect: focus }, '../constants/nearby': nearby,
    '../backend/services/store-routing': { createRoutingService: () => service } };
  const filename = require('node:path').resolve(__dirname, '../../hooks/useNearbyShopRoutes.js');
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, require: id => mocks[id] });
  const render = (...next) => { if (next.length) args = next; cursor = 0; const value = module.exports.useNearbyShopRoutes(...args); effects.splice(0).forEach(effect => effect()); return value; };
  return { render, flush: async () => { await new Promise(resolve => setImmediate(resolve)); return render(); } };
}

test('each shop receives a driving route and one failure does not hide the other shop', async () => {
  const calls = [];
  const h = harness({ getRoutes: async (from, shop, signal, mode) => {
    calls.push({ from, shop, mode }); if (shop.id === 'a') throw new Error('Offline'); return result;
  } });
  h.render();
  const value = await h.flush();
  assert.equal(value.routes.a.status, 'error');
  assert.equal(value.routes.b.status, 'ready');
  assert.deepEqual(calls.map(call => call.mode), ['driving', 'driving']);
  h.render({ ...origin, latitude: 10.70001 }, [...shops].reverse());
  await h.flush();
  assert.equal(calls.length, 2, 'GPS jitter and sort changes do not refetch');
});

test('losing location aborts pending routes and late results remain hidden', async () => {
  let finish, signal;
  const h = harness({ getRoutes: (from, shop, requestSignal) => { signal = requestSignal; return new Promise(resolve => { finish = resolve; }); } });
  h.render();
  const value = h.render(null, []);
  assert.equal(signal.aborted, true);
  assert.equal(Object.keys(value.routes).length, 0);
  finish(result);
  assert.equal(Object.keys((await h.flush()).routes).length, 0);
});

test('moving beyond 100 m clears old routes and routes again from the new position', async () => {
  const origins = [];
  const h = harness({ getRoutes: async from => { origins.push(from.latitude); return result; } });
  h.render(); await h.flush();
  const moved = h.render({ ...origin, latitude: 10.702 }, shops);
  assert.equal(Object.keys(moved.routes).length, 0);
  await h.flush();
  assert.deepEqual(origins, [10.7, 10.7, 10.702, 10.702]);
});
