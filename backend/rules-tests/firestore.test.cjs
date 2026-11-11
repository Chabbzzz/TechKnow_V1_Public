const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch, serverTimestamp, setLogLevel } = require('firebase/firestore');
const { ref, uploadBytes, getMetadata, deleteObject, listAll } = require('firebase/storage');
const { Module, createRequire } = require('node:module');
const { transformSync } = require('@babel/core');
const { createStoreService } = require('../services/admin');
const { createService: createReviewModeration } = require('../services/review-moderation');
const functionsRequire = createRequire(path.join(__dirname, '../functions/index.js'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = functionsRequire('firebase-admin/firestore');
const { createCustomerReservationCreator } = require('../functions/customer-reservations.cjs');
const { createReservationExpiration } = require('../functions/reservation-expiration.cjs');
const { createOperations } = require('../functions/operations.cjs');
const { HOLD_DURATION_MS, PENDING_STATUSES } = require('../functions/reservation-policy.cjs');
function loadService(name, mocks) {
  // Compile in this realm: the real Firebase SDK rejects plain objects from a VM realm.
  const filename = path.resolve(__dirname, '../services', `${name}.js`);
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const localRequire = compiled.require.bind(compiled);
  compiled.require = id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id);
  compiled._compile(code, filename);
  return compiled.exports;
}
let env;
let adminApp;
let adminDb;
let createReservation;
const reservationRequest = (data = {}, uid = 'customer') => ({
  auth: { uid, token: { email: `${uid}@example.test` } },
  data: { productId: 'p1', storeId: 'shop', ...data },
});
const stamp = serverTimestamp;
const profile = (uid, extra = {}) => ({ uid, fullName: uid, email: `${uid}@example.test`, address: 'Bacolod', status: 'Active', ...extra });
const store = (uid, extra = {}) => ({ ownerId: uid, email: `${uid}@example.test`, adminName: uid, name: 'Shop', address: 'Bacolod', status: 'Active', ...extra });
const product = { storeId: 'shop', name: 'Keyboard', category: 'Peripherals', price: 100, stock: 1, status: 'Low Stock', reservationCount: 0 };
const db = (uid, claims = {}) => uid ? env.authenticatedContext(uid, { email: `${uid}@example.test`, ...claims }).firestore() : env.unauthenticatedContext().firestore();
const privileged = () => db('techknow-superadmin', { superAdmin: true });
async function seed(records) {
  await env.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (const [key, value] of Object.entries(records)) batch.set(doc(context.firestore(), key), value);
    await batch.commit();
  });
}
before(async () => {
  setLogLevel('silent'); // Expected permission-denied assertions are covered by test results.
  if (process.env.GCLOUD_PROJECT && !process.env.GCLOUD_PROJECT.startsWith('demo-')) throw new Error('Rules tests require a demo project.');
  if (!['127.0.0.1:8085', 'localhost:8085'].includes(process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('Backend integration tests require the loopback Firestore emulator on port 8085.');
  }
  env = await initializeTestEnvironment({ projectId: 'demo-techknow-security', firestore: {
    host: '127.0.0.1', port: 8085, rules: fs.readFileSync(process.env.FIRESTORE_RULES_TEST_FILE || path.join(__dirname, '../../firestore.rules'), 'utf8'),
  }, storage: { host: '127.0.0.1', port: 9195, rules: fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8') } });
  adminApp = initializeApp({ projectId: 'demo-techknow-security' }, 'reservation-backend-test');
  adminDb = getFirestore(adminApp);
  createReservation = createCustomerReservationCreator({ db: adminDb,
    timestamp: () => FieldValue.serverTimestamp(),
    error: (code, message) => Object.assign(new Error(message), { code }) });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seed({
    'users/customer': profile('customer'), 'users/other': profile('other'),
    'users/owner': profile('owner', { role: 'Store Admin', storeId: 'shop' }),
    'users/foreign': profile('foreign', { role: 'Store Admin', storeId: 'otherShop' }),
    'users/techknow-superadmin': profile('techknow-superadmin', { role: 'Super Admin' }),
    'stores/shop': store('owner'), 'stores/otherShop': store('foreign'), 'products/p1': product,
    'storeDirectory/shop': { id: 'shop', name: 'Shop', address: 'Bacolod', latitude: null, longitude: null, status: 'Active', verificationStatus: 'pending' },
    'storeDirectory/otherShop': { id: 'otherShop', name: 'Shop', address: 'Bacolod', latitude: null, longitude: null, status: 'Active', verificationStatus: 'pending' },
    'reservations/private': { userId: 'customer', storeId: 'shop', productId: 'p1', status: 'Pending', quantity: 1, stockAdjusted: false },
    'reviews/private': { userId: 'customer', storeId: 'shop', rating: 5, review: 'Private receipt' },
    'permitSubmissions/private': { uid: 'owner', storeId: 'shop', status: 'pending', verificationStatus: 'pending' },
    'auditLogs/private': { action: 'Suspend' },
  });
});
after(async () => {
  if (adminDb) await adminDb.terminate();
  if (adminApp) await deleteApp(adminApp);
  if (env) await env.cleanup();
});

test('store favorite totals use database aggregation while customer favorite lists remain private', async () => {
  await seed({
    'products/p2': { ...product, name: 'Keyboard' },
    'products/p3': { ...product, storeId: 'otherShop' },
    'favorites/customer_p1': { userId: 'customer', productId: 'p1' },
    'favorites/other_p1': { userId: 'other', productId: 'p1' },
    'favorites/customer_p2': { userId: 'customer', productId: 'p2' },
    'favorites/customer_p3': { userId: 'customer', productId: 'p3' },
  });
  const ops = createOperations({ db: adminDb, auth: { getUser: async () => ({ disabled: false }) },
    error: (code, message) => Object.assign(new Error(message), { code }) });
  const request = { auth: { uid: 'owner' }, data: { storeId: 'otherShop' } };
  assert.deepEqual((await ops.getStoreFavoriteCounts(request)).counts, [
    { productId: 'p1', count: 2 }, { productId: 'p2', count: 1 },
  ]);
  await assertFails(getDocs(query(collection(db('owner'), 'favorites'), where('productId', '==', 'p1'))));
  await assertSucceeds(deleteDoc(doc(db('customer'), 'favorites', 'customer_p1')));
  assert.equal((await ops.getStoreFavoriteCounts(request)).counts[0].count, 1);
  await assertSucceeds(setDoc(doc(db('customer'), 'favorites', 'customer_p1'), {
    userId: 'customer', productId: 'p1', createdAt: serverTimestamp(),
  }));
  assert.equal((await ops.getStoreFavoriteCounts(request)).counts[0].count, 2);
});

test('anonymous access and unknown collections are denied, including writes and deletes', async () => {
  for (const name of ['users', 'stores', 'storeDirectory', 'products', 'reservations', 'reviews', 'permitSubmissions', 'auditLogs', 'unknown']) {
    await assertFails(getDocs(collection(db(), name)));
    await assertFails(setDoc(doc(db(), name, 'attack'), { role: 'Super Admin' }));
    await assertFails(deleteDoc(doc(db(), name, 'private')));
  }
  await assertFails(setDoc(doc(db('customer'), 'unknown/attack'), { value: true }));
});
test('username markers cannot expose account emails or be enumerated by other users', async () => {
  await seed({ 'usernames/customername': { uid: 'customer', username: 'customername', email: 'customer@example.test' } });
  await assertFails(getDoc(doc(db(), 'usernames/customername')));
  await assertFails(getDoc(doc(db('other'), 'usernames/customername')));
  await assertSucceeds(getDoc(doc(db('customer'), 'usernames/customername')));
  await assertFails(getDocs(collection(db('customer'), 'usernames')));

  const client = db('new');
  const batch = writeBatch(client);
  batch.set(doc(client, 'users/new'), { uid: 'new', fullName: 'New', email: 'new@example.test', address: 'Bacolod',
    username: 'new_user', usernameLower: 'new_user', createdAt: stamp() });
  batch.set(doc(client, 'usernames/new_user'), { uid: 'new', username: 'new_user' });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(client, 'usernames/customername'), { uid: 'new', username: 'customername' }));
  await assertFails(setDoc(doc(client, 'usernames/leaky'), { uid: 'new', username: 'leaky', email: 'new@example.test' }));
});
test('private records are limited to their owner, assigned store and claimed platform admin', async () => {
  await assertSucceeds(getDoc(doc(db('customer'), 'users/customer')));
  await assertFails(getDoc(doc(db('other'), 'users/customer')));
  await assertFails(getDocs(collection(db('customer'), 'users')));
  await assertFails(getDoc(doc(db('customer'), 'stores/shop')));
  await assertSucceeds(getDoc(doc(db('owner'), 'stores/shop')));
  await assertSucceeds(getDocs(collection(db('customer'), 'storeDirectory')));
  await assertFails(setDoc(doc(db('customer'), 'storeDirectory/forged'), {
    id: 'forged', name: 'Fake Shop', address: 'Bacolod', latitude: null, longitude: null,
    status: 'Active', verificationStatus: 'pending', updatedAt: stamp(),
  }));
  for (const name of ['reservations', 'reviews']) {
    await assertSucceeds(getDocs(query(collection(db('customer'), name), where('userId', '==', 'customer'))));
    await assertSucceeds(getDocs(query(collection(db('owner'), name), where('storeId', '==', 'shop'))));
    await assertFails(getDoc(doc(db('other'), name, 'private')));
    await assertFails(getDoc(doc(db('foreign'), name, 'private')));
    await assertFails(getDocs(collection(db('customer'), name)));
    await assertSucceeds(getDocs(collection(privileged(), name)));
  }
  await assertSucceeds(getDocs(query(collection(db('owner'), 'permitSubmissions'), where('storeId', '==', 'shop'))));
  await assertFails(getDoc(doc(db('customer'), 'permitSubmissions/private')));
  await assertSucceeds(getDocs(collection(privileged(), 'auditLogs')));
  await assertFails(getDocs(collection(db('techknow-superadmin'), 'auditLogs')));
  await assertFails(setDoc(doc(privileged(), 'auditLogs/forged'), { action: 'fake' }));
});

test('customer signup and profile edits work but role, suspension and moderation escalation fail', async () => {
  await assertSucceeds(setDoc(doc(db('new'), 'users/new'), { uid: 'new', fullName: 'New', email: 'new@example.test', address: 'City', createdAt: stamp() }));
  await assertSucceeds(updateDoc(doc(db('customer'), 'users/customer'), { fullName: 'Updated', updatedAt: stamp(), presenceSessions: { device: stamp() }, notificationReadIds: ['alert:1'] }));
  for (const changes of [{ role: 'Super Admin' }, { role: 'Store Admin', storeId: 'shop' }, { status: 'Active', authDisabledBeforeSuspension: false }, { adminOperationId: null }, { email: 'someone@example.test' }]) {
    await assertFails(updateDoc(doc(db('customer'), 'users/customer'), changes));
  }
  await assertFails(setDoc(doc(db('attack'), 'users/attack'), { ...profile('attack'), role: 'Super Admin', createdAt: stamp() }));
});
test('store signup is an atomic self-owned pending account with no listing-limit override', async () => {
  const client = db('newOwner');
  function signup(extra = {}) {
    const batch = writeBatch(client);
    batch.set(doc(client, 'users/newOwner'), { ...profile('newOwner'), username: 'new-owner', usernameLower: 'new-owner', role: 'Store Admin', storeId: 'newOwner', status: 'Pending Verification', createdAt: stamp() });
    batch.set(doc(client, 'stores/newOwner'), { id: 'newOwner', ownerId: 'newOwner', ownerUid: 'newOwner', name: 'New Shop', address: 'City', email: 'newOwner@example.test', status: 'Pending Verification', verificationStatus: 'pending', createdAt: stamp(), ...extra });
    batch.set(doc(client, 'usernames/new-owner'), { uid: 'newOwner', username: 'new-owner' });
    batch.set(doc(client, 'storeDirectory/newOwner'), { id: 'newOwner', name: 'New Shop', address: 'City', latitude: null, longitude: null, status: 'Pending Verification', verificationStatus: 'pending', updatedAt: stamp() });
    return batch.commit();
  }
  await assertFails(signup({ productLimit: null }));
  await assertFails(signup({ ownerId: 'owner' }));
  await assertSucceeds(signup());
});
test('store owners can edit and archive their inventory but cannot bypass callable creation or ownership', async () => {
  await assertSucceeds(updateDoc(doc(db('owner'), 'products/p1'), { stock: 2, status: 'Low Stock', updatedAt: stamp() }));
  await assertFails(updateDoc(doc(db('foreign'), 'products/p1'), { stock: 0, status: 'Out of Stock', updatedAt: stamp() }));
  for (const changes of [{ storeId: 'otherShop' }, { reservationCount: 999 }, { price: -1 }, { stock: 11 }, { archived: true, archivedAt: new Date(0) }]) {
    await assertFails(updateDoc(doc(db('owner'), 'products/p1'), { ...changes, updatedAt: stamp() }));
  }
  await assertFails(setDoc(doc(db('owner'), 'products/bypass'), product));
  await assertFails(updateDoc(doc(db('owner'), 'stores/shop'), { productLimit: null }));
  await assertFails(deleteDoc(doc(db('owner'), 'products/p1')));
  await assertSucceeds(updateDoc(doc(db('owner'), 'products/p1'), { archived: true, archivedAt: stamp(), updatedAt: stamp() }));
  await assertSucceeds(deleteDoc(doc(db('owner'), 'products/p1')));
});
function reserve(client, changes = {}, counter = true) {
  const batch = writeBatch(client);
  batch.set(doc(client, 'reservations/new'), { userId: 'customer', user: 'Customer', userEmail: 'customer@example.test', productId: 'p1', product: 'Keyboard', unitPrice: 100, price: 'PHP100', category: 'Peripherals', shop: 'Shop', storeId: 'shop', date: 'Not specified', time: 'Not specified', note: '', quantity: 1, stockAdjusted: false, status: 'Pending', reservationType: 'reservation', createdAtMs: Date.now(), createdAt: stamp(), updatedAt: stamp(), ...changes });
  if (counter) batch.update(doc(client, 'products/p1'), { reservationCount: 1, lastReservationId: 'new' });
  return batch.commit();
}
test('reservation creation requires a matching atomic counter and authentic product/customer data', async () => {
  await assertFails(reserve(db('customer'), {}, false));
  for (const changes of [{ userId: 'other' }, { storeId: 'otherShop' }, { unitPrice: 0 }, { quantity: 100 }, { status: 'Accepted' }, { stockAdjusted: true }]) await assertFails(reserve(db('customer'), changes));
  await assertFails(updateDoc(doc(db('customer'), 'products/p1'), { reservationCount: 1, lastReservationId: 'missing' }));
  await assertSucceeds(reserve(db('customer')));
  assert.equal((await getDoc(doc(db('customer'), 'products/p1'))).data().stock, 1);
});
test('reservation creation allows an active legacy shop before its directory record is migrated', async () => {
  await adminDb.doc('storeDirectory/shop').delete();
  await assertSucceeds(reserve(db('customer')));
});
test('accepted reservations require atomic stock deduction and cannot be replayed', async () => {
  const client = db('owner');
  const changes = { status: 'Accepted', stockAdjusted: true, acceptedAt: stamp(), updatedAt: stamp() };
  await assertFails(updateDoc(doc(client, 'reservations/private'), changes));
  await assertFails(updateDoc(doc(db('customer'), 'reservations/private'), changes));
  const batch = writeBatch(client);
  batch.update(doc(client, 'reservations/private'), changes);
  batch.update(doc(client, 'products/p1'), { stock: 0, status: 'Out of Stock', updatedAt: stamp() });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(client, 'reservations/private'), { status: 'Rejected', stockAdjusted: false, rejectedAt: stamp(), updatedAt: stamp() }));
});
test('normal rejection does not require stock changes', async () => {
  await assertSucceeds(updateDoc(doc(db('owner'), 'reservations/private'), { status: 'Rejected', stockAdjusted: false, rejectedAt: stamp(), updatedAt: stamp() }));
});
test('actual reservation, review and store services work against the replacement rules', async () => {
  await seed({ 'products/p2': { ...product, name: 'Mouse' } });
  const customerDb = db('customer');
  const runtime = { db: customerDb, auth: { currentUser: { uid: 'customer', email: 'customer@example.test', displayName: 'Customer' } } };
  const mocks = { '../firebase': runtime, 'firebase/firestore': require('firebase/firestore'),
    'react-native': { Platform: { OS: 'web' } }, 'expo/fetch': { fetch: global.fetch } };
  mocks['firebase/functions'] = {
    getFunctions: () => ({}),
    httpsCallable: (_functions, name) => {
      assert.equal(name, 'createCustomerReservation');
      return async data => ({ data: await createReservation(reservationRequest(data)) });
    },
  };
  const result = await loadService('reservations', mocks).createReservation({ productId: 'p2', storeId: 'shop', note: 'Hold please' });
  const storeService = createStoreService({ db: db('owner'), auth: { currentUser: { uid: 'owner' } }, serverTimestamp: stamp }, { uid: 'owner', role: 'Store Admin', storeId: 'shop' });
  await storeService.changeReservationStatus(result.id, 'Accepted');
  assert.equal((await getDoc(doc(customerDb, 'reservations', result.id))).data().status, 'Accepted');
  assert.equal((await getDoc(doc(customerDb, 'products/p2'))).data().stock, 0);
  const reviewId = await loadService('reviews', mocks).submitReview({ storeId: 'shop', rating: 5, feedback: 'Good',
    proofFile: { dataUrl: 'data:image/jpeg;base64,AAAA', fileSize: 100, fileName: 'receipt.jpg' } });
  assert.equal((await getDoc(doc(customerDb, 'reviews', reviewId))).data().status, 'Pending');
});

