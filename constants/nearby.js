// Bacolod City is the app's fallback area when the user declines location access.
export const DEFAULT_LOCATION = {
  latitude: 10.6765,
  longitude: 122.9509,
};

export const coordinateNumber = (value) => {
  const scalar = Array.isArray(value) ? value[0] : value;
  if (typeof scalar !== "number" && typeof scalar !== "string") return null;
  if (String(scalar).trim() === "") return null;
  const number = Number(scalar);
  return Number.isFinite(number) ? number : null;
};

export const normalizeCoordinates = (value) => {
  const latitude = coordinateNumber(value?.latitude);
  const longitude = coordinateNumber(value?.longitude);
  if (latitude === null || longitude === null
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
};

export const mapCoordinates = (shops = [], location) => [...shops, location]
  .map(normalizeCoordinates).filter(Boolean);

export const distanceBetweenKm = (first, second) => {
  first = normalizeCoordinates(first);
  second = normalizeCoordinates(second);
  if (!first || !second) return null;

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDifference = toRadians(second.latitude - first.latitude);
  const longitudeDifference = toRadians(second.longitude - first.longitude);
  const latitudeOne = toRadians(first.latitude);
  const latitudeTwo = toRadians(second.latitude);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDifference / 2) ** 2;

  const clamped = Math.max(0, Math.min(1, haversine));
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
};

export const formatDistance = (distanceKm) => {
  if (!Number.isFinite(distanceKm)) return "Distance unavailable";
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m away`;
  return `${distanceKm.toFixed(1)} km away`;
};

export const distanceBand = (distanceKm) => {
  if (!Number.isFinite(distanceKm)) return "Distance unavailable";
  if (distanceKm < 5) return "Under 5 km";
  if (distanceKm <= 10) return "5–10 km";
  return "Beyond 10 km";
};

export const rankNearbyStores = (stores, location) => stores
  .filter((store) => normalizeCoordinates(store) || (typeof store?.address === "string" && store.address.trim()))
  .map((store) => {
    const distanceKm = distanceBetweenKm(location, store);
    return { ...store, distanceKm, distance: formatDistance(distanceKm), distanceBand: distanceBand(distanceKm) };
  })
  .sort((left, right) => ((left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity))
    || left.name.localeCompare(right.name));

export const NEARBY_MIN_KM = 5;
export const NEARBY_MAX_KM = 10;
// Radius eligibility is geographic distance; driving distance is separate.
export const nearbyShopsInRange = (stores, location) => !normalizeCoordinates(location) ? []
  : rankNearbyStores(stores, location).filter(store => Number.isFinite(store.distanceKm)
    && store.distanceKm >= NEARBY_MIN_KM - 1e-9 && store.distanceKm <= NEARBY_MAX_KM + 1e-9);

