import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../backend/firebase";
import { setFavorite, watchFavorite } from "../backend/services/favorites";

export function useFavorite(productId, product = {}) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const generation = useRef(0);
  const desiredFavorite = useRef(false);
  const confirmedFavorite = useRef(false);
  const pendingWrites = useRef(0);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    let unsubscribeFavorite = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeFavorite();
      const current = ++generation.current;
      desiredFavorite.current = false;
      confirmedFavorite.current = false;
      pendingWrites.current = 0;
      setIsSaving(false);
      setIsFavorite(false);
      if (!user || !productId) return;
      unsubscribeFavorite = watchFavorite(user.uid, productId, (exists) => {
        if (generation.current !== current || pendingWrites.current > 0) return;
        desiredFavorite.current = exists;
        confirmedFavorite.current = exists;
        setIsFavorite(exists);
      }, (error) => {
        if (generation.current === current && pendingWrites.current === 0) {
          desiredFavorite.current = false;
          confirmedFavorite.current = false;
          setIsFavorite(false);
        }
        console.error("Favorite status could not be loaded", error);
      });
    });
    return () => {
      ++generation.current;
      unsubscribeAuth();
      unsubscribeFavorite();
    };
  }, [productId]);

  const toggleFavorite = useCallback(async () => {
    const userId = auth.currentUser?.uid;
    if (!userId || !productId) return;
    const current = generation.current;
    const nextFavorite = !desiredFavorite.current;
    desiredFavorite.current = nextFavorite;
    pendingWrites.current += 1;
    setIsFavorite(nextFavorite);
    setIsSaving(true);
    const write = writeQueue.current.catch(() => {}).then(async () => {
      if (generation.current !== current || auth.currentUser?.uid !== userId) return;
      try {
        await setFavorite(productId, product, nextFavorite);
        if (generation.current === current) confirmedFavorite.current = nextFavorite;
      } catch (error) {
        console.error("Favorite could not be saved", error);
        if (generation.current === current && desiredFavorite.current === nextFavorite) {
          desiredFavorite.current = confirmedFavorite.current;
          setIsFavorite(confirmedFavorite.current);
        }
      } finally {
        if (generation.current === current) {
          pendingWrites.current = Math.max(0, pendingWrites.current - 1);
          setIsSaving(pendingWrites.current > 0);
        }
      }
    });
    writeQueue.current = write;
    await write;
  }, [product, productId]);

  return { isFavorite, isSaving, toggleFavorite };
}