test('backend serializes concurrent reservations for different products and reopens slots by status', async () => {
  await seed(Object.fromEntries(Array.from({ length: 8 }, (_, index) =>
    [`products/p${index + 2}`, { ...product, name: `Item ${index + 2}` }])));
  const created = [];
  // The fixture already contains one pending request.
  for (let i = 0; i < 3; i++) created.push(await createReservation(reservationRequest({ productId: `p${i + 2}` })));
  const outcomes = await Promise.allSettled([
    createReservation(reservationRequest({ productId: 'p5' })),
    createReservation(reservationRequest({ productId: 'p6' })),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'resource-exhausted');
  const countPending = async () => (await adminDb.collection('reservations')
    .where('userId', '==', 'customer').where('status', 'in', PENDING_STATUSES).get()).size;
  assert.equal(await countPending(), 5);
  const storeService = createStoreService({ db: db('owner'), auth: { currentUser: { uid: 'owner' } },
    serverTimestamp: stamp }, { uid: 'owner', role: 'Store Admin', storeId: 'shop' });
  await storeService.changeReservationStatus(created[0].reservationId, 'Accepted');
  await createReservation(reservationRequest({ productId: 'p7' }));
  assert.equal(await countPending(), 5);
  await storeService.changeReservationStatus(created[1].reservationId, 'Rejected');
  await createReservation(reservationRequest({ productId: 'p8' }));
  assert.equal(await countPending(), 5);
  await adminDb.collection('reservations').doc(created[2].reservationId).update({ status: 'Cancelled' });
  await createReservation(reservationRequest({ productId: 'p9' }));
  assert.equal(await countPending(), 5);
  await assert.rejects(createReservation(reservationRequest({ productId: 'p3' })), { code: 'resource-exhausted' });
  await assert.doesNotReject(createReservation(reservationRequest({}, 'other')));
});

test('backend expires from submission time and duplicate scheduler runs restore held inventory once', async () => {
  const now = Date.now();
  const oldTime = Timestamp.fromMillis(now - HOLD_DURATION_MS);
  const base = { userId: 'customer', storeId: 'shop', productId: 'p1', quantity: 1, createdAt: oldTime };
  const batch = adminDb.batch();
  batch.set(adminDb.doc('reservations/old-pending'), { ...base, status: 'Pending', stockAdjusted: false });
  batch.set(adminDb.doc('reservations/old-waiting'), { ...base, status: 'Waiting List', stockAdjusted: false });
  batch.set(adminDb.doc('reservations/old-accepted'), { ...base, status: 'Accepted', stockAdjusted: true,
    acceptedAt: Timestamp.fromMillis(now - 1000) });
  batch.set(adminDb.doc('reservations/claimed'), { ...base, status: 'Completed', stockAdjusted: true });
  batch.set(adminDb.doc('reservations/new'), { ...base, status: 'Pending', stockAdjusted: false,
    createdAt: Timestamp.fromMillis(now - HOLD_DURATION_MS + 1) });
  batch.update(adminDb.doc('products/p1'), { stock: 0, status: 'Out of Stock' });
  await batch.commit();
  const expire = createReservationExpiration({ db: adminDb, timestamp: () => FieldValue.serverTimestamp(),
    now: () => now, log: { error: (...args) => assert.fail(String(args)), info() {} } }).expireUnclaimedReservations;
  const counts = await Promise.all([expire(), expire()]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  assert.equal((await adminDb.doc('products/p1').get()).data().stock, 1);
  assert.equal((await adminDb.doc('reservations/old-pending').get()).data().status, 'Rejected');
  assert.equal((await adminDb.doc('reservations/old-pending').get()).data().rejectionReason, 'unclaimed-after-24-hours');
  assert.equal((await adminDb.doc('reservations/old-waiting').get()).data().status, 'Rejected');
  assert.equal((await adminDb.doc('reservations/old-accepted').get()).data().status, 'Rejected');
  assert.equal((await adminDb.doc('reservations/claimed').get()).data().status, 'Completed');
  assert.equal((await adminDb.doc('reservations/new').get()).data().status, 'Pending');
  assert.equal(await expire(), 0);
});
test('review writes cannot forge identity, rating, approval or moderation', async () => {
  const value = { userId: 'customer', user: 'Customer', userEmail: 'customer@example.test', storeId: 'shop', storeName: 'Shop', product: 'Shop experience', rating: 5, review: 'Good', proofFile: '', proofFileUrl: 'data:image/jpeg;base64,AAAA', proofFileName: 'receipt.jpg', proofStoragePath: '', status: 'Pending', flagged: false, risk: 'Low', createdAt: stamp(), updatedAt: stamp() };
  for (const extra of [{ rating: 6 }, { userId: 'other' }, { status: 'Approved' }, { flagged: true }, { moderatedBy: 'techknow-superadmin' }]) await assertFails(setDoc(doc(db('customer'), 'reviews/new'), { ...value, ...extra }));
  await assertSucceeds(setDoc(doc(db('customer'), 'reviews/new'), value));
  await assertFails(updateDoc(doc(db('owner'), 'reviews/new'), { flagged: true }));
});

function reviewService(uid = 'owner', storeId = 'shop') {
  return createStoreService({ db: db(uid), auth: { currentUser: { uid } }, serverTimestamp: stamp },
    { uid, role: 'Store Admin', storeId });
}

function moderationBatch(client, { action = 'warning', userId = 'customer', omitAudit = false, omitNotice = false, reviewExtra = {}, noticeExtra = {}, userExtra = {} } = {}) {
  const batch = writeBatch(client);
  const id = doc(collection(client, 'moderationNotifications')).id;
  const notice = { userId, reviewId: 'private', action, reason: 'Rude language', adminUid: 'techknow-superadmin', createdAt: stamp(), ...noticeExtra };
  if (!omitNotice) batch.set(doc(client, 'moderationNotifications', id), notice);
  if (!omitAudit) batch.set(doc(client, 'auditLogs', id), { ...notice, target: 'private', status: 'completed', notificationId: id });
  batch.update(doc(client, 'reviews/private'), { authorModerationId: id, updatedAt: stamp(), ...reviewExtra });
  if (action === 'suspend') batch.update(doc(client, 'users', userId), { status: 'Suspended', suspensionReason: notice.reason,
    suspensionReviewId: 'private', suspendedAt: stamp(), moderationNotificationId: id, updatedAt: stamp(), ...userExtra });
  return batch.commit();
}

test('free-plan superadmin warning and suspension notify only the actual author and preserve feedback', async () => {
  await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', rating: 2, review: 'Original feedback', status: 'Approved',
    reviewReport: { status: 'pending', target: 'review', reason: 'Rude', reporterUid: 'owner' } } });
  const service = createReviewModeration({ db: privileged(), auth: { currentUser: { uid: 'techknow-superadmin' } }, serverTimestamp: stamp }, { uid: 'techknow-superadmin' });
  const warning = await assertSucceeds(service.moderate('private', 'warning', 'Rude language'));
  const noticeRef = doc(db('customer'), 'moderationNotifications', warning.notificationId);
  assert.equal((await assertSucceeds(getDoc(noticeRef))).data().reason, 'Rude language');
  await assertFails(getDoc(doc(db('other'), 'moderationNotifications', warning.notificationId)));
  await assertFails(getDocs(collection(db('customer'), 'moderationNotifications')));
  await assertSucceeds(getDocs(query(collection(db('customer'), 'moderationNotifications'), where('userId', '==', 'customer'))));
  await assertFails(updateDoc(noticeRef, { reason: 'Edited' }));
  await assertFails(deleteDoc(doc(privileged(), 'moderationNotifications', warning.notificationId)));
  await assert.rejects(service.moderate('private', 'warning', 'Duplicate'));
  const suspended = await assertSucceeds(service.moderate('private', 'suspend', 'Repeated rude language'));
  const profile = (await assertSucceeds(getDoc(doc(db('customer'), 'users/customer')))).data();
  assert.equal(profile.status, 'Suspended');
  assert.equal(profile.suspensionReason, 'Repeated rude language');
  await assertFails(getDocs(collection(db('customer'), 'products')));
  await assertFails(updateDoc(doc(db('customer'), 'users/customer'), { status: 'Active' }));
  const review = (await getDoc(doc(privileged(), 'reviews/private'))).data();
  assert.equal(review.review, 'Original feedback');
  assert.equal(review.rating, 2);
  assert.equal(review.reviewReport.status, 'actioned');
  assert.equal(review.authorModerationId, suspended.notificationId);
});

