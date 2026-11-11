// Public endpoints for this capstone. Override with your own services for a
// larger deployment; no API secrets belong in EXPO_PUBLIC variables.
export const MAP_TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const GEOCODER_URL = process.env.EXPO_PUBLIC_GEOCODER_URL || "https://photon.komoot.io/api/";
export const ROUTER_URL = process.env.EXPO_PUBLIC_ROUTER_URL || "https://router.project-osrm.org/route/v1/driving/";
export const WALKING_ROUTER_URL = process.env.EXPO_PUBLIC_WALKING_ROUTER_URL || "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
