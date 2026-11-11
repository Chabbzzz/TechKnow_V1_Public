import {
  collection, doc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db, firebaseApp } from "../firebase";
import policy from "../domain/reservations";

const PENDING_STATUSES = new Set(["", "pending", "waiting list", "waitlisted", "waiting-list"]);
const ACTIVE_STATUSES = new Set([...PENDING_STATUSES, "accepted", "confirmed", "ongoing"]);
const PENDING_LIMIT_MESSAGE = "You already have 5 pending reservations. Wait for a shop to respond before reserving another product.";

async function checkExistingReservations(userId, productId, storeId) {
  const reservations = await getDocs(query(
    collection(db, "reservations"),
    where("userId", "==", userId),
  ));
  if (reservations.docs.some(snapshot => {
    const reservation = snapshot.data();
    return reservation.productId === productId && reservation.storeId === storeId &&
      ACTIVE_STATUSES.has(String(reservation.status || "pending").trim().toLowerCase());
  })) {
    throw Object.assign(new Error("You already have an active reservation for this item."), { code: "already-exists" });
  }
  const count = reservations.docs.reduce((total, snapshot) => {
    const status = String(snapshot.data().status || "").trim().toLowerCase();
    return total + Number(PENDING_STATUSES.has(status));
  }, 0);
  if (count >= 5) {
    throw Object.assign(new Error(PENDING_LIMIT_MESSAGE), { code: "resource-exhausted" });
  }
  return count;
}

async function createReservationFromFirestore(input, user) {
  const productId = policy.documentId(input.productId, "product");
  const storeId = policy.documentId(input.storeId, "store");
  const pendingCount = await checkExistingReservations(user.uid, productId, storeId);
  const reservationRef = doc(collection(db, "reservations"));
  const productRef = doc(db, "products", productId);
  const storeRef = doc(db, "storeDirectory", storeId);

  return runTransaction(db, async (transaction) => {
    if (auth.currentUser?.uid !== user.uid) {
      throw new Error("Your session changed. Please sign in again.");
    }
    const productSnapshot = await transaction.get(productRef);
    const storeSnapshot = await transaction.get(storeRef);
    const result = policy.createReservationData({
      ...input,
      user,
      productId,
      storeId,
      product: productSnapshot.exists() ? productSnapshot.data() : null,
      // Older shops can predate storeDirectory. Security rules still compare
      // the resulting shop name and status with the authoritative stores doc.
      store: storeSnapshot.exists() ? storeSnapshot.data()
        : input.storeName ? { name: input.storeName } : null,
    });
    transaction.update(productRef, {
      reservationCount: result.reservationCount,
      lastReservationId: reservationRef.id,
    });
    transaction.set(reservationRef, {
      ...result.reservation,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { id: reservationRef.id, waitlisted: result.waitlisted, pendingCount: pendingCount + 1 };
  });
}

export async function createReservation(input) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in before creating a reservation.");
  if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Please sign in again.");
  const create = httpsCallable(getFunctions(firebaseApp, "us-central1"), "createCustomerReservation");
  try {
    const result = await create({
      productId: input.productId,
      storeId: input.storeId,
      date: input.date || "Not specified",
      time: input.time || "Not specified",
      note: input.note || "",
    });
    return { id: result.data.reservationId, waitlisted: result.data.waitlisted };
  } catch (error) {
    // Keep reservation submission usable before the callable is deployed. Once
    // available, the callable remains responsible for the authoritative cap.
    if (["functions/not-found", "not-found"].includes(error?.code)) {
      return createReservationFromFirestore(input, user);
    }
    throw error;
  }
}