test('free-plan superadmin moderation rejects forged authors, content edits, missing evidence and privilege escalation', async () => {
  await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', status: 'Approved', review: 'Original', rating: 2 } });
  for (const options of [{ userId: 'other' }, { omitAudit: true }, { omitNotice: true }, { reviewExtra: { review: 'Edited' } },
    { reviewExtra: { rating: 5 } }, { noticeExtra: { reason: '' } }, { noticeExtra: { adminUid: 'other' } },
    { action: 'suspend', userExtra: { role: 'Super Admin' } }]) await assertFails(moderationBatch(privileged(), options));
  for (const client of [db('customer'), db('owner'), db('other', { superAdmin: true }), db('techknow-superadmin')]) await assertFails(moderationBatch(client));
  await assertFails(updateDoc(doc(privileged(), 'users/customer'), { status: 'Suspended' }));
  await assertSucceeds(moderationBatch(privileged()));
  await assertFails(moderationBatch(privileged()));
  await seed({ 'users/customer': profile('customer', { role: 'Store Admin' }) });
  await assertFails(moderationBatch(privileged(), { action: 'suspend' }));
});

test('free-plan review approval and reporting work through the actual service and atomic rules', async () => {
  const service = reviewService();
  await assertSucceeds(service.approveReview('private'));
  let review = (await getDoc(doc(db('customer'), 'reviews/private'))).data();
  assert.equal(review.status, 'Approved');
  assert.equal(review.rating, 5);
  assert.equal(review.review, 'Private receipt');
  assert.equal((await getDoc(doc(privileged(), 'auditLogs', review.storeReviewAuditId))).data().action, 'Approve store review');
  await assertSucceeds(service.reportReview('private', { target: 'review', reason: 'Inappropriate text' }));
  review = (await getDoc(doc(db('customer'), 'reviews/private'))).data();
  assert.equal(review.status, 'Approved');
  assert.equal(review.reviewReport.status, 'pending');
  assert.equal(review.reviewReport.reporterUid, 'owner');
  assert.equal((await getDoc(doc(privileged(), 'auditLogs', review.storeReviewAuditId))).data().action, 'Store reported review');
  await assert.rejects(service.approveReview('private'), { code: 'failed-precondition' });
  await assert.rejects(service.reportReview('private', { target: 'review', reason: 'Duplicate' }), { code: 'already-exists' });
  await assertFails(getDocs(collection(db('owner'), 'auditLogs')));
});

