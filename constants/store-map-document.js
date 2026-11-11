import { DEFAULT_LOCATION, normalizeCoordinates } from "./nearby.js";
import { MAP_TILE_URL, ROUTER_URL } from "./map-config.js";

export const ROUTE_COLORS = ["#1765df", "#9a3cbd", "#16835c", "#c16c12", "#c44365"];

export function mapPayload(location, shops) {
  return {
    location: normalizeCoordinates(location),
    shops: shops.map(shop => {
      const coordinates = normalizeCoordinates(shop);
      return coordinates ? { id: shop.id, name: shop.name, lat: coordinates.latitude, lng: coordinates.longitude } : null;
    }).filter(Boolean),
  };
}

export const scriptJson = value => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Keep the WebView program as text. Native Hermes builds do not reliably
// preserve JavaScript function source for Function.prototype.toString().
const MAP_RUNTIME = `function mapRuntime(config) {
  let map, layers, routeControl, data = { shops: [], location: null }, fitted = "";
  const notify = (type, value) => {
    const message = JSON.stringify({ channel: "techknow-map", type, value });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else window.parent.postMessage(message, "*");
  };
  const point = coordinate => [coordinate.latitude, coordinate.longitude];
  const getMatches = () => {
    if (!data.location) return [];
    const userLatLng = L.latLng(data.location.latitude, data.location.longitude);
    return data.shops.map(store => {
      const storeLatLng = L.latLng(store.lat, store.lng);
      return { ...store, latLng: storeLatLng, distanceKm: userLatLng.distanceTo(storeLatLng) / 1000 };
    }).filter(store => store.distanceKm >= 5 && store.distanceKm <= 10)
      .sort((first, second) => first.distanceKm - second.distanceKm);
  };
  const fit = matches => {
    if (!map || !data.location) return;
    const points = [point(data.location), ...matches.map(shop => [shop.lat, shop.lng])];
    if (points.length === 1) map.setView(points[0], 14, { animate: false });
    else map.fitBounds(points, { padding: [30, 40], maxZoom: 16, animate: false });
  };
  const updateNearest = matches => {
    if (routeControl) { map.removeControl(routeControl); routeControl = null; }
    const nearest = matches[0];
    if (!nearest) { notify("match", null); return; }
    notify("match", { id: nearest.id, name: nearest.name, distanceKm: nearest.distanceKm });
    if (!L.Routing || !L.Routing.control) return;
    routeControl = L.Routing.control({
      waypoints: [L.latLng(data.location.latitude, data.location.longitude), nearest.latLng],
      lineOptions: { styles: [{ color: "#1765df", opacity: 0.9, weight: 5 }] },
      addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true,
      show: false, collapsible: false, createMarker: () => null,
      router: L.Routing.osrmv1({ serviceUrl: config.routingUrl }),
    }).addTo(map);
  };
  const label = text => { const element = document.createElement("span"); element.textContent = text; return element; };
  const render = () => {
    if (!map) return;
    layers.clearLayers();
    if (!data.location) {
      if (routeControl) { map.removeControl(routeControl); routeControl = null; }
      fitted = "";
      document.getElementById("legend").textContent = "Bacolod City · Enable location to find nearby shops";
      notify("match", null);
      return;
    }
    L.circleMarker(point(data.location), { radius: 8, color: "white", weight: 3, fillColor: "#18764c", fillOpacity: 1 })
      .addTo(layers).bindTooltip(label("Your current location"));
    const matches = getMatches();
    matches.forEach((shop, index) => {
      const element = document.createElement("button");
      element.type = "button"; element.className = "shop-pin";
      element.style.backgroundColor = config.routeColors[index % config.routeColors.length]; element.textContent = String(index + 1);
      element.setAttribute("aria-label", shop.name + ", " + shop.distanceKm.toFixed(1) + " km away");
      element.onclick = () => notify("select", shop.id);
      L.marker([shop.lat, shop.lng], { keyboard: false, icon: L.divIcon({ html: element, className: "shop-marker", iconSize: [32, 32], iconAnchor: [16, 16] }) })
        .addTo(layers).bindTooltip(label(shop.name + " · " + shop.distanceKm.toFixed(1) + " km"));
    });
    document.getElementById("legend").textContent = "Your location · Shops 5–10 km away";
    const key = JSON.stringify([data.location, matches.map(shop => [shop.id, shop.lat, shop.lng])]);
    if (fitted !== key) { fitted = key; fit(matches); updateNearest(matches); }
  };
  window.receiveStoreMap = payload => { data = payload; render(); };
  // Routing loads separately so a slow route provider cannot hide the map.
  window.startStoreMapRouting = () => { fitted = ""; render(); };
  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    try {
      const message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (message?.channel === "techknow-map-host") window.receiveStoreMap(message.payload);
    } catch (_) { /* Ignore unrelated frame messages. */ }
  });
  window.startStoreMap = () => {
    try {
      map = L.map("map", { zoomControl: false, center: config.defaultCenter, zoom: 13 });
      L.control.zoom({ position: "topright" }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      layers = L.layerGroup().addTo(map);
      L.tileLayer(config.tileUrl, {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on("tileload", () => notify("background-ready"))
        .on("tileerror", () => notify("error", "Map background unavailable")).addTo(map);
      document.getElementById("fit").onclick = () => fit(getMatches());
      new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById("map"));
      render(); notify("ready");
    } catch (error) { notify("error", error.message); }
  };
  notify("boot");
}`;

export function storeMapDocument() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{margin:0;width:100%;height:100%;font-family:Arial,sans-serif;background:#e8eef1}
.shop-pin{border:2px solid white;border-radius:50%;width:32px;height:32px;color:white;font-weight:bold;box-shadow:0 2px 6px #4458;cursor:pointer}
.leaflet-routing-container{display:none!important}
#legend{position:absolute;left:8px;top:8px;max-width:60%;padding:8px;background:#fffffff2;border-radius:7px;font-size:11px;z-index:800;pointer-events:none}
#fit{position:absolute;right:10px;top:86px;background:white;border:1px solid #ccd;border-radius:5px;padding:9px;color:#175ab4;z-index:800}
.leaflet-control-attribution{font-size:9px}</style></head><body>
<div id="map"></div><div id="legend">Finding your location…</div><button id="fit" aria-label="Show your location and shop routes">Fit</button>
<script>(${MAP_RUNTIME})(${scriptJson({ tileUrl: MAP_TILE_URL, routingUrl: ROUTER_URL.replace(/\/driving\/?$/, ""), routeColors: ROUTE_COLORS, defaultCenter: [DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude] })});</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onload="startStoreMap();var s=document.createElement('script');s.src='https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js';s.onload=startStoreMapRouting;document.head.appendChild(s)" onerror="var m=JSON.stringify({channel:'techknow-map',type:'error'});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m)"></script>
</body></html>`;
}
