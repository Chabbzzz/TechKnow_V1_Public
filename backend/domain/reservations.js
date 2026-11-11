// No Firebase or UI dependencies. Also loaded as a classic browser script.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.techKnowReservations = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function invalid(message) {
    const error = new Error(message);
    error.code = "validation/invalid-input";
    throw error;
  }

  function documentId(value, label) {
    if (typeof value !== "string" || !value.trim() || value.includes("/")) {
      invalid(`Choose a valid ${label}.`);
    }
    return value.trim();
  }

  function stockQuantity(value) {
    const stock = Number(value ?? 0);
    if (!Number.isSafeInteger(stock) || stock < 0) invalid("The product stock needs to be corrected by the store.");
    return stock;
  }

  function productStatus(stock) {
    return stock <= 0 ? "Out of Stock" : stock > 4 ? "Available" : "Low Stock";
  }

  // Shared by the profile activity count and reservation-history filters.
  function statusForReservation(status) {
    const normalized = String(status || "Pending").trim().toLowerCase();
    if (["accepted", "confirmed", "ongoing"].includes(normalized)) {
      return { label: "Confirmed", type: "confirmed" };
    }
    if (normalized === "completed") return { label: "Completed", type: "completed" };
    if (normalized === "rejected") return { label: "Rejected", type: "declined" };
    if (["cancelled", "canceled", "failed", "declined", "denied", "unsuccessful"].includes(normalized)) {
      return { label: "Declined", type: "declined" };
    }
    if (["waiting list", "waitlisted", "waiting-list"].includes(normalized)) {
      return { label: "Waiting List", type: "pending" };
    }
    return { label: "Pending", type: "pending" };
  }

  function createReservationData({ user, productId, storeId, product, store, date, time, note = "" }) {
    if (!user?.uid) invalid("Please sign in before creating a reservation.");
    documentId(productId, "product");
    documentId(storeId, "store");
    if (!product || product.archived === true) invalid("This product is no longer available.");
    if (product.storeId !== storeId) invalid("This product belongs to a different store. Please choose its store.");
    const storeName = store?.name || store?.storeName || store?.businessName;
    if (!storeName) invalid("This store is no longer available.");
    if (["suspended", "banned", "disabled"].includes(String(store.status || "").toLowerCase())) {
      invalid("This store is not accepting reservations.");
    }
    const waitlisted = stockQuantity(product.stock) === 0;
    const price = Number(product.price ?? 0);
    if (!Number.isFinite(price) || price < 0) invalid("The product price needs to be corrected by the store.");
    const count = Number(product.reservationCount ?? 0);
    if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) invalid("The product reservation count needs to be corrected.");
    return {
      waitlisted,
      reservationCount: count + 1,
      reservation: {
        userId: user.uid,
        user: user.displayName || user.email || "Customer",
        userEmail: user.email || "",
        productId,
        product: String(product.name || product.title || "Unnamed product"),
        unitPrice: price,
        price: `\u20b1${price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        category: String(product.category || "Uncategorized"),
        shop: String(storeName),
        storeId,
        date: date || "Not specified",
        time: time || "Not specified",
        note: String(note).trim(),
        quantity: 1,
        stockAdjusted: false,
        status: waitlisted ? "Waiting List" : "Pending",
        reservationType: waitlisted ? "waiting-list" : "reservation",
      },
    };
  }

  function reservationTransition({ reservation, product, storeId, nextStatus }) {
    documentId(storeId, "store");
    if (!["Accepted", "Rejected", "Completed"].includes(nextStatus)) invalid("Choose Accepted, Rejected, or Completed.");
    if (!reservation) invalid("Reservation no longer exists.");
    if (reservation.storeId !== storeId) invalid("This reservation belongs to a different store.");
    const current = String(reservation.status || "Pending").trim().toLowerCase();
    if (nextStatus === "Completed") {
      if (current !== "accepted" || reservation.stockAdjusted !== true) {
        invalid("Only accepted reservations can be marked as claimed.");
      }
      return { productChanges: null, reservationChanges: { status: "Completed", stockAdjusted: true } };
    }
    if (!["pending", "waiting list", "waitlisted", "waiting-list"].includes(current)) {
      invalid("Only pending or waiting-list reservations can be updated.");
    }
    const quantity = Number(reservation.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1) invalid("The reservation quantity is invalid.");
    const adjusted = reservation.stockAdjusted === true;
    let productChanges = null;
    if (nextStatus === "Accepted" || adjusted) {
      if (!product) invalid("The reserved product no longer exists.");
      if (product.storeId !== storeId) invalid("The reserved product belongs to a different store.");
      if (nextStatus === "Accepted" && product.archived === true) invalid("Archived products cannot be reserved.");
      const stock = stockQuantity(product.stock);
      const nextStock = nextStatus === "Rejected" ? stock + quantity : adjusted ? stock : stock - quantity;
      if (nextStock < 0) invalid("There is not enough stock to accept this reservation.");
      stockQuantity(nextStock);
      productChanges = { stock: nextStock, status: productStatus(nextStock) };
    }
    return {
      productChanges,
      reservationChanges: { status: nextStatus, stockAdjusted: nextStatus === "Accepted" },
    };
  }

  return { documentId, stockQuantity, productStatus, statusForReservation, createReservationData, reservationTransition };
});
