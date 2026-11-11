const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutingService, parseAddressResults, parseRoutes, readSavedRoute, routeIsStale } = require('../services/store-routing.js');
const origin = { latitude: 10.735, longitude: 122.95 };
const destination = { latitude: 10.675, longitude: 122.95, label: 'Fixture Street, Test City', approximate: true };
const store = { id: 'fixture', address: 'Fixture Street & Avenue, Test City', latitude: 1, longitude: 2 };
const addressData = { features: [{ geometry: { type: 'Point', coordinates: [destination.longitude, destination.latitude] },
  properties: { type: 'street', name: 'Fixture Street', city: 'Test City' } }] };
const routeData = { code: 'Ok', waypoints: [{ distance: 10 }, { distance: 8 }], routes: [
  { distance: 8000, duration: 6000, geometry: { type: 'LineString', coordinates: [[122.95, 10.735], [122.96, 10.7], [122.95, 10.675]] },
    legs: [{ summary: 'Fixture Street', steps: [{ distance: 100, name: 'Fixture Street', maneuver: { type: 'turn', modifier: 'left' } }] }] },
  { distance: 7500, duration: 5000, geometry: { type: 'LineString', coordinates: [[122.95, 10.735], [122.96, 10.71], [122.95, 10.675]] }, legs: [] },
] };
const response = value => ({ ok: true, json: async () => value });

test('address resolution excludes city centroids, invalid coordinates and duplicates', () => {
  const features = [...addressData.features, ...addressData.features,
    { geometry: { coordinates: [122.95, 10.67] }, properties: { type: 'city', name: 'Test City' } },
    { geometry: { coordinates: [900, 10] }, properties: { type: 'house', name: 'Invalid' } }];
  const results = parseAddressResults({ features });
  assert.equal(results.length, 1);
  assert.equal(results[0].approximate, true);
  assert.ok(results[0].label.includes('Test City'));
});

test('requests resolve the address first and route to its chosen coordinates with the correct travel profile', async () => {
  const urls = [];
  const service = createRoutingService({ interval: 0, fetchImpl: async url => {
    urls.push(url); return response(url.includes('photon') ? addressData : routeData);
  } });
  const addresses = await service.findAddresses(store);
  const result = await service.getRoutes(origin, addresses[0]);
  assert.equal(new URL(urls[0]).searchParams.get('q'), store.address);
  assert.ok(urls[1].includes('/routed-foot/'));
  assert.ok(urls[1].includes(';122.95,10.675'));
  assert.equal(result.routes[0].durationSeconds, 5000);
  assert.equal(result.routes[1].steps[0].instruction, 'turn left on Fixture Street');
  assert.equal(result.mode, 'walking');
  await service.getRoutes(origin, addresses[0], undefined, 'driving');
  assert.ok(urls[2].includes('router.project-osrm.org'));
});

test('requests are cached and queued rather than repeated on refresh', async () => {
  let calls = 0, clock = 0; const delays = [];
  const service = createRoutingService({ now: () => clock, wait: async delay => { clock += delay; delays.push(delay); },
    fetchImpl: async () => { calls++; return response(addressData); } });
  await Promise.all([service.findAddresses(store), service.findAddresses(store), service.findAddresses({ ...store, address: 'Another fixture address' })]);
  assert.equal(calls, 2);
  assert.ok(delays.every(delay => delay >= 1100));
});

test('missing GPS, unmatched addresses, unavailable service and distant road snaps fail honestly', async () => {
  const service = createRoutingService({ interval: 0, fetchImpl: async () => response({ features: [] }) });
  await assert.rejects(service.getRoutes(null, destination), /location access/);
  await assert.rejects(service.findAddresses({}), /no saved address/);
  await assert.rejects(service.findAddresses(store), /could not be located/);
  const unavailable = createRoutingService({ interval: 0, fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(unavailable.findAddresses(store), /unavailable/);
  const distant = createRoutingService({ interval: 0, fetchImpl: async () => response({ ...routeData, waypoints: [{ distance: 1000 }] }) });
  await assert.rejects(distant.getRoutes(origin, destination), /close enough/);
});

test('invalid routes and cancelled requests cannot become a route', async () => {
  assert.throws(() => parseRoutes({ code: 'NoRoute' }), /No route/);
  assert.throws(() => parseRoutes({ code: 'Ok', routes: [{ distance: 2, duration: 2, geometry: { type: 'LineString', coordinates: [[900, 900], [0, 0]] } }] }), /usable/);
  let fetched = false;
  const service = createRoutingService({ interval: 0, fetchImpl: async () => { fetched = true; return response(routeData); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.getRoutes(origin, destination, controller.signal), /cancelled/);
  assert.equal(fetched, false);
});

test('saved route is stale if the origin moves or GPS is unavailable', () => {
  assert.equal(routeIsStale({ origin }, origin), false);
  assert.equal(routeIsStale({ origin }, { ...origin, latitude: 10.74 }), true);
  assert.equal(routeIsStale({ origin }, null), true);
});

test('saved route validation rejects changed addresses and corrupt cached directions', () => {
  const saved = { address: store.address, origin, destination, mode: 'walking', savedAt: 1000, routes: parseRoutes(routeData) };
  assert.deepEqual(readSavedRoute(JSON.stringify(saved), store.address), saved);
  assert.equal(readSavedRoute(JSON.stringify(saved), 'Changed store address'), null);
  assert.equal(readSavedRoute('{invalid', store.address), null);
  assert.equal(readSavedRoute(JSON.stringify({ ...saved, routes: [{ ...saved.routes[0], durationSeconds: '5000' }] }), store.address), null);
  assert.equal(readSavedRoute(JSON.stringify({ ...saved, routes: [{ ...saved.routes[0], geometry: { type: 'LineString', coordinates: [[900, 900], [0, 0]] } }] }), store.address), null);
});
