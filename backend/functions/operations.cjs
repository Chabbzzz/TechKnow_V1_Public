const SUPER_ADMIN_UID = 'techknow-superadmin';

function storeDirectoryRecord(store, id, status, updatedAt) {
  return {
    id,
    name: store.name || store.storeName || store.businessName || 'Store',
    address: store.address || '',
    latitude: store.latitude ?? null,
    longitude: store.longitude ?? null,
    status,
    verificationStatus: store.verificationStatus || 'pending',
    updatedAt,
  };
}

function createOperations({ auth, db, timestamp, error }) {
  async function currentAccount(request) {
    if (!request.auth) throw error('unauthenticated', 'Please sign in again.');
    let account;
    try { account = await auth.getUser(request.auth.uid); }
    catch (cause) {
      if (cause.code === 'auth/user-not-found') throw error('permission-denied', 'This account is no longer available.');
      throw cause;
    }
    const validAfter = Date.parse(account.tokensValidAfterTime || '') / 1000;
    if (account.disabled || (Number.isFinite(validAfter) &&
        (!Number.isFinite(request.auth.token?.auth_time) || request.auth.token.auth_time < Math.floor(validAfter)))) {
      throw error('permission-denied', 'This session is no longer authorized. Please sign in again.');
    }
    return account;
  }
  async function authorize(request) {
    if (!request.auth || request.auth.uid !== SUPER_ADMIN_UID || request.auth.token?.superAdmin !== true) {
      throw error('permission-denied', 'Only the designated super admin can perform this action.');
    }
    const account = await currentAccount(request);
    if (account.customClaims?.superAdmin !== true) throw error('permission-denied', 'Super-admin access has been removed.');
  }
  async function activeAdmin(transaction) {
    const snapshot = await transaction.get(db.collection('users').doc(SUPER_ADMIN_UID));
    const profile = snapshot.exists ? snapshot.data() : null;
    if (!profile || profile.role !== 'Super Admin' || profile.status !== 'Active' || profile.adminOperationId) {
      throw error('permission-denied', 'The super-admin account is not active.');
    }
  }
  function reasonFor(data) {
    if (typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 1000) {
      throw error('invalid-argument', 'Enter a reason between 1 and 1000 characters.');
    }
    return data.reason.trim();
  }
  function documentId(id) {
    if (typeof id !== 'string' || !id || id.includes('/') || id.length > 128) throw error('invalid-argument', 'Choose a valid account, store, or review.');
    return id;
  }
  function activeRecord(record) {
    return Boolean(record && !record.adminOperationId
      && !['suspended', 'banned', 'disabled'].includes(String(record.status || '').trim().toLowerCase()));
  }

  return {
    async getStoreFavoriteCounts(request) {
      await currentAccount(request);
      const restricted = record => record.adminOperationId || ['suspended', 'banned', 'disabled'].includes(String(record.status || '').trim().toLowerCase());
      const profileSnapshot = await db.collection('users').doc(request.auth.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!profile || profile.role !== 'Store Admin' || restricted(profile)) {
        throw error('permission-denied', 'This account cannot view store analytics.');
      }
      // Derive ownership on the server; never accept a store or product ID from the caller.
      const storeId = documentId(profile.storeId || request.auth.uid);
      const storeSnapshot = await db.collection('stores').doc(storeId).get();
      const store = storeSnapshot.exists ? storeSnapshot.data() : null;
      if (!store || ![store.ownerId, store.ownerUid, store.uid].includes(request.auth.uid) || restricted(store)) {
        throw error('permission-denied', 'This account cannot view this store’s analytics.');
      }
      const products = await db.collection('products').where('storeId', '==', storeId).get();
      const activeProducts = products.docs.filter(product => product.data().archived !== true);
      const counts = [];
      // Bounded parallel counts include existing favorites that have no storeId.
      // Only totals leave the server, never customer IDs or private favorite lists.
      for (let offset = 0; offset < activeProducts.length; offset += 10) {
        counts.push(...await Promise.all(activeProducts.slice(offset, offset + 10).map(async product => {
          const snapshot = await db.collection('favorites').where('productId', '==', product.id).count().get();
          return { productId: product.id, count: snapshot.data().count };
        })));
      }
      return { counts };
    },
    async setStoreProductLimit(request) {
      await authorize(request);
      const { storeId, productLimit } = request.data || {};
      const id = documentId(storeId);
      if (productLimit !== null && (!Number.isSafeInteger(productLimit) || productLimit < 0)) {
        throw error('invalid-argument', 'Enter a whole-number limit of 0 or more, or leave it blank for no limit.');
      }
      const storeRef = db.collection('stores').doc(id);
      const audit = db.collection('auditLogs').doc();
      await db.runTransaction(async transaction => {
        await activeAdmin(transaction);
        const snapshot = await transaction.get(storeRef);
        if (!snapshot.exists) throw error('not-found', 'The store no longer exists.');
        const previousLimit = snapshot.data().productLimit ?? null;
        transaction.update(storeRef, { productLimit, updatedAt: timestamp() });
        transaction.set(audit, {
          action: 'Set product limit', target: id,
          reason: `Product limit changed from ${previousLimit ?? 'Unlimited'} to ${productLimit ?? 'Unlimited'}.`,
          previousLimit, productLimit, adminUid: request.auth.uid, status: 'completed', createdAt: timestamp(),
        });
      });
      return { storeId: id, productLimit };
    },
    async createStoreProduct(request) {
      if (!request.auth) throw error('unauthenticated', 'Please sign in to your store account again.');
      await currentAccount(request);
      const data = request.data || {};
      const fields = {};
      for (const key of ['name', 'category']) {
        if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 200) throw error('invalid-argument', `Enter a product ${key} of 1 to 200 characters.`);
        fields[key] = data[key].trim();
      }
      if (typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price < 0 || data.price > 1000000000) throw error('invalid-argument', 'Enter a price between 0 and 1,000,000,000.');
      if (!Number.isInteger(data.stock) || data.stock < 0 || data.stock > 10) throw error('invalid-argument', 'Stock must be between 0 and 10.');
      for (const key of ['description', 'imageUrl', 'imagePath']) {
        if (data[key] !== undefined) {
          if (data[key] !== null && typeof data[key] !== 'string') throw error('invalid-argument', `Invalid ${key}.`);
          const maxLength = key === 'imageUrl' ? 700 * 1024 : key === 'description' ? 5000 : 1024;
          if (data[key]?.length > maxLength) throw error('invalid-argument', `The ${key} is too long.`);
          fields[key] = data[key];
        }
      }
      const productRef = db.collection('products').doc();
      const restricted = record => record.adminOperationId || ['suspended', 'banned', 'disabled'].includes(String(record.status || '').trim().toLowerCase());
      await db.runTransaction(async transaction => {
        const profileSnapshot = await transaction.get(db.collection('users').doc(request.auth.uid));
        const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
        if (!profile || profile.role !== 'Store Admin' || restricted(profile)) throw error('permission-denied', 'This account cannot add products.');
        const storeId = documentId(profile.storeId || request.auth.uid);
        const storeRef = db.collection('stores').doc(storeId);
        const storeSnapshot = await transaction.get(storeRef);
        const store = storeSnapshot.exists ? storeSnapshot.data() : null;
        if (!store || ![store.ownerId, store.ownerUid, store.uid].includes(request.auth.uid) || restricted(store)) {
          throw error('permission-denied', 'This account cannot add products to this store.');
        }
        // Capture the shop name at upload time from the verified ownership record.
        // Never accept attribution supplied by the product form or caller.
        const storeName = [store.name, store.storeName, store.businessName]
          .find(value => typeof value === 'string' && value.trim())?.trim() || 'Store';
        if (store.productLimit != null) {
          const limit = Number(store.productLimit);
          if (!Number.isSafeInteger(limit) || limit < 0) throw error('failed-precondition', 'Ask the super admin to correct this store’s product limit.');
          const products = await transaction.get(db.collection('products').where('storeId', '==', storeId));
          if (products.size >= limit) throw error('resource-exhausted', `This store has reached its product limit of ${limit}. Permanently delete an archived product or ask the super admin to increase the limit.`);
        }
        // Serialize creation and limit changes on the store, including simultaneous uploads.
        transaction.update(storeRef, { productUsageUpdatedAt: timestamp() });
        transaction.set(productRef, {
          ...fields, price: data.price, stock: data.stock, storeId, storeName, totalQuantity: data.stock,
          status: data.stock === 0 ? 'Out of Stock' : data.stock <= 4 ? 'Low Stock' : 'Available',
          views: 0, favorites: 0, recommendations: 0, reservationCount: 0,
          createdAt: timestamp(), updatedAt: timestamp(),
        });
      });
      return { productId: productRef.id };
    },
    async setAccountStatus(request) {
      await authorize(request);
      const data = request.data || {};
      const uid = documentId(data.uid);
      const reason = reasonFor(data);
      if (uid === SUPER_ADMIN_UID) throw error('failed-precondition', 'The super-admin account cannot suspend itself.');
      if (!['Suspend', 'Restore'].includes(data.action)) throw error('invalid-argument', 'Choose Suspend or Restore.');
      const userRef = db.collection('users').doc(uid);
      const [userSnapshot, target] = await Promise.all([userRef.get(), auth.getUser(uid)]);
      if (!userSnapshot.exists) throw error('not-found', 'The user profile no longer exists.');
      const profile = userSnapshot.data();
      if (profile.role === 'Super Admin' || target.customClaims?.superAdmin) throw error('failed-precondition', 'Privileged accounts cannot be changed here.');
      const suspended = data.action === 'Suspend';
      if ((!suspended && profile.status !== 'Suspended') || (suspended && profile.status === 'Suspended')) {
        throw error('failed-precondition', 'The account status has changed. Refresh and try again.');
      }
      let storeRef = null;
      let storeDirectoryRef = null;
      let store = null;
      if (profile.role === 'Store Admin') {
        const storeId = documentId(profile.storeId || uid);
        storeRef = db.collection('stores').doc(storeId);
        storeDirectoryRef = db.collection('storeDirectory').doc(storeId);
        const snapshot = await storeRef.get();
        store = snapshot.exists ? snapshot.data() : null;
        if (!store || ![store.ownerId, store.ownerUid, store.uid].includes(uid)) throw error('failed-precondition', 'The store ownership record needs to be corrected first.');
      }
      // Auth and Firestore cannot commit together. Persist the operation first
      // so an interrupted cross-service update is visible to administrators.
      const audit = db.collection('auditLogs').doc();
      await db.runTransaction(async transaction => {
        await activeAdmin(transaction);
        const latest = await transaction.get(userRef);
        if (!latest.exists || latest.data().adminOperationId || latest.data().status !== profile.status) {
          throw error('failed-precondition', 'An account action is pending or its status has changed. Refresh or review its audit record.');
        }
        transaction.set(audit, { action: data.action, target: uid, targetEmail: target.email || '', reason, adminUid: request.auth.uid, status: 'pending', createdAt: timestamp() });
        transaction.update(userRef, { adminOperationId: audit.id });
      });
      let authChanged = false;
      try {
        await auth.updateUser(uid, { disabled: suspended || profile.authDisabledBeforeSuspension === true });
        authChanged = true;
        if (suspended) await auth.revokeRefreshTokens(uid);
        const batch = db.batch();
        const status = suspended ? 'Suspended' : profile.statusBeforeSuspension || 'Active';
        const changes = { status, adminOperationId: null, updatedAt: timestamp() };
        if (suspended) {
          changes.authDisabledBeforeSuspension = target.disabled === true;
          changes.statusBeforeSuspension = profile.status || 'Active';
          if (store) changes.storeStatusBeforeSuspension = store.status || 'Active';
        }
        batch.update(userRef, changes);
        if (storeRef) {
          const storeStatus = suspended ? 'Suspended' : profile.storeStatusBeforeSuspension || 'Active';
          const updatedAt = timestamp();
          batch.update(storeRef, { status: storeStatus, updatedAt });
          batch.set(storeDirectoryRef, storeDirectoryRecord(store, storeRef.id, storeStatus, updatedAt));
        }
        batch.update(audit, { status: 'completed', completedAt: timestamp() });
        await batch.commit();
        return { uid, status };
      } catch (cause) {
        await audit.update({ status: authChanged ? 'reconciliation_required' : 'failed', errorCode: cause.code || 'unknown', updatedAt: timestamp() }).catch(() => {});
        if (!authChanged) await userRef.update({ adminOperationId: null }).catch(() => {});
        throw error('internal', authChanged
          ? 'Authentication was updated, but profile synchronization failed. An administrator must reconcile this operation in auditLogs.'
          : 'The account could not be updated. Please try again.');
      }
    },
    async setReviewFlag(request) {
      await authorize(request);
      const data = request.data || {};
      const id = documentId(data.reviewId);
      const reason = reasonFor(data);
      if (typeof data.flagged !== 'boolean') throw error('invalid-argument', 'Choose whether to flag or clear this review.');
      const reviewRef = db.collection('reviews').doc(id);
      const audit = db.collection('auditLogs').doc();
      const actedAt = timestamp();
      await db.runTransaction(async transaction => {
        await activeAdmin(transaction);
        const snapshot = await transaction.get(reviewRef);
        if (!snapshot.exists) throw error('not-found', 'The review no longer exists.');
        const review = snapshot.data();
        const report = review.reviewReport;
        const approved = ['approved', 'published'].includes(String(review.status || '').toLowerCase());
        if (report?.status !== 'pending' && !approved) {
          throw error('failed-precondition', 'Only approved reviews and pending store reports can be reviewed here.');
        }
        const updates = { flagged: data.flagged, moderationReason: reason, moderatedBy: request.auth.uid, moderatedAt: actedAt, updatedAt: actedAt,
          lastReviewAction: { action: data.flagged ? 'flagRedundant' : 'clearFlag', at: actedAt } };
        if (report?.status === 'pending') {
          updates.reviewReport = { ...report, status: data.flagged ? 'actioned' : 'dismissed', handledBy: request.auth.uid, handledAt: actedAt };
        }
        transaction.update(reviewRef, updates);
        transaction.set(audit, { action: data.flagged ? 'Flag review' : 'Clear review flag', target: id, reason, adminUid: request.auth.uid, status: 'completed', createdAt: actedAt });
      });
      return { reviewId: id, flagged: data.flagged };
    },
    async setReviewAction(request) {
      await authorize(request);
      const data = request.data || {};
      const id = documentId(data.reviewId);
      const action = data.action;
      const actions = {
        approveReview: ['Approve review', 'Review approved by superadmin.'],
        verifyProof: ['Verify proof', 'Purchase proof verified by superadmin.'],
        flagRedundant: ['Flag redundant review', null],
        reportImage: ['Report proof image', null],
      };
      if (!Object.hasOwn(actions, action)) throw error('invalid-argument', 'Choose a valid review action.');
      const reason = actions[action][1] || reasonFor(data);
      const reviewRef = db.collection('reviews').doc(id);
      const audit = db.collection('auditLogs').doc();
      const actedAt = timestamp();
      await db.runTransaction(async transaction => {
        await activeAdmin(transaction);
        const snapshot = await transaction.get(reviewRef);
        if (!snapshot.exists) throw error('not-found', 'The review no longer exists.');
        const review = snapshot.data();
        const approved = ['approved', 'published'].includes(String(review.status || '').toLowerCase());
        if (review.reviewReport?.status !== 'pending' && !approved) {
          throw error('failed-precondition', 'Only approved reviews and pending store reports can be reviewed here.');
        }
        if (action === 'approveReview' && String(review.status || 'Pending').toLowerCase() !== 'pending') {
          throw error('failed-precondition', 'This review has already been decided by the store.');
        }
        const hasProof = /^(https?:\/\/|data:image\/)/i.test(String(review.proofFileUrl || review.proofFile || ''));
        if (action === 'approveReview' && review.flagged === true) {
          throw error('failed-precondition', 'Clear the review flag before approving this review.');
        }
        if (['verifyProof', 'reportImage'].includes(action) && !hasProof) {
          throw error('failed-precondition', 'This review has no proof image.');
        }
        if (action === 'verifyProof' && review.proofFlagged === true) {
          throw error('failed-precondition', 'A reported proof image cannot be verified.');
        }
        if (action === 'verifyProof' && review.proofVerified === true) {
          throw error('failed-precondition', 'This proof image has already been verified.');
        }
        if (action === 'flagRedundant' && review.flagged === true) {
          throw error('failed-precondition', 'This review is already flagged.');
        }
        if (action === 'reportImage' && review.proofFlagged === true) {
          throw error('failed-precondition', 'This proof image is already reported.');
        }
        const updates = { updatedAt: actedAt, lastReviewAction: { action, at: actedAt } };
        if (action === 'approveReview') Object.assign(updates, { status: 'Approved', approvedBy: request.auth.uid, approvedAt: actedAt });
        if (action === 'verifyProof') Object.assign(updates, { proofVerified: true, proofVerifiedBy: request.auth.uid, proofVerifiedAt: actedAt });
        if (action === 'flagRedundant') Object.assign(updates, { flagged: true, moderationReason: reason, moderatedBy: request.auth.uid, moderatedAt: actedAt });
        if (action === 'reportImage') Object.assign(updates, { proofFlagged: true, proofReportReason: reason, proofReportedBy: request.auth.uid, proofReportedAt: actedAt });
        if (review.reviewReport?.status === 'pending') {
          updates.reviewReport = { ...review.reviewReport, status: 'actioned', handledBy: request.auth.uid, handledAt: actedAt };
        }
        transaction.update(reviewRef, updates);
        transaction.set(audit, {
          action: actions[action][0], target: id, reason, adminUid: request.auth.uid,
          status: 'completed', createdAt: actedAt,
        });
      });
      return { reviewId: id, action };
    },
    async approveStoreReview(request) {
      if (!request.auth) throw error('unauthenticated', 'Please sign in again.');
      await currentAccount(request);
      const profileRef = db.collection('users').doc(request.auth.uid);
      const profileSnapshot = await profileRef.get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!activeRecord(profile) || profile.role !== 'Store Admin') {
        throw error('permission-denied', 'An active store admin account is required to approve a review.');
      }
      const storeId = documentId(profile.storeId || request.auth.uid);
      const storeRef = db.collection('stores').doc(storeId);
      const storeSnapshot = await storeRef.get();
      const store = storeSnapshot.exists ? storeSnapshot.data() : null;
      if (!activeRecord(store) || ![store.ownerId, store.ownerUid, store.uid].includes(request.auth.uid)) {
        throw error('permission-denied', 'This account does not own an active store.');
      }
      const id = documentId(request.data?.reviewId);
      const reviewRef = db.collection('reviews').doc(id);
      const audit = db.collection('auditLogs').doc();
      const acceptedAt = timestamp();
      await db.runTransaction(async transaction => {
        const latestProfile = await transaction.get(profileRef);
        const latestStore = await transaction.get(storeRef);
        const snapshot = await transaction.get(reviewRef);
        const latestProfileData = latestProfile.exists ? latestProfile.data() : null;
        const latestStoreData = latestStore.exists ? latestStore.data() : null;
        if (!activeRecord(latestProfileData) || latestProfileData.role !== 'Store Admin'
          || !activeRecord(latestStoreData)
          || ![latestStoreData.ownerId, latestStoreData.ownerUid, latestStoreData.uid].includes(request.auth.uid)
          || documentId(latestProfileData.storeId || request.auth.uid) !== storeId) {
          throw error('permission-denied', 'This account is no longer authorized to approve reviews for this store.');
        }
        if (!snapshot.exists || snapshot.data().storeId !== storeId) throw error('not-found', 'The review is not available for this store.');
        const review = snapshot.data();
        if (review.reviewReport?.status === 'pending' || review.flagged === true || review.proofFlagged === true) {
          throw error('failed-precondition', 'This review has been reported and is under superadmin review.');
        }
        if (String(review.status || 'Pending').toLowerCase() !== 'pending') {
          throw error('failed-precondition', 'Only pending reviews can be accepted.');
        }
        transaction.update(reviewRef, {
          status: 'Approved', approvedBy: request.auth.uid, approvedAt: acceptedAt,
          updatedAt: acceptedAt, lastReviewAction: { action: 'approvedByStore', at: acceptedAt },
        });
        transaction.set(audit, {
          action: 'Approve store review', target: id, reason: 'Approved by the owning store admin.',
          adminUid: request.auth.uid, status: 'completed', createdAt: acceptedAt,
        });
      });
      return { reviewId: id, status: 'Approved' };
    },
    async reportStoreReview(request) {
      if (!request.auth) throw error('unauthenticated', 'Please sign in again.');
      await currentAccount(request);
      const profileRef = db.collection('users').doc(request.auth.uid);
      const profileSnapshot = await profileRef.get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!activeRecord(profile) || profile.role !== 'Store Admin') {
        throw error('permission-denied', 'An active store admin account is required to report a review.');
      }
      const storeId = documentId(profile.storeId || request.auth.uid);
      const storeRef = db.collection('stores').doc(storeId);
      const storeSnapshot = await storeRef.get();
      const store = storeSnapshot.exists ? storeSnapshot.data() : null;
      if (!activeRecord(store) || ![store.ownerId, store.ownerUid, store.uid].includes(request.auth.uid)) {
        throw error('permission-denied', 'This account does not own an active store.');
      }
      const data = request.data || {};
      const id = documentId(data.reviewId);
      const reason = reasonFor(data);
      if (!['proof', 'review'].includes(data.target)) throw error('invalid-argument', 'Choose whether to report the proof image or review text.');
      const reviewRef = db.collection('reviews').doc(id);
      const audit = db.collection('auditLogs').doc();
      const reportedAt = timestamp();
      await db.runTransaction(async transaction => {
        const latestProfile = await transaction.get(profileRef);
        const latestStore = await transaction.get(storeRef);
        const snapshot = await transaction.get(reviewRef);
        const latestProfileData = latestProfile.exists ? latestProfile.data() : null;
        const latestStoreData = latestStore.exists ? latestStore.data() : null;
        if (!activeRecord(latestProfileData) || latestProfileData.role !== 'Store Admin'
          || !activeRecord(latestStoreData)
          || ![latestStoreData.ownerId, latestStoreData.ownerUid, latestStoreData.uid].includes(request.auth.uid)
          || documentId(latestProfileData.storeId || request.auth.uid) !== storeId) {
          throw error('permission-denied', 'This account is no longer authorized to report for this store.');
        }
        if (!snapshot.exists || snapshot.data().storeId !== storeId) throw error('not-found', 'The review is not available for this store.');
        const review = snapshot.data();
        if (data.target === 'proof' && !/^(https?:\/\/|data:image\/)/i.test(String(review.proofFileUrl || review.proofFile || ''))) {
          throw error('failed-precondition', 'This review has no proof image to report.');
        }
        if (review.reviewReport?.status === 'pending') throw error('already-exists', 'This review already has a report awaiting superadmin review.');
        const reviewReport = {
          status: 'pending', target: data.target, reason, storeId,
          reporterUid: request.auth.uid, reportedAt,
        };
        transaction.update(reviewRef, { reviewReport, lastReviewAction: { action: 'reported', at: reportedAt }, updatedAt: reportedAt });
        transaction.set(audit, {
          action: 'Store reported review', target: id, reason, reportTarget: data.target,
          adminUid: request.auth.uid, storeId, status: 'completed', createdAt: reportedAt,
        });
      });
      return { reviewId: id, status: 'pending' };
    },
  };
}

module.exports = { SUPER_ADMIN_UID, createOperations };
