const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { mapPayload, storeMapDocument, scriptJson } = require('../../constants/store-map-document.js');
const { nearbyShopsInRange, distanceBetweenKm } = require('../../constants/nearby.js');
const origin = { latitude: 0, longitude: 0 };
const north = km => ({ id: String(km), name: `Shop ${km}`, latitude: km / 6371 * 180 / Math.PI, longitude: 0 });

test('nearby range includes exactly 5 and 10 km and excludes shops outside both bounds', () => {
  const shops = [4.999, 5, 7, 10, 10.001].map(north);
  assert.deepEqual(nearbyShopsInRange(shops, origin).map(shop => shop.id), ['5', '7', '10']);
  assert.equal(nearbyShopsInRange([north(1), north(11)], origin).length, 0);
  assert.equal(nearbyShopsInRange(shops, null).length, 0);
  assert.deepEqual(nearbyShopsInRange(shops, north(15)).map(shop => shop.id), ['10', '7', '5']);
});

test('native store coordinates reach Leaflet for distance filtering', () => {
  const payload = mapPayload(origin, [north(1), north(6), north(8), north(12)]);
  assert.deepEqual(payload.shops.map(shop => shop.id), ['1', '6', '8', '12']);
  assert.equal(payload.shops[1].lat, north(6).latitude);
  assert.equal(payload.shops[1].lng, 0);
});

test('missing GPS stays absent and stores without coordinates never become pins', () => {
  assert.equal(mapPayload(null, [north(6)]).location, null);
  const payload = mapPayload(origin, [north(6), { id: 'address', name: 'Address only', address: 'Street' }]);
  assert.equal(payload.shops.length, 1);
  assert.equal(payload.shops[0].id, '6');
});

// Run the actual generated document with a small Leaflet surface. The routing
// library is deliberately absent until enableRouting() is called.
function mapFrame(html = storeMapDocument()) {
  const state = { maps: 0, tiles: 0, pins: [], userPins: 0, messages: [], scripts: [] };
  const nodes = { map: {}, legend: {}, fit: {} };
  const map = {
    removeControl: () => { state.route = null; },
    setView: point => { state.view = point; },
    fitBounds: points => { state.bounds = points; },
    invalidateSize: () => {},
  };
  const layers = {
    addTo: () => layers,
    clearLayers: () => { state.pins = []; state.userPins = 0; },
  };
  const pin = (point, user) => {
    const marker = {
      addTo: () => { if (user) state.userPins++; else state.pins.push(point); return marker; },
      bindTooltip: () => marker,
    };
    return marker;
  };
  const L = {
    map: (_id, options) => { state.maps++; state.initial = options; return map; },
    control: { zoom: () => ({ addTo() {} }), scale: () => ({ addTo() {} }) },
    layerGroup: () => layers,
    tileLayer: () => {
      const tiles = { on: () => tiles, addTo: () => { state.tiles++; return tiles; } };
      return tiles;
    },
    circleMarker: point => pin(point, true), marker: point => pin(point, false), divIcon: options => options,
    latLng: (lat, lng) => ({ lat, lng, distanceTo: other => distanceBetweenKm(
      { latitude: lat, longitude: lng }, { latitude: other.lat, longitude: other.lng },
    ) * 1000 }),
  };
  const context = {
    L, ReactNativeWebView: { postMessage: message => state.messages.push(JSON.parse(message)) },
    addEventListener() {}, ResizeObserver: function () { this.observe = () => {}; },
    document: {
      getElementById: id => nodes[id],
      createElement: () => ({ style: {}, setAttribute() {} }),
      head: { appendChild: script => state.scripts.push({ script, mapStarted: state.maps > 0 }) },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext(html.match(/<script src="[^\"]*leaflet@[^\"]*" onload="([^\"]*)"/)[1], context);
  return {
    state, window: context,
    enableRouting() {
      L.Routing = {
        osrmv1: options => options,
        control: options => ({ addTo: () => { state.route = options; return {}; } }),
      };
      context.startStoreMapRouting();
    },
  };
}

test('map tiles start before GPS or the routing library is available', () => {
  const { state } = mapFrame();
  assert.equal(state.maps, 1);
  assert.equal(state.tiles, 1);
  assert.equal(state.scripts[0].mapStarted, true);
  assert.equal(state.userPins, 0);
  assert.equal(state.messages.some(message => message.type === 'ready'), true);
});

test('a native fix centers the visible map and only plots a route after routing loads', () => {
  const frame = mapFrame();
  frame.window.receiveStoreMap(mapPayload(origin, [north(1), north(8), north(6), north(12)]));
  assert.equal(frame.state.userPins, 1);
  assert.equal(frame.state.pins.length, 2);
  assert.equal(frame.state.bounds.length, 3);
  assert.equal(frame.state.route, undefined);
  const nearest = frame.state.messages.filter(message => message.type === 'match').at(-1).value;
  assert.equal(nearest.name, 'Shop 6');
  assert.ok(Math.abs(nearest.distanceKm - 6) < 1e-9);
  frame.enableRouting();
  assert.equal(frame.state.maps, 1);
  assert.equal(frame.state.route.waypoints[1].lat, north(6).latitude);
  assert.equal(frame.state.route.lineOptions.styles[0].color, '#1765df');
  frame.window.receiveStoreMap(mapPayload(null, [north(6)]));
  assert.equal(frame.state.route, null);
  assert.equal(frame.state.userPins, 0);
  assert.equal(frame.state.maps, 1);
});

test('native builds can render the map when the engine cannot return function source', () => {
  const fs = require('node:fs');
  const filename = require('node:path').resolve(__dirname, '../../constants/store-map-document.js');
  const { createRequire } = require('node:module');
  const { transformSync } = require('@babel/core');
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    presets: ['babel-preset-expo'], plugins: ['@babel/plugin-transform-modules-commonjs'],
    caller: { name: 'metro', platform: 'android', isDev: false },
  });
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require: createRequire(filename) });
  vm.runInContext('Function.prototype.toString = () => "function () { [bytecode] }";', context);
  vm.runInContext(code, context);
  const frame = mapFrame(module.exports.storeMapDocument());
  frame.window.receiveStoreMap(mapPayload(origin, [north(6)]));
  assert.equal(frame.state.maps, 1);
  assert.equal(frame.state.tiles, 1);
  assert.equal(frame.state.userPins, 1);
  assert.equal(frame.state.messages.some(message => message.type === 'error'), false);
});

test('Leaflet document preserves safe text serialization and a valid bridge script', () => {
  const malicious = { name: '</script><script>alert(1)</script>\u2028' };
  const serialized = scriptJson(malicious);
  assert.equal(serialized.includes('</script>'), false);
  assert.deepEqual(JSON.parse(serialized), malicious);
  const html = storeMapDocument();
  assert.match(html, /leaflet@1\.9\.4/);
  assert.doesNotMatch(html, /maplibre|openfreemap/);
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
