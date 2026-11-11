import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../backend/firebase";
import { getStoreListings, mapStoreAccount } from "../constants/stores";

export function useProducts(storeId = null, enabled = true) {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setError("");
    setProducts([]);
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let productRecords = [];
    let storeNames = {};
    let knownStoreIds = new Set();
    let hiddenStoreIds = new Set();
    let productsLoaded = false;
    let storesLoaded = false;

    const publishProducts = () => {
      if (!storesLoaded) {
        setProducts([]);
        return;
      }

      const customerProducts = productRecords
        .map((product) => {
          const storeKey = String(product.storeId || "");
          if (!storeKey || hiddenStoreIds.has(storeKey)) return null;
          // Older stores may not have a public directory record yet. Keep their
          // otherwise public products visible while the directory is backfilled.
          const resolvedStoreName = storeNames[storeKey]
            || (!knownStoreIds.has(storeKey) ? product.storeName || "Store" : "");
          if (!resolvedStoreName) return null;

          return {
            ...product,
            storeId: storeKey,
            storeName: resolvedStoreName,
            shopName: resolvedStoreName,
          };
        })
        .filter(Boolean)
        .filter(
          (product) =>
            !product.id.startsWith("presentation-product-") &&
            product.archived !== true,
        );

      setProducts(customerProducts);
    };

    const finishLoadingIfReady = () => {
      if (productsLoaded && storesLoaded) setIsLoading(false);
    };

    const productsRef = collection(db, "products");
    const productsQuery = storeId
      ? query(productsRef, where("storeId", "==", storeId))
      : productsRef;

    const unsubscribeProducts = onSnapshot(
      productsQuery,
      (snapshot) => {
        productRecords = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));
        productsLoaded = true;
        publishProducts();
        finishLoadingIfReady();
      },
      (snapshotError) => {
        console.error("Products could not be loaded from Firestore", snapshotError);
        productRecords = [];
        publishProducts();
        setError(
          snapshotError.code === "permission-denied"
            ? "Firestore denied access. Check your Security Rules."
            : `Firestore error${snapshotError.code ? ` (${snapshotError.code})` : ""}.`,
        );
        productsLoaded = true;
        finishLoadingIfReady();
      },
    );

    const unsubscribeStores = onSnapshot(
      collection(db, "storeDirectory"),
      (snapshot) => {
        knownStoreIds = new Set(snapshot.docs.map((document) => document.id));
        hiddenStoreIds = new Set();
        for (const document of snapshot.docs) {
          if (!mapStoreAccount(document)) hiddenStoreIds.add(document.id);
        }
        storeNames = Object.fromEntries(getStoreListings(snapshot.docs).map(store => [store.id, store.name]));
        storesLoaded = true;
        publishProducts();
        finishLoadingIfReady();
      },
      (storeError) => {
        storeNames = {};
        console.warn(
          "Store names could not be loaded; products will use a generic shop label.",
          storeError?.code || storeError,
        );
        storesLoaded = true;
        publishProducts();
        setError("Shop names could not be loaded. Some products may show as Store.");
        finishLoadingIfReady();
      },
    );

    return () => {
      unsubscribeProducts();
      unsubscribeStores();
    };
  }, [storeId, enabled]);

  return { products, isLoading, error };
}
