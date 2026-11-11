import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../backend/firebase";

// Catalog counters provide demand without exposing private reservation records.
export function useReservationCounts() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    return onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        const nextCounts = {};
        snapshot.forEach((document) => {
          const count = document.data().reservationCount;
          nextCounts[document.id] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
        });
        setCounts(nextCounts);
      },
      (error) => {
        console.warn("Global reservation counts are unavailable; using product counters.", error?.code || error);
        setCounts(null);
      },
    );
  }, []);

  return counts;
}
