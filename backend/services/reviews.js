import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import policy from "../domain/reservations";
import proofPolicy from "../domain/review-proofs";
import { getStoreListings } from "../../constants/stores";

export const MAX_PROOF_SIZE = proofPolicy.MAX_PROOF_SIZE;

function reviewStore(snapshot, id) {
  // Older accounts can use the same known listings as the picker while their
  // directory migration is pending. Live restrictions suppress these listings.
  // Firestore rules still require the underlying store account to exist.
  const store = getStoreListings(snapshot.exists() ? [snapshot] : [])
    .find((listing) => listing.id === id);
  if (!store) throw new Error("This store is no longer available.");
  return store;
}

export async function submitReview({ storeId, rating, feedback, proofFile = null }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in before submitting a review.");
  const id = policy.documentId(storeId, "store");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof feedback !== "string" || !feedback.trim() || feedback.length > 5000) {
    throw Object.assign(new Error("Choose a rating from 1 to 5 and enter your feedback."), {
      code: "validation/invalid-input",
    });
  }
  if (!proofFile) throw proofPolicy.proofError("Attach proof of purchase before submitting your review.");
  const proof = proofPolicy.proofFields(proofFile);
  const reviewRef = doc(collection(db, "reviews"));
  // The review and its image are one atomic Firestore write, with no upload or
  // separate file to clean up if submission fails.
  let reviewStage = "store-lookup";
  try {
    await runTransaction(db, async (transaction) => {
      if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Please sign in again.");
      reviewStage = "store-lookup";
      const store = reviewStore(await transaction.get(doc(db, "storeDirectory", id)), id);
      reviewStage = "review-write";
      transaction.set(reviewRef, {
        userId: user.uid,
        user: user.displayName || user.email || "Customer",
        userEmail: user.email || "",
        storeId: id,
        storeName: store.name,
        product: "Shop experience",
        rating,
        review: feedback.trim(),
        ...proof,
        status: "Pending",
        flagged: false,
        risk: "Low",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error?.code === "permission-denied") error.reviewStage = reviewStage;
    throw error;
  }
  return reviewRef.id;
}