function forgedReviewApproval(client, extra = {}, includeAudit = true, auditExtra = {}) {
  const batch = writeBatch(client);
  batch.update(doc(client, 'reviews/private'), { status: 'Approved', approvedBy: 'owner', approvedAt: stamp(),
    updatedAt: stamp(), storeReviewAuditId: 'store-action', lastReviewAction: { action: 'approvedByStore', at: stamp() }, ...extra });
  if (includeAudit) batch.set(doc(client, 'auditLogs/store-action'), { action: 'Approve store review', target: 'private',
    storeId: 'shop', adminUid: 'owner', status: 'completed', reason: 'Approved by the owning store admin.', createdAt: stamp(), ...auditExtra });
  return batch.commit();
}

test('free-plan review rules reject forged identity, edited customer content, missing audits and unrelated audits', async () => {
  const owner = db('owner');
  await assertFails(forgedReviewApproval(owner, {}, false));
  await assertFails(setDoc(doc(owner, 'auditLogs/standalone'), { action: 'Approve store review', target: 'private',
    storeId: 'shop', adminUid: 'owner', status: 'completed', reason: 'Approved by the owning store admin.', createdAt: stamp() }));
  for (const extra of [{ review: 'Rewritten' }, { rating: 1 }, { proofFileUrl: 'https://example.test/replaced' },
    { flagged: false }, { approvedBy: 'foreign' }, { storeId: 'otherShop' }, { approvedAt: new Date(0) }]) {
    await assertFails(forgedReviewApproval(owner, extra));
  }
  await assertFails(forgedReviewApproval(owner, {}, true, { target: 'another-review' }));
  for (const uid of [null, 'customer', 'foreign']) await assertFails(forgedReviewApproval(db(uid)));
  await assertSucceeds(forgedReviewApproval(owner));
  await assertFails(updateDoc(doc(owner, 'auditLogs/store-action'), { reason: 'Rewrite audit' }));
  await assertFails(deleteDoc(doc(owner, 'auditLogs/store-action')));
  await assertFails(forgedReviewApproval(owner));
});

