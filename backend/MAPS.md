# Nearby shops with Leaflet

Nearby Shops and the expanded Shop Routes screen share
`components/NearbyShopsView.jsx`. Both use Leaflet 1.9.4 inside a WebView on
Android/iOS and a blob iframe on web. OpenStreetMap raster tiles provide the
background. Leaflet is the only map renderer on both platforms; no native map
SDK or external map-app handoff is used.

## Range and location

Only shops between **5 and 10 km, inclusive**, from the current GPS position
appear. This is a geographic radius check, separate from driving distance.
Shops closer than 5 km and farther than 10 km are excluded. Shops without a
valid saved coordinate cannot be included in a radius search.

If location is available and the shop query has completed with no matching
shops, the bottom sheet displays **There are no shops near you.** The map stays
visible behind the sheet, including during loading and GPS errors. Before GPS is
available, the background is centered on Bacolod without a customer marker or
calculated distances. The sheet has a draggable/tappable header and an independent
scrolling store list. Selecting a store collapses the sheet to reveal its route;
selecting a map pin opens the list. Cached shop data is labeled.

## Routes and distances

Each eligible shop gets an automatic driving-route request using its saved map
coordinates and the current GPS origin. OSRM returns the actual road geometry,
distance, and estimated duration. Leaflet draws each successful route in its
shop's color. The corresponding card below the map shows both geographic
distance and driving distance/time. Approximate street pins are labeled.

Tap a marker, route, or shop card to highlight that route. Show all routes clears
the selection; Fit brings the user and the relevant routes back into view.
A failed route retains the shop's geographic distance, displays a route error,
and has a retry action. Failed requests never become straight-line road routes.

`useNearbyShopRoutes` loads requests sequentially through the shared routing
service, which spaces network calls at least 1.1 seconds apart and caches a
successful response for one minute. GPS movement of 100 m triggers recalculation;
small GPS jitter does not restart the request queue. Losing location, leaving the
screen, changing destinations, or retrying cancels obsolete work. Late results
cannot populate a new origin's map. Road snaps beyond 200 m are rejected.

## Configuration

- `EXPO_PUBLIC_MAP_TILE_URL`: raster tile URL template; defaults to
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- `EXPO_PUBLIC_ROUTER_URL`: OSRM driving-route prefix; defaults to
  `https://router.project-osrm.org/route/v1/driving/`.

The tile attribution remains visible. Native WebViews identify TechKnow in the
user agent and retain normal HTTP caching. No tile download/prefetch is performed.
Custom tile providers may require corresponding attribution changes.

Routes, Leaflet's CDN assets, and map backgrounds require a connection. The public
services are best-effort; this does not provide offline maps, live traffic, or
turn-by-turn navigation. Address lookup remains separate from map rendering:
Photon resolves a shop address to candidate coordinates, and Nominatim reverse
geocodes a customer's device position during signup. Leaflet displays maps and
markers; OSRM/FOSSGIS provide route geometry.

## Verification

Targeted Node tests: `store-map`, `nearby-routes`, `nearby`, `current-location`,
and `store-routing` under `backend/tests`.

Export to `output/leaflet-nearby`, then run
`node output/verify-leaflet-nearby.cjs` for the browser interaction check. It uses
synthetic GPS/shops, intercepts all route requests and map tiles, and loads the
real Leaflet library. Real mobile GPS and WebView behavior still require a
device check.

References: [Leaflet API](https://leafletjs.com/reference.html),
[OSRM route API](https://project-osrm.org/docs/v5.24.0/api/#route-service),
[OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
