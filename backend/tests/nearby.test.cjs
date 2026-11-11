const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceBetweenKm, normalizeCoordinates, rankNearbyStores } = require('../../constants/nearby.js');

const origin = { latitude: 0, longitude: 0 };
const north = (km, id = String(km)) => ({ id, name: id, latitude: km / 6371 * 180 / Math.PI, longitude: 0 });

test('great-circle distances match independent spherical reference cases', () => {
  assert.ok(Math.abs(distanceBetweenKm(origin, { latitude: 0, longitude: 1 }) - 111.1949266446) < 1e-7);
  assert.ok(Math.abs(distanceBetweenKm(origin, { latitude: 90, longitude: 0 }) - 10007.5433980103) < 1e-7);
  assert.equal(distanceBetweenKm(origin, origin), 0);
  assert.ok(Number.isFinite(distanceBetweenKm(origin, { latitude: 0, longitude: 180 })));
  const a = { latitude: 10.6752692, longitude: 122.9526878 };
  const b = { latitude: 10.6681998, longitude: 122.9458233 };
  // Independent unit-vector angle check for the actual shop coordinates.
  const rad = value => value * Math.PI / 180;
  const reference = 6371 * Math.acos(Math.sin(rad(a.latitude)) * Math.sin(rad(b.latitude))
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(a.longitude - b.longitude)));
  assert.ok(Math.abs(distanceBetweenKm(a, b) - reference) < 0.000001);
  assert.ok(Math.abs(distanceBetweenKm(a, b) - distanceBetweenKm(b, a)) < 1e-12);
});

test('shops below 5 km and beyond 10 km stay visible with their actual distances', () => {
  const shops = [north(10.001), north(10), north(4.999), north(5), north(7), north(25)];
  const results = rankNearbyStores(shops, origin);
  assert.deepEqual(results.map(s => s.id), ['4.999', '5', '7', '10', '10.001', '25']);
  assert.equal(results.at(-1).distance, '25.0 km away');
  assert.equal(shops[0].id, '10.001'); // Sorting must not mutate subscribed store data.
});

test('distances and order change with the customer location', () => {
  const shops = [north(8, 'Beta'), north(6, 'Alpha')];
  assert.deepEqual(rankNearbyStores(shops, origin).map(s => s.id), ['Alpha', 'Beta']);
  assert.deepEqual(rankNearbyStores(shops, north(14)).map(s => s.id), ['Beta', 'Alpha']);
  assert.ok(Math.abs(distanceBetweenKm(origin, north(8)) - 8) < 1e-9);
});

test('missing GPS and empty route parameters never become a fabricated location', () => {
  const shops = [north(6)];
  for (const location of [null, undefined, {}, { latitude: '', longitude: '' }, { latitude: ' ', longitude: 0 }]) {
    assert.equal(normalizeCoordinates(location), null);
    const results = rankNearbyStores(shops, location);
    assert.equal(results.length, 1);
    assert.equal(results[0].distanceKm, null);
    assert.equal(results[0].distance, 'Distance unavailable');
  }
  assert.deepEqual(normalizeCoordinates(origin), origin); // Actual zero coordinates remain valid.
});

test('invalid shop coordinates are ignored and valid numeric strings are supported', () => {
  const shops = [north(6), { ...north(7), latitude: 91 }, { ...north(8), longitude: null }];
  assert.deepEqual(rankNearbyStores(shops, origin).map(s => s.id), ['6']);
  assert.deepEqual(normalizeCoordinates({ latitude: ['10.6752692'], longitude: '122.9526878' }), {
    latitude: 10.6752692, longitude: 122.9526878,
  });
});

test('both saved Bacolod stores stay visible from nearby and distant customer positions', () => {
  const shops = [
    { id: 'Alpha', name: 'Alpha', latitude: 10.6752692, longitude: 122.9526878 },
    { id: 'Beta', name: 'Beta', latitude: 10.6681998, longitude: 122.9458233 },
  ];
  const customer = { latitude: 10.735, longitude: 122.95 };
  assert.deepEqual(rankNearbyStores(shops, customer).map(s => s.id), ['Alpha', 'Beta']);
  assert.deepEqual(rankNearbyStores(shops, shops[0]).map(s => s.id), ['Alpha', 'Beta']);
  const distant = rankNearbyStores(shops, { latitude: 10.9, longitude: 122.95 });
  assert.equal(distant.length, 2);
  assert.ok(distant.every(shop => shop.distanceKm > 10));
});
