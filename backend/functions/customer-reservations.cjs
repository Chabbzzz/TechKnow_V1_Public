const policy = require('./shared/reservations.cjs');
const { MAX_PENDING_RESERVATIONS, PENDING_STATUSES } = require('./reservation-policy.cjs');
const ACTIVE_STATUSES = new Set([...PENDING_STATUSES, 'Accepted', 'Confirmed', 'Ongoing']
  .map(status => status.toLowerCase()));

function createCustomerReservationCreator({ db, timestamp, error }) {
  return async function createCustomerReservation(request) {
    const userId = request.auth?.uid;
    if (!userId) throw error('unauthenticated', 'Please sign in before creating a reservation.');

    const data = { date: '', time: '', note: '', ...request.data };
    let productId;
    let storeId;
    try {
      productId = policy.documentId(data.productId, 'product');
      storeId = policy.documentId(data.storeId, 'store');
    } catch (cause) {
      throw error('invalid-argument', cause.message);
    }
    if (typeof data.date !== 'string' || data.date.length > 100 ||
        typeof data.time !== 'string' || data.time.length > 100 ||
        typeof data.note !== 'string' || data.note.length > 2000) {
      throw error('invalid-argument', 'Check the reservation date, time, and note, then try again.');
    }

    const userRef = db.collection('users').doc(userId);
    const productRef = db.collection('products').doc(productId);
    const storeRef = db.collection('stores').doc(storeId);
    const limitRef = db.collection('reservationLimits').doc(userId);
    const reservationRef = db.collection('reservations').doc();
    // Query by owner alone so submission does not depend on a composite index
    // having been deployed before this callable. Count legacy status spellings
    // from the returned records inside the same transaction.
    const customerReservations = db.collection('reservations').where('userId', '==', userId);
    const user = {
      uid: userId,
      email: request.auth.token?.email || '',
      displayName: request.auth.token?.name || '',
    };

    return db.runTransaction(async (transaction) => {
      // Read and write one document per customer to serialize requests across
      // devices and different products, including an initially empty queue.
      await transaction.get(limitRef);
      const [userSnapshot, productSnapshot, storeSnapshot, reservationsSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(productRef),
        transaction.get(storeRef),
        transaction.get(customerReservations),
      ]);
      const profile = userSnapshot.exists ? userSnapshot.data() : null;
      const profileStatus = String(profile?.status || 'Active').toLowerCase();
      if (!profile || (profile.role || 'Customer') !== 'Customer' ||
          ['suspended', 'banned', 'disabled'].includes(profileStatus) || profile.adminOperationId) {
        throw error('permission-denied', 'This account cannot create reservations.');
      }
      const duplicate = reservationsSnapshot.docs.some(snapshot => {
        const reservation = snapshot.data();
        return reservation.productId === productId && reservation.storeId === storeId &&
          ACTIVE_STATUSES.has(String(reservation.status || 'Pending').trim().toLowerCase());
      });
      if (duplicate) {
        throw error('already-exists', 'You already have an active reservation for this item.');
      }
      const pendingCount = reservationsSnapshot.docs.filter(snapshot => {
        const status = String(snapshot.data().status || 'Pending').trim();
        return PENDING_STATUSES.includes(status);
      }).length;
      if (pendingCount >= MAX_PENDING_RESERVATIONS) {
        throw error('resource-exhausted',
          'You already have 5 pending reservations. Wait for a shop to respond before reserving another product.');
      }

      let result;
      try {
        result = policy.createReservationData({
          user, productId, storeId,
          date: data.date,
          time: data.time,
          note: data.note,
          product: productSnapshot.exists ? productSnapshot.data() : null,
          store: storeSnapshot.exists ? storeSnapshot.data() : null,
        });
      } catch (cause) {
        throw error('failed-precondition', cause.message);
      }
      // Serialize requests from the same customer so simultaneous submissions
      // cannot both pass the limit using the same pending-request snapshot.
      transaction.set(limitRef, { updatedAt: timestamp() });
      transaction.update(productRef, {
        reservationCount: result.reservationCount,
        lastReservationId: reservationRef.id,
      });
      transaction.set(reservationRef, {
        ...result.reservation,
        createdAtMs: Date.now(),
        createdAt: timestamp(),
        updatedAt: timestamp(),
      });
      return { reservationId: reservationRef.id, waitlisted: result.waitlisted };
    });
  };
}

module.exports = { MAX_PENDING_RESERVATIONS, PENDING_STATUSES, createCustomerReservationCreator };
