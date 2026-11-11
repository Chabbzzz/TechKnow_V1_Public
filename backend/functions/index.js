const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createOperations } = require('./operations.cjs');
const { createReservationExpiration } = require('./reservation-expiration.cjs');
const { createCustomerReservationCreator } = require('./customer-reservations.cjs');

initializeApp();
const operations = createOperations({
  auth: getAuth(), db: getFirestore(), timestamp: () => FieldValue.serverTimestamp(),
  error: (code, message) => new HttpsError(code, message),
});
exports.setPlatformAccountStatus = onCall({ region: 'us-central1' }, operations.setAccountStatus);
exports.setPlatformReviewFlag = onCall({ region: 'us-central1' }, operations.setReviewFlag);
exports.setPlatformReviewAction = onCall({ region: 'us-central1' }, operations.setReviewAction);
exports.approveStoreReview = onCall({ region: 'us-central1' }, operations.approveStoreReview);
exports.reportStoreReview = onCall({ region: 'us-central1' }, operations.reportStoreReview);
exports.setStoreProductLimit = onCall({ region: 'us-central1' }, operations.setStoreProductLimit);
exports.createStoreProduct = onCall({ region: 'us-central1' }, operations.createStoreProduct);
exports.getStoreFavoriteCounts = onCall({ region: 'us-central1' }, operations.getStoreFavoriteCounts);
exports.createCustomerReservation = onCall({ region: 'us-central1' }, createCustomerReservationCreator({
  db: getFirestore(),
  timestamp: () => FieldValue.serverTimestamp(),
  error: (code, message) => new HttpsError(code, message),
}));

const reservationExpiration = createReservationExpiration({
  db: getFirestore(),
  timestamp: () => FieldValue.serverTimestamp(),
});
exports.cancelUnclaimedReservations = onSchedule({
  schedule: 'every 5 minutes',
  region: 'us-central1',
  timeZone: 'Asia/Manila',
  timeoutSeconds: 540,
  maxInstances: 1,
}, reservationExpiration.expireUnclaimedReservations);
