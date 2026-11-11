import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { createRoutingService } from "../backend/services/store-routing";
import { distanceBetweenKm, normalizeCoordinates } from "../constants/nearby";

const service = createRoutingService();

export function useNearbyShopRoutes(location, shops) {
  const anchor = useRef(null);
  const current = normalizeCoordinates(location);
  if (!current) anchor.current = null;
  else if (!anchor.current || distanceBetweenKm(anchor.current, current) >= 0.1) anchor.current = current;
  const latest = useRef({ location, shops });
  latest.current = { location, shops };
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: "", routes: {} });
  const key = JSON.stringify([anchor.current, shops.map(shop => [shop.id, shop.latitude, shop.longitude])
    .sort((a, b) => a[0].localeCompare(b[0])), attempt]);
  const origin = anchor.current;

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const destinations = latest.current.shops;
    setState({ key, routes: Object.fromEntries(destinations.map(shop => [shop.id, { status: "loading" }])) });
    if (origin) (async () => {
      for (const shop of destinations) {
        if (controller.signal.aborted) return;
        try {
          const result = await service.getRoutes(origin, shop, controller.signal, "driving");
          if (controller.signal.aborted) return;
          setState(previous => previous.key !== key ? previous : {
            key, routes: { ...previous.routes, [shop.id]: { status: "ready", ...result.routes[0] } },
          });
        } catch (_) {
          if (controller.signal.aborted) return;
          setState(previous => previous.key !== key ? previous : {
            key, routes: { ...previous.routes, [shop.id]: { status: "error" } },
          });
        }
      }
    })();
    return () => controller.abort();
    // Key captures destinations and origin; moving 100 m recalculates routes.
  }, [key]));

  const retry = useCallback(() => {
    anchor.current = normalizeCoordinates(latest.current.location);
    setAttempt(value => value + 1);
  }, []);
  return { routes: state.key === key && current ? state.routes : {}, retry };
}
