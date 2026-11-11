import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../backend/firebase";
import { recommendProducts } from "../ml/recommendation";

export function useRecommendations(products = [], reservationCounts = null) {
  const [signals, setSignals] = useState({
    favorites: [],
    reservations: [],
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;
    let sessionId = 0;
    let unsubscribeFavorites = () => {};
    let unsubscribeReservations = () => {};
    let unsubscribeAuth = () => {};

    const stopSignalListeners = () => {
      unsubscribeFavorites();
      unsubscribeReservations();
      unsubscribeFavorites = () => {};
      unsubscribeReservations = () => {};
    };

    unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      stopSignalListeners();
      const currentSession = sessionId + 1;
      sessionId = currentSession;

      if (!user) {
        if (isMounted) {
          setSignals({ favorites: [], reservations: [], isLoading: false });
        }
        return;
      }

      const loadedSources = new Set();
      const markSourceLoaded = (source) => {
        loadedSources.add(source);
        if (isMounted && currentSession === sessionId && loadedSources.size >= 2) {
          setSignals((current) => ({ ...current, isLoading: false }));
        }
      };

      if (isMounted) {
        setSignals({ favorites: [], reservations: [], isLoading: true });
      }

      unsubscribeFavorites = onSnapshot(
        query(collection(db, "favorites"), where("userId", "==", user.uid)),
        (snapshot) => {
          if (!isMounted || currentSession !== sessionId) return;
          setSignals((current) => ({
            ...current,
            favorites: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
          }));
          markSourceLoaded("favorites");
        },
        (error) => {
          console.warn("Recommendation favorites are unavailable", error?.code || error);
          markSourceLoaded("favorites");
        },
      );

      unsubscribeReservations = onSnapshot(
        query(collection(db, "reservations"), where("userId", "==", user.uid)),
        (snapshot) => {
          if (!isMounted || currentSession !== sessionId) return;
          setSignals((current) => ({
            ...current,
            reservations: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
          }));
          markSourceLoaded("reservations");
        },
        (error) => {
          console.warn("Recommendation reservations are unavailable", error?.code || error);
          markSourceLoaded("reservations");
        },
      );
    });

    return () => {
      isMounted = false;
      stopSignalListeners();
      unsubscribeAuth();
    };
  }, []);

  const recommendations = useMemo(
    () => recommendProducts(products, { ...signals, reservationCounts: reservationCounts || {} }),
    [products, reservationCounts, signals],
  );

  return {
    recommendations,
    isLoading: signals.isLoading,
    hasPersonalizedSignals: signals.favorites.length > 0 || signals.reservations.length > 0,
  };
}
