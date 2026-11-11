(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.techKnowPermits = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function safeFileName(name) {
    const extension = name.split(".").pop().toLowerCase();
    const base = name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "document";
    const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${base}-${unique}.${extension}`;
  }

  function createPermitService({ auth, db, storage, persistenceReady, authReady, serverTimestamp }) {
    return {
      async documentURL(submission, index) {
        await persistenceReady;
        await authReady;
        if (!auth.currentUser) throw new Error("Please sign in to open permit documents.");
        const document = submission.documents?.[index];
        const owner = submission.uid || submission.storeId;
        const prefix = `permit-submissions/${owner}/${submission.id}/`;
        if (!owner || !submission.id || !Number.isInteger(index) || index < 0 ||
            typeof document?.storagePath !== 'string' || !document.storagePath.startsWith(prefix) ||
            document.storagePath.slice(prefix.length).includes('/') || !document.storagePath.slice(prefix.length) ||
            [owner, submission.id].some(value => String(value).includes('/') || ['.', '..'].includes(value))) {
          throw new Error("This submission has no valid document reference.");
        }
        return storage.ref().child(document.storagePath).getDownloadURL();
      },
      async submit({ files, details = {}, onProgress = () => {} }) {
        await persistenceReady;
        await authReady;
        const user = auth.currentUser;
        if (!user) throw Object.assign(new Error("Please sign in before submitting permits."), { code: "auth/no-current-user" });
        const metadata = {};
        for (const key of ['permitType', 'permitNumber', 'issuingAuthority', 'issuedOn', 'expiresOn', 'businessName']) {
          if (details[key] == null) continue;
          if (typeof details[key] !== 'string' || details[key].trim().length > 200) throw new Error("Permit details must be text of 200 characters or fewer.");
          metadata[key] = details[key].trim();
        }
        const uploads = Array.from(files || []);
        if (!uploads.length || uploads.length > 10) throw new Error("Select between 1 and 10 verification documents.");
        for (const file of uploads) {
          if (!/\.(jpe?g|png|pdf)$/i.test(file.name) || (file.type && !["image/jpeg", "image/png", "application/pdf"].includes(file.type))) {
            throw new Error("Permit documents must be JPG, PNG, or PDF files.");
          }
          if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("Permit documents must be nonempty and 10 MB or smaller.");
        }
        const userRef = db.collection("users").doc(user.uid);
        const profileSnapshot = await userRef.get();
        const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
        const restricted = record => !record || record.adminOperationId || ["suspended", "banned", "disabled"].includes(String(record.status || "").trim().toLowerCase());
        if (restricted(profile) || profile.role !== "Store Admin") throw new Error("This account cannot submit permits.");
        const storeId = profile.storeId || user.uid;
        if (typeof storeId !== 'string' || storeId.includes('/')) throw new Error("Invalid store account.");
        const storeRef = db.collection("stores").doc(storeId);
        const directoryRef = db.collection("storeDirectory").doc(storeId);
        const storeSnapshot = await storeRef.get();
        const store = storeSnapshot.exists ? storeSnapshot.data() : null;
        if (restricted(store) || ![store.ownerId, store.ownerUid, store.uid].includes(user.uid)) {
          throw Object.assign(new Error("Your store account could not be verified."), { code: "permission-denied" });
        }
        const reference = db.collection("permitSubmissions").doc();
        const documents = [];
        const storeName = store.name || store.storeName || user.displayName || "Store admin";
        await reference.set({
          ...metadata,
          id: reference.id, uid: user.uid, storeId, storeName,
          status: "uploading", verificationStatus: "pending", documents: [],
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        try {
          for (const [index, file] of uploads.entries()) {
            if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Sign in again before submitting.");
            onProgress(index + 1, uploads.length);
            const storagePath = `permit-submissions/${user.uid}/${reference.id}/${safeFileName(file.name)}`;
            const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
            await storage.ref().child(storagePath).put(file, {
              contentType,
              customMetadata: { ownerUid: user.uid, submissionId: reference.id, privacy: "admin-only" },
            });
            documents.push({ permitId: "verification-registration", fileName: file.name, fileType: contentType, fileSize: file.size, storagePath });
          }
          if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Sign in again before submitting.");
          await db.runTransaction(async transaction => {
            if (auth.currentUser?.uid !== user.uid) throw new Error("Your session changed. Sign in again before submitting.");
            const latestUser = await transaction.get(userRef);
            const latestStore = await transaction.get(storeRef);
            if (!latestUser.exists || !latestStore.exists) throw new Error("Missing document: the account or store was deleted.");
            if (restricted(latestUser.data()) || restricted(latestStore.data()) || latestUser.data().role !== 'Store Admin'
                || (latestUser.data().storeId || user.uid) !== storeId
                || ![latestStore.data().ownerId, latestStore.data().ownerUid, latestStore.data().uid].includes(user.uid)) {
              throw new Error("This account can no longer submit permits.");
            }
            transaction.update(reference, {
              documents, status: "pending", verificationStatus: "pending",
              submittedAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });
            const changes = { permitSubmissionId: reference.id, verificationStatus: "pending", status: "Pending Verification", updatedAt: serverTimestamp() };
            // update() prevents accidentally recreating a deleted account/store.
            transaction.update(storeRef, changes);
            transaction.update(userRef, changes);
            transaction.set(directoryRef, {
              id: storeId,
              name: latestStore.data().name || latestStore.data().storeName || latestStore.data().businessName || "Store",
              address: latestStore.data().address || "",
              latitude: latestStore.data().latitude ?? null,
              longitude: latestStore.data().longitude ?? null,
              status: "Pending Verification",
              verificationStatus: "pending",
              updatedAt: serverTimestamp(),
            });
          });
        } catch (error) {
          // Keep uploaded file references for diagnosis and later cleanup/retry.
          await reference.update({ status: "upload_failed", documents, errorCode: error.code || "unknown", updatedAt: serverTimestamp() }).catch(() => {});
          throw error;
        }
        return { id: reference.id, storeName, documents, status: "pending", submittedAt: new Date().toISOString() };
      },
    };
  }
  function submissionStatus(submission) {
    const status = String(submission.status || '').toLowerCase();
    if (['uploading', 'upload_failed'].includes(status)) return status;
    const verification = String(submission.verificationStatus || '').toLowerCase();
    if (['approved', 'rejected'].includes(verification)) return verification;
    return status || verification || 'pending';
  }
  function submissionTime(submission) {
    const value = submission.submittedAt || submission.createdAt;
    const time = value?.toMillis ? value.toMillis() : Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }
  return { createPermitService, submissionStatus, submissionTime };
});
