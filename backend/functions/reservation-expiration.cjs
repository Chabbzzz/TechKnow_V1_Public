const { HOLD_DURATION_MS, EXPIRABLE_STATUSES, timestampMillis } = require('./reservation-policy.cjs');
const { documentId, stockQuantity, productStatus } = require('./shared/reservations.cjs');
const PAGE_SIZE = 100;
const CONCURRENCY = 5;

function createReservationExpiration({ db, timestamp, now = Date.now, log = console }) {
  async function expireOne(candidate, cutoff) {
    const reservationRef = db.collection('reservations').doc(candidate.id);
    return db.runTransaction(async (transaction) => {
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) return false;
      const reservation = reservationSnapshot.data();
      const createdAt = timestampMillis(reservation.createdAt);
      if (!EXPIRABLE_STATUSES.includes(reservation.status) ||
          !Number.isFinite(createdAt) || createdAt > cutoff) return false;

      let restorationIssue = null;
      // Pending and waiting-list requests normally hold no stock. Restore only
      // quantities deducted on acceptance (or by a legacy client).
      if (reservation.stockAdjusted === true) {
        const quantity = Number(reservation.quantity ?? 1);
        if (!Number.isSafeInteger(quantity) || quantity < 1) {
          throw new Error(`Reservation ${candidate.id} has invalid quantity.`);
        }
        const productRef = db.collection('products').doc(documentId(reservation.productId, 'product'));
        const productSnapshot = await transaction.get(productRef);
        if (productSnapshot.exists) {
          const product = productSnapshot.data();
          if (!reservation.storeId || product.storeId !== reservation.storeId) {
            throw new Error(`Product ownership does not match reservation ${candidate.id}.`);
          }
          const restoredStock = stockQuantity(stockQuantity(product.stock) + quantity);
          transaction.update(productRef, {
            stock: restoredStock,
            status: productStatus(restoredStock),
            updatedAt: timestamp(),
          });
        } else {
          // Reject even if a product was deleted; retain the discrepancy for
          // store review without recreating inventory.
          restorationIssue = 'product-missing';
        }
      }

      transaction.update(reservationRef, {
        status: 'Rejected',
        stockAdjusted: false,
        rejectionReason: 'unclaimed-after-24-hours',
        rejectedAt: timestamp(),
        updatedAt: timestamp(),
        ...(restorationIssue ? { stockRestorationIssue: restorationIssue } : {}),
      });
      return true;
    });
  }

  async function expireUnclaimedReservations() {
    const cutoff = now() - HOLD_DURATION_MS;
    const query = db.collection('reservations')
      .where('status', 'in', EXPIRABLE_STATUSES)
      .where('createdAt', '<=', new Date(cutoff))
      .orderBy('createdAt')
      .limit(PAGE_SIZE);
    let cursor;
    let rejected = 0;
    let failed = 0;
    while (true) {
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      if (page.empty) break;
      for (let start = 0; start < page.docs.length; start += CONCURRENCY) {
        const results = await Promise.allSettled(page.docs.slice(start, start + CONCURRENCY)
          .map(candidate => expireOne(candidate, cutoff)));
        results.forEach((result, offset) => {
          if (result.status === 'fulfilled') rejected += Number(result.value);
          else {
            failed += 1;
            log.error?.(`Could not expire reservation ${page.docs[start + offset].id}.`, result.reason);
          }
        });
      }
      // Advance past failures too, so malformed records cannot starve later
      // pages. Failures remain eligible for the next scheduled run.
      cursor = page.docs[page.docs.length - 1];
      if (page.docs.length < PAGE_SIZE) break;
    }
    log.info?.(`Rejected ${rejected} expired reservation(s); ${failed} failed.`);
    return rejected;
  }

  return { expireUnclaimedReservations };
}

module.exports = { HOLD_DURATION_MS, createReservationExpiration, timestampMillis };