test('free-plan review restrictions and pending reports cannot be bypassed with direct writes', async () => {
  for (const extra of [{ flagged: true }, { proofFlagged: true }, { reviewReport: { status: 'pending' } }]) {
    await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', status: 'Pending', ...extra } });
    await assertFails(forgedReviewApproval(db('owner')));
  }
  await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', status: 'Pending' } });
  await seed({ 'users/owner': profile('owner', { role: 'Store Admin', storeId: 'shop', status: 'Suspended' }) });
  await assertFails(forgedReviewApproval(db('owner')));
});

test('free-plan review proof reports preserve proof and prevent duplicate or fabricated reports', async () => {
  await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', status: 'Pending',
    proofFileUrl: 'data:image/png;base64,AAAA', rating: 3, review: 'Original feedback' } });
  const service = reviewService();
  await assertSucceeds(service.reportReview('private', { target: 'proof', reason: 'Unreadable receipt' }));
  const review = (await getDoc(doc(db('customer'), 'reviews/private'))).data();
  assert.equal(review.proofFileUrl, 'data:image/png;base64,AAAA');
  assert.equal(review.reviewReport.reason, 'Unreadable receipt');
  await assert.rejects(service.reportReview('private', { target: 'proof', reason: 'Another reason' }), { code: 'already-exists' });
  await assertFails(updateDoc(doc(db('owner'), 'reviews/private'), { reviewReport: { ...review.reviewReport, status: 'actioned' } }));
  await assertFails(reviewService('foreign', 'otherShop').reportReview('private', { target: 'proof', reason: 'Foreign report' }));
});

