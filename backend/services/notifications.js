import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

export function notificationTimestamp(value) {
  const milliseconds = value?.toMillis
    ? value.toMillis()
    : typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

export function moderationNotification(id, notice) {
  const suspended = notice.action === 'suspend';
  return { id: `moderation:${id}`, reviewId: notice.reviewId, category: 'Reviews',
    icon: suspended ? 'block' : 'warning', tone: suspended ? 'red' : 'orange',
    title: suspended ? 'Account suspended' : 'Warning about your review',
    message: `${suspended ? 'Your account was suspended' : 'You received a warning'} for a rude or inappropriate review. Reason: ${notice.reason}`,
    timestamp: notificationTimestamp(notice.createdAt) };
}

// Products come from the same verified, unarchived catalog customers browse.
// Creation time and product ID stay stable when price, stock or images change.
export function productNotifications(products, customerCreatedAt) {
  const since = notificationTimestamp(customerCreatedAt);
  if (!since) return [];
  return products.flatMap((product) => {
    const timestamp = notificationTimestamp(product.createdAt);
    if (!product.id || !product.storeId || !product.storeName || !product.name
      || product.archived === true || product.id.startsWith("presentation-product-")
      || !timestamp || timestamp < since) return [];
    return [{
      id: `product:${product.id}:created`,
      product,
      productId: product.id,
      storeId: product.storeId,
      category: "Alerts",
      icon: "new-releases",
      title: `New product at ${product.storeName}`,
      message: `${product.storeName} added ${product.name}. Tap to view the product.`,
      tone: "blue",
      timestamp,
    }];
  }).sort((left, right) => right.timestamp - left.timestamp);
}

export async function markNotificationsRead(userId, ids) {
  if (!userId || auth.currentUser?.uid !== userId) {
    throw new Error("Please sign in to update your notifications.");
  }
  const uniqueIds = [...new Set(ids)].filter((id) => typeof id === "string" && id);
  if (!uniqueIds.length) return;
  // Merge with other tabs/devices instead of replacing previously read alerts.
  await setDoc(doc(db, "users", userId), {
    notificationReadIds: arrayUnion(...uniqueIds),
  }, { merge: true });
}
