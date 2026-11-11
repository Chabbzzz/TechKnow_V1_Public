const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSession, signIn, SUPER_ADMIN_UID, createStoreService } = require("../services/admin");
const { fakeStore } = require("./helpers.cjs");
const session = { uid: "owner", role: "Store Admin", storeId: "s1" };
const initial = () => ({
  "users/owner": { role: "Store Admin", storeId: "s1", status: "Pending Verification" },
  "stores/s1": { ownerId: "owner", name: "Store" },
  "products/p1": { storeId: "s1", stock: 1, name: "Product" },
  "reservations/r1": { storeId: "s1", productId: "p1", status: "Pending", quantity: 1 },
  "reservations/r2": { storeId: "s1", productId: "p1", status: "Pending", quantity: 1 },
});

const reviewFixture = options => fakeStore({ ...initial(),
  'reviews/review1': { userId: 'customer', storeId: 's1', status: 'Pending', rating: 2,
    review: 'Original customer feedback', proofFileUrl: 'data:image/png;base64,AAAA' },
}, options);

test('free-plan review approval atomically preserves customer content and records an immutable audit', async () => {
  const fake = reviewFixture();
  const service = createStoreService(fake.runtime, session);
  assert.deepEqual(await service.approveReview('review1'), { reviewId: 'review1', status: 'Approved' });
  const review = fake.data.get('reviews/review1');
  assert.equal(review.status, 'Approved');
  assert.equal(review.approvedBy, 'owner');
  assert.equal(review.review, 'Original customer feedback');
  assert.equal(review.rating, 2);
  assert.equal(review.proofFileUrl, 'data:image/png;base64,AAAA');
  const audit = fake.data.get(`auditLogs/${review.storeReviewAuditId}`);
  assert.equal(audit.action, 'Approve store review');
  assert.equal(audit.storeId, 's1');
  await assert.rejects(service.approveReview('review1'), { code: 'failed-precondition' });
  assert.equal([...fake.data.keys()].filter(key => key.startsWith('auditLogs/')).length, 1);
});

test('free-plan proof reports block duplicate reports and approval, including after prior approval', async () => {
  const fake = reviewFixture();
  const service = createStoreService(fake.runtime, session);
  await service.approveReview('review1');
  await service.reportReview('review1', { target: 'proof', reason: '  Unreadable receipt  ' });
  const review = fake.data.get('reviews/review1');
  assert.equal(review.status, 'Approved');
  assert.equal(review.reviewReport.reason, 'Unreadable receipt');
  assert.equal(review.reviewReport.reporterUid, 'owner');
  assert.equal(fake.data.get(`auditLogs/${review.storeReviewAuditId}`).reportTarget, 'proof');
  await assert.rejects(service.reportReview('review1', { target: 'proof', reason: 'Again' }), { code: 'already-exists' });
  await assert.rejects(service.approveReview('review1'), { code: 'failed-precondition' });
});

test('free-plan review actions reject another store, restricted accounts, invalid reports and missing proof', async () => {
  for (const mutate of [
    fake => { fake.data.get('reviews/review1').storeId = 'other'; },
    fake => { fake.data.get('users/owner').status = 'Suspended'; },
    fake => { fake.data.get('users/owner').adminOperationId = 'restricted'; },
    fake => { fake.data.get('stores/s1').ownerId = 'other'; },
  ]) {
    const fake = reviewFixture(); mutate(fake);
    await assert.rejects(createStoreService(fake.runtime, session).approveReview('review1'), { code: 'permission-denied' });
    assert.equal(fake.data.get('reviews/review1').status, 'Pending');
  }
  const fake = reviewFixture();
  const service = createStoreService(fake.runtime, session);
  await assert.rejects(service.reportReview('review1', { target: 'proof', reason: ' ' }), { code: 'invalid-argument' });
  fake.data.get('reviews/review1').proofFileUrl = '';
  await assert.rejects(service.reportReview('review1', { target: 'proof', reason: 'Missing receipt' }), { code: 'failed-precondition' });
  await service.reportReview('review1', { target: 'review', reason: 'Report feedback' });
});

test('free-plan review retries recheck moderation and failed commits leave no partial approval or audit', async () => {
  const retry = reviewFixture({ retryOnce(data) { data.get('reviews/review1').reviewReport = { status: 'pending' }; } });
  await assert.rejects(createStoreService(retry.runtime, session).approveReview('review1'), { code: 'failed-precondition' });
  const failed = reviewFixture({ failCommit: true });
  await assert.rejects(createStoreService(failed.runtime, session).approveReview('review1'), /Commit rejected/);
  assert.equal(failed.data.get('reviews/review1').status, 'Pending');
  assert.equal([...failed.data.keys()].some(key => key.startsWith('auditLogs/')), false);
});

test('super admin requires the designated UID and a server-issued claim', async () => {
  for (const [uid, claims, allowed] of [['other', { superAdmin: true }, false], [SUPER_ADMIN_UID, {}, false], [SUPER_ADMIN_UID, { superAdmin: true }, true]]) {
    const fake = fakeStore({ [`users/${uid}`]: { role: 'Super Admin', status: 'Active' } });
    fake.runtime.auth.currentUser = { uid, getIdTokenResult: async () => ({ claims }) };
    if (allowed) assert.deepEqual(await resolveSession(fake.runtime, 'Super Admin'), { uid, role: 'Super Admin', storeId: null });
    else await assert.rejects(resolveSession(fake.runtime, 'Super Admin'), { code: 'permission-denied' });
  }
});