test('free-plan review report rules reject forged reporters, content edits, missing audits and duplicate direct writes', async () => {
  await seed({ 'reviews/private': { userId: 'customer', storeId: 'shop', status: 'Pending',
    proofFileUrl: 'data:image/png;base64,AAAA', rating: 2, review: 'Original feedback' } });
  const client = db('owner');
  function reportBatch(reportExtra = {}, changes = {}, auditExtra = {}, includeAudit = true) {
    const auditRef = doc(collection(client, 'auditLogs'));
    const report = { status: 'pending', target: 'proof', reason: 'Unreadable receipt', storeId: 'shop',
      reporterUid: 'owner', reportedAt: stamp(), ...reportExtra };
    const batch = writeBatch(client);
    batch.update(doc(client, 'reviews/private'), { reviewReport: report, storeReviewAuditId: auditRef.id,
      lastReviewAction: { action: 'reported', at: stamp() }, updatedAt: stamp(), ...changes });
    if (includeAudit) batch.set(auditRef, { action: 'Store reported review', target: 'private', storeId: 'shop',
      adminUid: 'owner', status: 'completed', createdAt: stamp(), reportTarget: report.target, reason: report.reason, ...auditExtra });
    return batch.commit();
  }
  for (const extra of [{ reporterUid: 'foreign' }, { status: 'actioned' }, { target: 'unknown' },
    { reason: '' }, { storeId: 'otherShop' }, { reportedAt: new Date(0) }]) await assertFails(reportBatch(extra));
  for (const changes of [{ review: 'Edited feedback' }, { rating: 5 }, { flagged: true }]) await assertFails(reportBatch({}, changes));
  await assertFails(reportBatch({}, {}, {}, false));
  await assertFails(reportBatch({}, {}, { reportTarget: 'review' }));
  await assertSucceeds(reportBatch());
  await assertFails(reportBatch());
});
test('favorites stay private and cannot be written for another customer', async () => {
  const ref = doc(db('customer'), 'favorites/customer_p1');
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, { userId: 'customer', productId: 'p1', createdAt: stamp() }));
  await assertFails(getDoc(doc(db('other'), 'favorites/customer_p1')));
  await assertFails(setDoc(doc(db('other'), 'favorites/customer_p1'), { userId: 'customer', productId: 'p1', createdAt: stamp() }));
  await assertSucceeds(deleteDoc(ref));
});
test('permit finalization keeps verification pending and cannot clear a suspension', async () => {
  const client = db('owner');
  await assertSucceeds(setDoc(doc(client, 'permitSubmissions/new'), { id: 'new', uid: 'owner', storeId: 'shop', storeName: 'Shop', status: 'uploading', verificationStatus: 'pending', documents: [], createdAt: stamp(), updatedAt: stamp() }));
  await assertFails(updateDoc(doc(client, 'permitSubmissions/new'), { status: 'approved', verificationStatus: 'approved', updatedAt: stamp() }));
  const batch = writeBatch(client);
  batch.update(doc(client, 'permitSubmissions/new'), { documents: [{ storagePath: 'permit-submissions/owner/new/permit.pdf' }], status: 'pending', submittedAt: stamp(), updatedAt: stamp() });
  const changes = { permitSubmissionId: 'new', status: 'Pending Verification', verificationStatus: 'pending', updatedAt: stamp() };
  batch.update(doc(client, 'users/owner'), changes);
  batch.update(doc(client, 'stores/shop'), changes);
  batch.set(doc(client, 'storeDirectory/shop'), { id: 'shop', name: 'Shop', address: 'Bacolod', latitude: null, longitude: null,
    status: 'Pending Verification', verificationStatus: 'pending', updatedAt: stamp() });
  await assertSucceeds(batch.commit());
  await seed({ 'users/owner': profile('owner', { role: 'Store Admin', storeId: 'shop', status: 'Suspended' }) });
  await assertFails(updateDoc(doc(client, 'users/owner'), changes));
});
test('suspended accounts and pending Auth reconciliation cannot access protected resources', async () => {
  for (const restriction of [{ status: 'Suspended' }, { adminOperationId: 'pending' }]) {
    await seed({ 'users/customer': profile('customer', restriction), 'users/techknow-superadmin': profile('techknow-superadmin', { role: 'Super Admin', ...restriction }) });
    await assertFails(getDocs(collection(db('customer'), 'products')));
    await assertFails(updateDoc(doc(db('customer'), 'users/customer'), { status: 'Active' }));
    await assertFails(getDocs(collection(privileged(), 'users')));
  }
});

