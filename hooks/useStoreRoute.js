import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRoutingService, readSavedRoute, routeIsStale } from "../backend/services/store-routing";

const service = createRoutingService({ headers: Platform.OS === "web" ? {} : {
  "User-Agent": "TechKnow/1.0 (+https://techknowcapstone.web.app)",
} });
const empty = { result: null, addresses: [], busy: false, error: "", saved: false, restored: false };
const storageKey = store => `techknow.route.v1:${store.id}`;

export function useStoreRoute(store, location) {
  const [state, setState] = useState(empty);
  const generation = useRef(0), pending = useRef(null);
  const identity = `${store?.id || ""}:${store?.address || ""}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const stateIdentity = useRef(identity);
  useEffect(() => {
    const version = ++generation.current;
    pending.current?.abort(); stateIdentity.current = identity; setState(empty);
    if (store) AsyncStorage.getItem(storageKey(store)).then(raw => {
      if (version !== generation.current || !raw) return;
      try {
        const result = readSavedRoute(raw, store.address);
        if (!result) return;
        setState({ ...empty, result, saved: true, restored: true });
      } catch (_) { /* Corrupt cache never becomes directions. */ }
    }).catch(() => {});
    return () => { generation.current++; pending.current?.abort(); };
  }, [identity]);

  const run = async task => {
    const version = ++generation.current, requestIdentity = identity;
    pending.current?.abort(); pending.current = new AbortController();
    setState(previous => ({ ...previous, busy: true, error: "" }));
    try {
      const changes = await task(pending.current.signal);
      if (version === generation.current && latestIdentity.current === requestIdentity)
        setState(previous => ({ ...previous, ...changes, busy: false }));
    } catch (error) {
      if (version === generation.current && latestIdentity.current === requestIdentity)
        setState(previous => ({ ...previous, busy: false, error: error.message || "Directions are unavailable. Try again." }));
    }
  };
  const findAddresses = () => run(async signal => ({ addresses: await service.findAddresses(store, signal) }));
  const getRoute = (destination, mode = "walking") => run(async signal => {
    const result = { ...await service.getRoutes(location, destination, signal, mode), address: store.address };
    if (signal.aborted) return {};
    let saved = true;
    try { await AsyncStorage.setItem(storageKey(store), JSON.stringify(result)); } catch (_) { saved = false; }
    return { result, addresses: [], saved, restored: false,
      error: saved ? "" : "Route loaded, but this device could not save it for offline reading." };
  });
  const forget = async () => {
    generation.current++; pending.current?.abort();
    try {
      await AsyncStorage.removeItem(storageKey(store));
      if (latestIdentity.current === identity) setState(empty);
    } catch (_) {
      if (latestIdentity.current === identity) setState(previous => ({ ...previous, error: "Saved directions could not be removed. Try again." }));
    }
  };
  const visible = stateIdentity.current === identity ? state : empty;
  return { ...visible, stale: Boolean(visible.result && (routeIsStale(visible.result, location)
    || Date.now() - visible.result.savedAt > 3600000)), findAddresses, getRoute, forget };
}