test('signing into the wrong portal signs out the rejected session', async () => {
  const fake = fakeStore(initial());
  let signedOut = false;
  fake.runtime.auth.signInWithEmailAndPassword = async () => ({ user: fake.runtime.auth.currentUser });
  fake.runtime.auth.signOut = async () => { signedOut = true; fake.runtime.auth.currentUser = null; };
  await assert.rejects(signIn(fake.runtime, { email: 'owner@example.test', password: 'test', role: 'Super Admin' }), { code: 'permission-denied' });
  assert.equal(signedOut, true);
});

test('a failed credential check does not sign out a pre-existing session', async () => {
  const fake = fakeStore(initial());
  fake.runtime.auth.signInWithEmailAndPassword = async () => { throw Object.assign(new Error('Invalid'), { code: 'auth/invalid-credential' }); };
  fake.runtime.auth.signOut = async () => { throw new Error('Should not sign out'); };
  await assert.rejects(signIn(fake.runtime, { email: 'owner@example.test', password: 'test', role: 'Super Admin' }), { code: 'auth/invalid-credential' });
  assert.equal(fake.runtime.auth.currentUser.uid, 'owner');
});

test("admin session restores auth before resolving the store owner", async () => {
  const fake = fakeStore(initial());
  fake.runtime.auth.currentUser = null;
  fake.runtime.authReady = Promise.resolve().then(() => { fake.runtime.auth.currentUser = { uid: "owner" }; });
  assert.deepEqual(await resolveSession(fake.runtime, "Store Admin"), session);
});

test("missing auth, customer, suspended admin and wrong owner cannot open dashboard", async () => {
  for (const mutate of [
    (fake) => { fake.runtime.auth.currentUser = null; },
    (fake) => { fake.data.get("users/owner").role = "Customer"; },
    (fake) => { fake.data.get("users/owner").status = "Suspended"; },
    (fake) => { fake.data.get("stores/s1").ownerId = "other"; },
  ]) {
    const fake = fakeStore(initial()); mutate(fake);
    await assert.rejects(resolveSession(fake.runtime, "Store Admin"), { code: "permission-denied" });
  }
  await assert.rejects(resolveSession(fakeStore(initial()).runtime, "Super Admin"), { code: "permission-denied" });
});

test("store queries are scoped and product updates reject cross-store access", async () => {
  const fake = fakeStore(initial());
  const service = createStoreService(fake.runtime, session);
  assert.equal(service.records("products").value, "s1");
  fake.data.get("products/p1").storeId = "other";
  await assert.rejects(service.updateProduct("p1", { stock: 0 }), { code: "permission-denied" });
  assert.equal(fake.data.get("products/p1").stock, 1);
});


test("product update cannot overwrite ownership or demand counters", async () => {
  const fake = fakeStore(initial());
  await createStoreService(fake.runtime, session).updateProduct("p1", { stock: 3, storeId: "other", reservationCount: 999 });
  const product = fake.data.get("products/p1");
  assert.equal(product.stock, 3);
  assert.equal(product.storeId, "s1");
  assert.equal(product.reservationCount, undefined);
});

test("two acceptance attempts for the last unit commit only one under serialized transactions", async () => {
  const fake = fakeStore(initial());
  const service = createStoreService(fake.runtime, session);
  const results = await Promise.allSettled([service.changeReservationStatus("r1", "Accepted"), service.changeReservationStatus("r2", "Accepted")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(fake.data.get("products/p1").stock, 0);
  await assert.rejects(service.changeReservationStatus("r1", "Accepted"), /Only pending/);
});

test("rejection restores legacy adjusted stock once; ordinary pending rejection leaves stock alone", async () => {
  const fake = fakeStore(initial());
  const service = createStoreService(fake.runtime, session);
  fake.data.get("reservations/r1").stockAdjusted = true;
  await service.changeReservationStatus("r1", "Rejected");
  assert.equal(fake.data.get("products/p1").stock, 2);
  await service.changeReservationStatus("r2", "Rejected");
  assert.equal(fake.data.get("products/p1").stock, 2);
  await assert.rejects(service.changeReservationStatus("r1", "Rejected"));
});

test("archive cleanup rechecks retention and cannot delete restored or foreign products", async () => {
  const fake = fakeStore(initial());
  const service = createStoreService(fake.runtime, session);
  await assert.rejects(service.deleteProduct("p1"), /Only archived/);
  Object.assign(fake.data.get("products/p1"), { archived: true, archivedAt: "2026-10-20" });
  await service.deleteProduct("p1", { expiredBefore: Date.parse("2026-10-01") });
  assert.equal(fake.data.has("products/p1"), true);
  fake.data.get("products/p1").storeId = "other";
  await assert.rejects(service.deleteProduct("p1"), { code: "permission-denied" });
});

test("mutations stop after account changes", async () => {
  const fake = fakeStore(initial());
  const service = createStoreService(fake.runtime, session);
  fake.runtime.auth.currentUser = { uid: "other" };
  await assert.rejects(service.changeReservationStatus("r1", "Accepted"), { code: "permission-denied" });
});
