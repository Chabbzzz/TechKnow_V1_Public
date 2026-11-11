import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import policy from "../domain/reservations";

function favoriteRef(userId, productId) {
  return doc(db, "favorites", `${policy.documentId(userId, "user")}_${policy.documentId(String(productId), "product")}`);
}

export function watchFavorite(userId, productId, onChange, onError) {
  return onSnapshot(favoriteRef(userId, productId), (snapshot) => onChange(snapshot.exists()), onError);
}

export function watchFavorites(userId, onChange, onError) {
  const favoritesQuery = query(
    collection(db, "favorites"),
    where("userId", "==", policy.documentId(userId, "user")),
  );
  return onSnapshot(favoritesQuery, (snapshot) => {
    const savedAt = (item) => item.createdAt?.toMillis?.() || Number(item.createdAt?.seconds || 0) * 1000;
    const favorites = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
    favorites.sort((left, right) => savedAt(right) - savedAt(left) || left.id.localeCompare(right.id));
    onChange(favorites);
  }, onError);
}

export async function setFavorite(productId, product, enabled) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in to save favorites.");
  const reference = favoriteRef(user.uid, productId);
  if (!enabled) return deleteDoc(reference);
  return setDoc(reference, {
    userId: user.uid,
    productId: String(productId),
    product: product.title || product.name || "Unnamed product",
    shop: product.shopName || product.storeName || "",
    price: product.price ?? "",
    imageUrl: product.imageUrl || "",
    createdAt: serverTimestamp(),
  });
}