const storageFor = (uid, claims = {}) => uid ? env.authenticatedContext(uid, { email: `${uid}@example.test`, ...claims }).storage() : env.unauthenticatedContext().storage();
test('receipt uploads reject strangers, SVG, empty and oversized files; reads stay scoped', async () => {
  const own = ref(storageFor('customer'), 'review-proofs/customer/private.png');
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await assertFails(uploadBytes(ref(storageFor(), own.fullPath), bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(storageFor('other'), own.fullPath), bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(own, bytes, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(own, new Uint8Array(), { contentType: 'image/png' }));
  await assertFails(uploadBytes(own, new Uint8Array(5 * 1024 * 1024), { contentType: 'image/png' }));
  await assertFails(uploadBytes(own, new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(own, bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(own, bytes, { contentType: 'image/png' }));
  await assertFails(deleteObject(own));
  for (const uid of ['customer', 'owner']) await assertSucceeds(getMetadata(ref(storageFor(uid), own.fullPath)));
  await assertSucceeds(getMetadata(ref(storageFor('techknow-superadmin', { superAdmin: true }), own.fullPath)));
  for (const uid of [null, 'other', 'foreign']) await assertFails(getMetadata(ref(storageFor(uid), own.fullPath)));
  await assertFails(listAll(ref(storageFor('customer'), 'review-proofs')));
});

test('receipt images just under 5 MB are accepted', async () => {
  await assertSucceeds(uploadBytes(ref(storageFor('customer'), 'review-proofs/customer/large.png'),
    new Uint8Array(5 * 1024 * 1024 - 1), { contentType: 'image/png' }));
});

test('legacy store reviews reach their owner before directory migration', async () => {
  const storeId = 'nDOOet6nFOg6ghFTnJzao8zdXRH2';
  await seed({ [`stores/${storeId}`]: store('owner'),
    'users/owner': profile('owner', { role: 'Store Admin', storeId }) });
  const runtime = { db: db('customer'), auth: { currentUser: {
    uid: 'customer', email: 'customer@example.test', displayName: 'Customer',
  } } };
  const service = loadService('reviews', {
    '../firebase': runtime, 'firebase/firestore': require('firebase/firestore'),
    'react-native': { Platform: { OS: 'web' } }, 'expo/fetch': { fetch: global.fetch },
  });
  const id = await service.submitReview({ storeId, rating: 5, feedback: 'Good visit',
    proofFile: { dataUrl: 'data:image/jpeg;base64,AAAA', fileSize: 100, fileName: 'receipt.jpg' } });
  const review = (await assertSucceeds(getDoc(doc(db('owner'), 'reviews', id)))).data();
  assert.equal(review.storeId, storeId);
  assert.equal(review.storeName, 'Alpha Tech Test Store');
  await assertFails(getDoc(doc(db('foreign'), 'reviews', id)));
});

test('inline receipt image is saved in Firestore and readable only by its customer and store admin', async () => {
  const customerDb = db('customer');
  const runtime = { db: customerDb,
    auth: { currentUser: { uid: 'customer', email: 'customer@example.test' } },
  };
  const service = loadService('reviews', {
    '../firebase': runtime,
    'firebase/firestore': require('firebase/firestore'),
    'firebase/storage': new Proxy({}, { get() { throw new Error('Proofs must not use Storage'); } }),
  });
  const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(680 * 1024);
  const id = await service.submitReview({ storeId: 'shop', rating: 5, feedback: 'Receipt attached',
    proofFile: { dataUrl, fileSize: 5 * 1024 * 1024 - 1, fileName: 'receipt.jpg' } });
  const review = (await assertSucceeds(getDoc(doc(db('owner'), 'reviews', id)))).data();
  assert.equal(review.storeId, 'shop');
  assert.equal(review.proofFileName, 'receipt.jpg');
  assert.equal(review.proofFile, '');
  assert.equal(review.proofStoragePath, '');
  assert.equal(review.proofFileUrl, dataUrl);
  await assertSucceeds(getDoc(doc(customerDb, 'reviews', id)));
  await assertFails(getDoc(doc(db('foreign'), 'reviews', id)));
  await assertFails(getDoc(doc(db('other'), 'reviews', id)));
  await assertFails(getDoc(doc(db(), 'reviews', id)));
  const template = { ...review, createdAt: stamp(), updatedAt: stamp() };
  await assertFails(setDoc(doc(customerDb, 'reviews/missing-proof'), { ...template,
    proofFileUrl: '', proofFileName: '' }));
  for (const proofFileUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:application/pdf;base64,JVBERg==',
    'data:image/jpeg;base64,' + 'A'.repeat(700 * 1024)]) {
    await assertFails(setDoc(doc(customerDb, 'reviews/invalid-proof'), { ...template, proofFileUrl }));
  }
});
test('permit uploads require an owned pending submission and cannot be read by other stores', async () => {
  await seed({ 'permitSubmissions/upload': { uid: 'owner', storeId: 'shop', status: 'uploading' } });
  const file = 'permit-submissions/owner/upload/permit.pdf';
  const bytes = new Uint8Array([37, 80, 68, 70]);
  await assertFails(uploadBytes(ref(storageFor('foreign'), file), bytes, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(storageFor('owner'), 'permit-submissions/owner/missing/permit.pdf'), bytes, { contentType: 'application/pdf' }));
  await assertSucceeds(uploadBytes(ref(storageFor('owner'), file), bytes, { contentType: 'application/pdf' }));
  await assertSucceeds(getMetadata(ref(storageFor('owner'), file)));
  await assertSucceeds(getMetadata(ref(storageFor('techknow-superadmin', { superAdmin: true }), file)));
  for (const uid of [null, 'customer', 'foreign']) await assertFails(getMetadata(ref(storageFor(uid), file)));
  await assertFails(deleteObject(ref(storageFor('owner'), file)));
});
test('product image writes are store-scoped and suspended users lose Storage access', async () => {
  const file = 'product-images/shop/image.png';
  await assertSucceeds(uploadBytes(ref(storageFor('owner'), file), new Uint8Array([1]), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(storageFor('foreign'), file), new Uint8Array([1]), { contentType: 'image/png' }));
  await assertSucceeds(getMetadata(ref(storageFor('customer'), file)));
  await seed({ 'users/customer': profile('customer', { status: 'Suspended' }) });
  await assertFails(getMetadata(ref(storageFor('customer'), file)));
  await assertFails(getMetadata(ref(storageFor(), file)));
});
