(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../domain/reservations"));
  else root.techKnowAdmin = factory(root.techKnowReservations);
})(typeof globalThis !== "undefined" ? globalThis : this, function (policy) {
  const SUPER_ADMIN_UID = "techknow-superadmin";
  function denied(message) {
    const error = new Error(message);
    error.code = "permission-denied";
    throw error;
  }

  async function resolveSession({ auth, db, persistenceReady, authReady }, requestedRole) {
    await persistenceReady;
    await authReady;
    const user = auth.currentUser;
    if (!user) denied("Please sign in to open the admin portal.");
    const snapshot = await db.collection("users").doc(user.uid).get();
    const profile = snapshot.exists ? snapshot.data() : null;
    if (!profile || ["suspended", "banned", "disabled"].includes(String(profile.status || "").toLowerCase())) {
      denied("This account cannot access the admin portal.");
    }
    const role = profile.role;
    if (!["Store Admin", "Super Admin"].includes(role) || (requestedRole && requestedRole !== role)) {
      denied("This account does not have the required admin role.");
    }
    if (role === "Super Admin") {
      if (profile.status !== "Active") denied("The super-admin account is not active.");
      if (user.uid !== SUPER_ADMIN_UID) denied("This is not the designated super-admin account.");
      const token = await user.getIdTokenResult(true);
      if (token.claims.superAdmin !== true) denied("Super-admin access has not been provisioned for this account.");
    }
    let storeId = null;
    if (role === "Store Admin") {
      storeId = policy.documentId(profile.storeId || user.uid, "store");
      const storeSnapshot = await db.collection("stores").doc(storeId).get();
      const store = storeSnapshot.exists ? storeSnapshot.data() : null;
      if (!store || ![store.ownerId, store.ownerUid, store.uid].includes(user.uid)) {
        denied("This account does not own the selected store.");
      }
      if (["suspended", "banned", "disabled"].includes(String(store.status || "").toLowerCase())) {
        denied("This store cannot access the admin portal.");
      }
    }
    return { uid: user.uid, role, storeId };
  }

  async function signIn(runtime, { email, password, role }) {
    if (!["Store Admin", "Super Admin"].includes(role)) denied("Choose a valid admin login.");
    await runtime.persistenceReady;
    let signedInUser = null;
    try {
      const credential = await runtime.auth.signInWithEmailAndPassword(String(email).trim(), password);
      signedInUser = credential.user;
      return await resolveSession(runtime, role);
    } catch (error) {
      if (signedInUser && runtime.auth.currentUser?.uid === signedInUser.uid) {
        await runtime.presence?.leave();
        await runtime.auth.signOut().catch(() => {});
      }
      throw error;
    }
  }

  function createStoreService(runtime, session) {
    const { db, auth, serverTimestamp } = runtime;
    const storeId = policy.documentId(session.storeId, "store");
    function assertSession() {
      if (auth.currentUser?.uid !== session.uid || session.role !== "Store Admin") denied("Please sign in to your store account again.");
    }
    function own(record) {
      if (!record || record.storeId !== storeId) denied("This record does not belong to your store.");
    }
    function productFields(data, creating = false) {
      const allowed = ["name", "category", "price", "stock", "description", "imageUrl", "imagePath"];
      const fields = Object.fromEntries(allowed.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
      if (creating || "name" in fields) {
        if (typeof fields.name !== "string" || !fields.name.trim()) throw new Error("Enter a product name.");
        fields.name = fields.name.trim();
      }
      if (creating || "category" in fields) {
        if (typeof fields.category !== "string" || !fields.category.trim()) throw new Error("Choose a product category.");
      }
      if (creating || "price" in fields) {
        if (typeof fields.price !== "number" || !Number.isFinite(fields.price) || fields.price < 0 || fields.price > 1000000000) throw new Error("Enter a price between 0 and 1,000,000,000.");
      }
      if (creating || "stock" in fields) {
        const stock = policy.stockQuantity(fields.stock);
        if (stock > 10) throw new Error("Stock must be between 0 and 10.");
        fields.stock = stock;
        fields.status = policy.productStatus(stock);
      }
      return fields;
    }
    async function mutateProduct(id, changes) {
      assertSession();
      const reference = db.collection("products").doc(policy.documentId(String(id), "product"));
      return db.runTransaction(async (transaction) => {
        assertSession();
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new Error("The product no longer exists.");
        const product = snapshot.data();
        own(product);
        const update = changes(product);
        transaction.update(reference, { ...update, updatedAt: serverTimestamp() });
      });
    }
    function reviewError(code, message) {
      throw Object.assign(new Error(message), { code });
    }
    function activeReviewAccount(record) {
      return record && !record.adminOperationId
        && !["suspended", "banned", "disabled"].includes(String(record.status || "").trim().toLowerCase());
    }
    async function moderateReview(id, report = null) {
      assertSession();
      const reviewId = policy.documentId(String(id), "review");
      const reviewRef = db.collection("reviews").doc(reviewId);
      const auditRef = db.collection("auditLogs").doc();
      return db.runTransaction(async transaction => {
        assertSession();
        const profileSnapshot = await transaction.get(db.collection("users").doc(session.uid));
        const storeSnapshot = await transaction.get(db.collection("stores").doc(storeId));
        const snapshot = await transaction.get(reviewRef);
        const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
        const store = storeSnapshot.exists ? storeSnapshot.data() : null;
        if (!activeReviewAccount(profile) || profile.role !== "Store Admin"
          || (profile.storeId || session.uid) !== storeId || !activeReviewAccount(store)
          || ![store.ownerId, store.ownerUid, store.uid].includes(session.uid)) {
          denied("This account cannot manage reviews for this store.");
        }
        if (!snapshot.exists) reviewError("not-found", "The review no longer exists.");
        const review = snapshot.data();
        own(review);
        if (review.reviewReport?.status === "pending") {
          reviewError(report ? "already-exists" : "failed-precondition",
            "This review already has a report awaiting superadmin review.");
        }
        const at = serverTimestamp();
        const audit = { target: reviewId, storeId, adminUid: session.uid, status: "completed", createdAt: at };
        let changes;
        if (report) {
          if (report.target === "proof" && !/^(https?:\/\/|data:image\/)/i.test(String(review.proofFileUrl || review.proofFile || ""))) {
            reviewError("failed-precondition", "This review has no proof image to report.");
          }
          changes = {
            reviewReport: { status: "pending", target: report.target, reason: report.reason, storeId,
              reporterUid: session.uid, reportedAt: at },
            lastReviewAction: { action: "reported", at },
          };
          Object.assign(audit, { action: "Store reported review", reason: report.reason, reportTarget: report.target });
        } else {
          if (review.flagged === true || review.proofFlagged === true) {
            reviewError("failed-precondition", "This review is under superadmin review.");
          }
          if (String(review.status || "Pending").toLowerCase() !== "pending") {
            reviewError("failed-precondition", "Only pending reviews can be approved.");
          }
          changes = { status: "Approved", approvedBy: session.uid, approvedAt: at,
            lastReviewAction: { action: "approvedByStore", at } };
          Object.assign(audit, { action: "Approve store review", reason: "Approved by the owning store admin." });
        }
        // Rules require this fresh audit and the review change to commit together.
        transaction.update(reviewRef, { ...changes, storeReviewAuditId: auditRef.id, updatedAt: at });
        transaction.set(auditRef, audit);
        return { reviewId, status: report ? "pending" : "Approved" };
      });
    }
    return {
      approveReview(id) { return moderateReview(id); },
      reportReview(id, { target, reason } = {}) {
        if (!["proof", "review"].includes(target) || typeof reason !== "string" || !reason.trim() || reason.length > 1000) {
          return Promise.reject(Object.assign(new Error("Choose a report target and enter a reason of 1 to 1000 characters."), { code: "invalid-argument" }));
        }
        return moderateReview(id, { target, reason: reason.trim() });
      },
      async getFavoriteCounts() {
        assertSession();
        const result = await runtime.app.functions('us-central1').httpsCallable('getStoreFavoriteCounts')();
        assertSession();
        return result.data.counts;
      },
      records(name) {
        assertSession();
        if (!["products", "reservations", "reviews"].includes(name)) throw new Error("Unsupported store collection.");
        return db.collection(name).where("storeId", "==", storeId);
      },
      async createProduct(data) {
        assertSession();
        const fields = productFields(data, true);
        const result = await runtime.app.functions('us-central1').httpsCallable('createStoreProduct')(fields);
        return db.collection('products').doc(result.data.productId);
      },
      updateProduct(id, data) { return mutateProduct(id, () => productFields(data)); },
      archiveProduct(id) { return mutateProduct(id, () => ({ archived: true, archivedAt: serverTimestamp() })); },
      restoreProduct(id) { return mutateProduct(id, () => ({ archived: false, archivedAt: runtime.deleteField() })); },
      async deleteProduct(id, { expiredBefore } = {}) {
        assertSession();
        const reference = db.collection("products").doc(policy.documentId(String(id), "product"));
        const product = await db.runTransaction(async (transaction) => {
          assertSession();
          const snapshot = await transaction.get(reference);
          if (!snapshot.exists) return null;
          const record = snapshot.data();
          own(record);
          if (record.archived !== true) throw new Error("Only archived products can be permanently deleted.");
          if (expiredBefore !== undefined) {
            const value = record.archivedAt || record.createdAt || record.updatedAt;
            const milliseconds = value?.toMillis ? value.toMillis() : value?.seconds ? value.seconds * 1000 : Date.parse(value || record.date || "");
            if (!Number.isFinite(milliseconds) || milliseconds > expiredBefore) return null;
          }
          transaction.delete(reference);
          return record;
        });
        // Only clean up objects in this store's product folder.
        if (product?.imagePath?.startsWith(`product-images/${storeId}/`) && runtime.storage) {
          await runtime.storage.ref().child(product.imagePath).delete().catch((error) => {
            console.warn("Product deleted; image cleanup can be retried later.", error);
          });
        }
      },
      async changeReservationStatus(id, nextStatus) {
        assertSession();
        const reference = db.collection("reservations").doc(policy.documentId(String(id), "reservation"));
        return db.runTransaction(async (transaction) => {
          assertSession();
          const snapshot = await transaction.get(reference);
          if (!snapshot.exists) throw new Error("Reservation no longer exists.");
          const reservation = snapshot.data();
          own(reservation);
          let product = null;
          let productRef = null;
          if (nextStatus === "Accepted" || reservation.stockAdjusted === true) {
            productRef = db.collection("products").doc(policy.documentId(reservation.productId, "product"));
            const productSnapshot = await transaction.get(productRef);
            product = productSnapshot.exists ? productSnapshot.data() : null;
          }
          const result = policy.reservationTransition({ reservation, product, storeId, nextStatus });
          if (result.productChanges) transaction.update(productRef, { ...result.productChanges, updatedAt: serverTimestamp() });
          transaction.update(reference, {
            ...result.reservationChanges,
            [nextStatus === "Accepted" ? "acceptedAt" : nextStatus === "Rejected" ? "rejectedAt" : "completedAt"]: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      },
    };
  }
  return { SUPER_ADMIN_UID, resolveSession, signIn, createStoreService };
});
