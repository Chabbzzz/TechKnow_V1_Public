import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../backend/firebase";
import { getStoreListings } from "../constants/stores";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeCoordinates } from "../constants/nearby";
import { createRoutingService } from "../backend/services/store-routing";

const geocoding = createRoutingService();

const numberFrom = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export function useNearbyStores() {
  const [stores, setStores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCached, setIsCached] = useState(false);

  useEffect(() => {
    let active = true, receivedStores = false;
    let generation = 0;
    let savedLocations = [];
    const cacheKey = "techknow.nearby-stores.v2";
    AsyncStorage.getItem(cacheKey).then(raw => {
      if (!active || receivedStores || !raw) return;
      try {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length) {
          savedLocations = saved.filter(store => store && typeof store.id === "string" && typeof store.name === "string");
          setStores(savedLocations);
          setIsCached(true); setIsLoading(false);
        }
      } catch (_) { /* Keep loading from the live collection. */ }
    }).catch(() => {});
    const unsubscribe = onSnapshot(
      collection(db, "storeDirectory"),
      { includeMetadataChanges: true },
      (snapshot) => {
        // An empty offline Firestore snapshot must not erase our saved shops.
        if (snapshot.metadata.fromCache && snapshot.empty) { setIsLoading(false); return; }
        receivedStores = true;
        const currentGeneration = ++generation;
        const mappedStores = getStoreListings(snapshot.docs)
          .map((store) => {
            const latitude = numberFrom(store.latitude);
            const longitude = numberFrom(store.longitude);

            const saved = savedLocations.find(item => item.id === store.id && item.address === store.address);
            const coordinate = normalizeCoordinates({ latitude, longitude })
              || normalizeCoordinates({ latitude: saved?.latitude, longitude: saved?.longitude });
            if (!coordinate && !store.address?.trim()) return null;

            return {
              ...store,
              latitude: coordinate?.latitude ?? null,
              longitude: coordinate?.longitude ?? null,
              ...(coordinate && (latitude == null || longitude == null)
                ? { locationAccuracy: "street", locationSource: "address-geocoding" } : {}),
            };
          })
          .filter(Boolean);

        setStores(mappedStores);
        setIsCached(snapshot.metadata.fromCache);
        if (!snapshot.metadata.fromCache) {
          savedLocations = mappedStores;
          AsyncStorage.setItem(cacheKey, JSON.stringify(mappedStores)).catch(() => {});
        }
        setError("");
        setIsLoading(false);

        // Some older store records contain a postal address but no map pin.
        // Resolve those addresses one at a time and cache successful results.
        (async () => {
          for (const store of mappedStores) {
            if (!active || generation !== currentGeneration) return;
            if (store.latitude != null && store.longitude != null) continue;
            try {
              const results = await geocoding.findAddresses(store);
              const match = results.find(result => !result.approximate) || results[0];
              const coordinate = normalizeCoordinates(match);
              if (!coordinate || !active || generation !== currentGeneration) continue;
              const resolved = {
                ...store,
                ...coordinate,
                locationAccuracy: match.approximate ? "street" : "address",
                locationSource: "address-geocoding",
              };
              setStores(current => current.map(item => item.id === store.id && item.address === store.address
                ? resolved : item));
              savedLocations = [...savedLocations.filter(item => item.id !== store.id), resolved];
              AsyncStorage.setItem(cacheKey, JSON.stringify(savedLocations)).catch(() => {});
            } catch (_) {
              // Leave the address visible; an incomplete address may not geocode.
            }
          }
        })();
      },
      (snapshotError) => {
        console.warn("Nearby stores could not be loaded", snapshotError?.code || snapshotError);
        setError("Store locations could not be loaded.");
        setIsLoading(false);
      },
    );

    return () => { active = false; unsubscribe(); };
  }, []);

  return { stores, isLoading, error, isCached };
}
