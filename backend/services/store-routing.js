import { distanceBetweenKm, normalizeCoordinates } from "../../constants/nearby.js";
import { GEOCODER_URL, ROUTER_URL, WALKING_ROUTER_URL } from "../../constants/map-config.js";

export function parseAddressResults(data) {
  const seen = new Set();
  return (Array.isArray(data?.features) ? data.features : []).flatMap(feature => {
    if (!feature || typeof feature !== "object") return [];
    const [longitude, latitude] = feature.geometry?.coordinates || [];
    const coordinate = normalizeCoordinates({ latitude, longitude });
    const p = feature.properties || {};
    // A city/country centroid is not a usable store or street destination.
    if (!coordinate || !["house", "street"].includes(p.type)) return [];
    const label = [...new Set([p.name, [p.housenumber, p.street].filter(Boolean).join(" "),
      p.district, p.city, p.state, p.country].filter(Boolean))].join(", ");
    const key = `${latitude},${longitude}`;
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [{ ...coordinate, label, approximate: p.type !== "house" }];
  });
}

export function parseRoutes(data) {
  if (data?.code !== "Ok") throw new Error("No route was found for this address.");
  const routes = (Array.isArray(data.routes) ? data.routes : []).flatMap((route, index) => {
    if (!route || !Number.isFinite(route.distance) || route.distance < 0
      || !Number.isFinite(route.duration) || route.duration < 0
      || route.geometry?.type !== "LineString" || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2) return [];
    const coordinates = route.geometry.coordinates;
    if (!coordinates.every(pair => Array.isArray(pair) && normalizeCoordinates({ longitude: pair[0], latitude: pair[1] }))) return [];
    return [{ id: String(index), distanceKm: route.distance / 1000, durationSeconds: route.duration,
      geometry: { type: "LineString", coordinates },
      summary: (route.legs || []).map(leg => leg.summary).filter(Boolean).join(" · "),
      steps: (route.legs || []).flatMap(leg => (leg.steps || []).map(step => ({
        instruction: step.maneuver?.type === "arrive" ? "Arrive at the address destination"
          : [step.maneuver?.type === "depart" ? "Head" : (step.maneuver?.type || "Continue").replace(/_/g, " "),
            step.maneuver?.modifier, step.name ? `on ${step.name}` : "along the path"].filter(Boolean).join(" "),
        distanceMeters: Math.max(0, Number(step.distance) || 0),
      }))) }];
  });
  if (!routes.length) throw new Error("The route service did not return a usable road route.");
  return routes.sort((a, b) => a.durationSeconds - b.durationSeconds);
}

export function readSavedRoute(raw, address) {
  try {
    const result = JSON.parse(raw);
    if (result.address !== address || !normalizeCoordinates(result.origin)
      || !normalizeCoordinates(result.destination) || typeof result.destination.label !== "string"
      || !Number.isFinite(result.savedAt) || !["walking", "driving"].includes(result.mode)
      || !Array.isArray(result.routes) || !result.routes.length) return null;
    if (!result.routes.every(route => Number.isFinite(route.distanceKm) && route.distanceKm >= 0
      && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0
      && route.geometry?.type === "LineString" && Array.isArray(route.geometry.coordinates)
      && route.geometry.coordinates.length >= 2 && route.geometry.coordinates.every(pair => Array.isArray(pair)
        && normalizeCoordinates({ longitude: pair[0], latitude: pair[1] }))
      && Array.isArray(route.steps) && route.steps.every(step => typeof step.instruction === "string"
        && Number.isFinite(step.distanceMeters) && step.distanceMeters >= 0))) return null;
    return result;
  } catch (_) { return null; }
}

// Serialize and space callers' requests, cache address lookups and routes.
// Nearby routes use a movement threshold rather than every GPS update.
export function createRoutingService({ fetchImpl = (...args) => fetch(...args),
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 1100, headers = {} } = {}) {
  const cache = new Map();
  let queue = Promise.resolve(), lastRequest = 0;
  const request = (url, ttl, signal) => {
    const run = queue.catch(() => {}).then(async () => {
      if (signal?.aborted) throw new Error("Request cancelled.");
      const cached = cache.get(url);
      if (cached && cached.expires > now()) return cached.value;
      await wait(Math.max(0, lastRequest + interval - now()));
      if (signal?.aborted) throw new Error("Request cancelled.");
      lastRequest = now();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort);
      const timeout = setTimeout(abort, 15000);
      try {
        const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json", ...headers } });
        if (!response.ok) throw new Error("Address or route service is unavailable. Try again later.");
        const value = await response.json();
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(url, { value, expires: now() + ttl });
        return value;
      } catch (error) {
        if (controller.signal.aborted) throw new Error("The request timed out or was cancelled. Try again.");
        if (error instanceof TypeError || error instanceof SyntaxError)
          throw new Error("Directions could not be loaded. Check your connection and try again. Saved directions remain available.");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    });
    queue = run;
    return run;
  };
  return {
    async findAddresses(store, signal) {
      const address = String(store?.address || "").trim();
      if (!address) throw new Error("This store has no saved address for routing.");
      const bias = normalizeCoordinates(store);
      const query = `q=${encodeURIComponent(address)}&limit=5&lang=en`
        + (bias ? `&lat=${bias.latitude}&lon=${bias.longitude}` : "");
      const results = parseAddressResults(await request(`${GEOCODER_URL}?${query}`, 86400000, signal));
      if (!results.length) throw new Error("The store address could not be located precisely. Ask the store for a complete address.");
      return results;
    },
    async getRoutes(origin, destination, signal, mode = "walking") {
      const from = normalizeCoordinates(origin), to = normalizeCoordinates(destination);
      if (!from) throw new Error("Allow location access before requesting a road route.");
      if (!to) throw new Error("Choose a valid address destination first.");
      const base = mode === "driving" ? ROUTER_URL : WALKING_ROUTER_URL;
      const url = `${base}${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
        + "?alternatives=true&steps=true&overview=full&geometries=geojson&generate_hints=false&radiuses=200;200";
      const data = await request(url, 60000, signal);
      const routes = parseRoutes(data);
      // Never silently snap a customer or address to a remote road.
      if (data.waypoints?.some(point => point.distance > 200)) throw new Error("No suitable road or path was found close enough to this location.");
      return { routes, origin: from, destination: { ...destination, ...to }, mode, savedAt: now() };
    },
  };
}

export const routeIsStale = (result, location) => !normalizeCoordinates(location)
  || (result && distanceBetweenKm(result.origin, location) > 0.1);
