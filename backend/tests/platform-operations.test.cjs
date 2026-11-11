const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperations, SUPER_ADMIN_UID } = require('../functions/operations.cjs');
const { fakeStore } = require('./helpers.cjs');

function fixture(options = {}) {
  const fake = fakeStore({
    [`users/${SUPER_ADMIN_UID}`]: { role: 'Super Admin', status: 'Active' },
    'users/owner': { role: 'Store Admin', storeId: 's1', status: 'Pending Verification' },
    'stores/s1': { ownerId: 'owner', status: 'Pending Verification' },
    'storeDirectory/s1': { id: 's1', name: 'Shop', address: '', latitude: null, longitude: null, status: 'Pending Verification', verificationStatus: 'pending' },
    'reviews/r1': { review: 'Original feedback', rating: 4, storeId: 's1', status: 'Pending', flagged: false },
  }, options);
  const accounts = new Map([['owner', { email: 'owner@example.test', disabled: false }]]);
  accounts.set(SUPER_ADMIN_UID, { disabled: false, customClaims: { superAdmin: true } });
  const revocations = [];
  const auth = {
    getUser: async uid => ({ ...accounts.get(uid) }),
    updateUser: async (uid, changes) => {
      accounts.set(uid, { ...accounts.get(uid), ...changes });
      if (options.failAfterAuth) options.failCommit = true;
    },
    revokeRefreshTokens: async uid => revocations.push(uid),
  };
  return { ...fake, accounts, revocations, ops: createOperations({ auth, db: fake.runtime.db, timestamp: () => 'server-time', error: (code, message) => Object.assign(new Error(message), { code }) }) };
}
const request = data => ({ auth: { uid: SUPER_ADMIN_UID, token: { superAdmin: true } }, data });
const logs = fake => [...fake.data.entries()].filter(([path]) => path.startsWith('auditLogs/')).map(([, value]) => value);
const pendingReport = fake => { fake.data.get('reviews/r1').reviewReport = { status: 'pending', target: 'review', reason: 'Store report' }; };

test('privileged endpoints reject unauthenticated, forged-role and non-designated accounts', async () => {
  const fake = fixture();
  for (const auth of [null, { uid: 'owner', token: { superAdmin: true } }, { uid: SUPER_ADMIN_UID, token: {} }]) {
    await assert.rejects(fake.ops.setAccountStatus({ auth, data: {} }), { code: 'permission-denied' });
    await assert.rejects(fake.ops.setReviewFlag({ auth, data: {} }), { code: 'permission-denied' });
  }
  assert.equal(logs(fake).length, 0);
});

test('suspension disables Auth, revokes refresh tokens, updates shop and persists audit', async () => {
  const fake = fixture();
  await fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Suspend', reason: 'Investigate report' }));
  assert.equal(fake.accounts.get('owner').disabled, true);
  assert.deepEqual(fake.revocations, ['owner']);
  assert.equal(fake.data.get('stores/s1').status, 'Suspended');
  assert.equal(fake.data.get('storeDirectory/s1').status, 'Suspended');
  assert.equal(fake.data.get('users/owner').status, 'Suspended');
  assert.equal(logs(fake)[0].status, 'completed');
  await fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Restore', reason: 'Investigation complete' }));
  assert.equal(fake.accounts.get('owner').disabled, false);
  assert.equal(fake.data.get('users/owner').status, 'Pending Verification');
  assert.equal(fake.data.get('stores/s1').status, 'Pending Verification');
  assert.equal(fake.data.get('storeDirectory/s1').status, 'Pending Verification');
  assert.equal(logs(fake).length, 2);
});

test('restoration preserves an Auth restriction that predated the suspension', async () => {
  const fake = fixture();
  fake.accounts.get('owner').disabled = true;
  await fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Suspend', reason: 'Investigate' }));
  await fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Restore', reason: 'Complete' }));
  assert.equal(fake.accounts.get('owner').disabled, true);
});

test('cannot suspend self, another privileged account, or an unrelated store', async () => {
  const fake = fixture();
  await assert.rejects(fake.ops.setAccountStatus(request({ uid: SUPER_ADMIN_UID, action: 'Suspend', reason: 'Test' })), { code: 'failed-precondition' });
  fake.accounts.get('owner').customClaims = { superAdmin: true };
  await assert.rejects(fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Suspend', reason: 'Test' })), { code: 'failed-precondition' });
  fake.accounts.get('owner').customClaims = {};
  fake.data.get('stores/s1').ownerId = 'someone-else';
  await assert.rejects(fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Suspend', reason: 'Test' })), { code: 'failed-precondition' });
  assert.equal(fake.accounts.get('owner').disabled, false);
});

test('cross-service failure records reconciliation and never reports success', async () => {
  const fake = fixture({ failAfterAuth: true });
  await assert.rejects(fake.ops.setAccountStatus(request({ uid: 'owner', action: 'Suspend', reason: 'Test' })), { code: 'internal' });
  assert.equal(fake.accounts.get('owner').disabled, true);
  assert.equal(fake.data.get('users/owner').status, 'Pending Verification');
  assert.equal(logs(fake)[0].status, 'reconciliation_required');
  assert.ok(fake.data.get('users/owner').adminOperationId);
});

test('concurrent suspensions allow only one Auth operation and preserve restore state', async () => {
  const fake = fixture();
  const data = request({ uid: 'owner', action: 'Suspend', reason: 'Investigate' });
  const results = await Promise.allSettled([fake.ops.setAccountStatus(data), fake.ops.setAccountStatus(data)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(fake.revocations.length, 1);
  assert.equal(fake.data.get('users/owner').authDisabledBeforeSuspension, false);
  assert.equal(fake.data.get('users/owner').adminOperationId, null);
});

test('review moderation preserves content and commits the audit atomically', async () => {
  const fake = fixture();
  pendingReport(fake);
  await fake.ops.setReviewFlag(request({ reviewId: 'r1', flagged: true, reason: 'Investigate' }));
  assert.equal(fake.data.get('reviews/r1').review, 'Original feedback');
  assert.equal(fake.data.get('reviews/r1').rating, 4);
  assert.equal(fake.data.get('reviews/r1').flagged, true);
  assert.equal(logs(fake)[0].action, 'Flag review');
  const failure = fixture({ failCommit: true });
  pendingReport(failure);
  await assert.rejects(failure.ops.setReviewFlag(request({ reviewId: 'r1', flagged: true, reason: 'Investigate' })));
  assert.equal(failure.data.get('reviews/r1').flagged, false);
  assert.equal(logs(failure).length, 0);
});

test('only the owning store admin can approve a pending, unreported review', async () => {
  const fake = fixture();
  const ownerRequest = { auth: { uid: 'owner', token: {} }, data: { reviewId: 'r1' } };
  await assert.rejects(fake.ops.approveStoreReview(request({ reviewId: 'r1' })), { code: 'permission-denied' });
  const result = await fake.ops.approveStoreReview(ownerRequest);
  assert.deepEqual(result, { reviewId: 'r1', status: 'Approved' });
  assert.equal(fake.data.get('reviews/r1').status, 'Approved');
  assert.equal(fake.data.get('reviews/r1').approvedBy, 'owner');
  assert.equal(logs(fake)[0].action, 'Approve store review');

  const reported = fixture();
  reported.data.get('reviews/r1').reviewReport = { status: 'pending' };
  await assert.rejects(reported.ops.approveStoreReview(ownerRequest), { code: 'failed-precondition' });
  assert.equal(reported.data.get('reviews/r1').status, 'Pending');

  const otherStore = fixture();
  otherStore.data.get('reviews/r1').storeId = 'another-store';
  await assert.rejects(otherStore.ops.approveStoreReview(ownerRequest), { code: 'not-found' });
  assert.equal(logs(otherStore).length, 0);
});

test('superadmin can manage store-approved reviews and pending store reports', async () => {
  const ownerRequest = { auth: { uid: 'owner', token: {} }, data: { reviewId: 'r1' } };
  const approved = fixture();
  approved.data.get('reviews/r1').proofFileUrl = 'https://example.test/receipt.jpg';
  await approved.ops.approveStoreReview(ownerRequest);
  await assert.rejects(approved.ops.setReviewAction(request({ reviewId: 'r1', action: 'approveReview' })), { code: 'failed-precondition' });
  await approved.ops.setReviewAction(request({ reviewId: 'r1', action: 'verifyProof' }));
  assert.equal(approved.data.get('reviews/r1').proofVerified, true);
  assert.equal(approved.data.get('reviews/r1').lastReviewAction.action, 'verifyProof');
  await approved.ops.setReviewFlag(request({ reviewId: 'r1', flagged: true, reason: 'Investigate' }));
  assert.equal(approved.data.get('reviews/r1').flagged, true);
  assert.equal(approved.data.get('reviews/r1').lastReviewAction.action, 'flagRedundant');
  assert.equal(approved.data.get('reviews/r1').status, 'Approved');
  assert.equal(approved.data.get('reviews/r1').approvedBy, 'owner');

  const unreported = fixture();
  await assert.rejects(unreported.ops.setReviewAction(request({ reviewId: 'r1', action: 'flagRedundant', reason: 'Duplicate' })), { code: 'failed-precondition' });

  const reported = fixture();
  reported.data.get('reviews/r1').proofFileUrl = 'https://example.test/receipt.jpg';
  await reported.ops.reportStoreReview({ ...ownerRequest, data: { reviewId: 'r1', target: 'proof', reason: 'Inappropriate image' } });
  assert.equal(reported.data.get('reviews/r1').reviewReport.status, 'pending');
  await assert.rejects(reported.ops.approveStoreReview(ownerRequest), { code: 'failed-precondition' });
  await reported.ops.setReviewAction(request({ reviewId: 'r1', action: 'approveReview' }));
  assert.equal(reported.data.get('reviews/r1').status, 'Approved');
  assert.equal(reported.data.get('reviews/r1').reviewReport.status, 'actioned');
  await assert.rejects(reported.ops.setReviewAction(request({ reviewId: 'r1', action: 'approveReview' })), { code: 'failed-precondition' });
});

test('a later proof report cannot cause a second approval of a store-approved review', async () => {
  const fake = fixture();
  fake.data.get('reviews/r1').proofFileUrl = 'https://example.test/receipt.jpg';
  await fake.ops.approveStoreReview({ auth: { uid: 'owner', token: {} }, data: { reviewId: 'r1' } });
  await fake.ops.reportStoreReview({ auth: { uid: 'owner', token: {} }, data: { reviewId: 'r1', target: 'proof', reason: 'Offensive image' } });
  await assert.rejects(fake.ops.setReviewAction(request({ reviewId: 'r1', action: 'approveReview' })), { code: 'failed-precondition' });
  assert.equal(fake.data.get('reviews/r1').approvedBy, 'owner');
  await fake.ops.setReviewAction(request({ reviewId: 'r1', action: 'verifyProof' }));
  assert.equal(fake.data.get('reviews/r1').status, 'Approved');
  assert.equal(fake.data.get('reviews/r1').reviewReport.status, 'actioned');
});

test('reasons and target IDs are validated before mutations', async () => {
  const fake = fixture();
  for (const data of [{ uid: 'owner', action: 'Suspend', reason: ' ' }, { uid: 'users/owner', action: 'Suspend', reason: 'test' }]) {
    await assert.rejects(fake.ops.setAccountStatus(request(data)), { code: 'invalid-argument' });
  }
  assert.equal(logs(fake).length, 0);
});

test('all privileged operations reject disabled, revoked, demoted and inactive admins', async () => {
  for (const mutate of [
    f => { f.accounts.get(SUPER_ADMIN_UID).disabled = true; },
    f => { f.accounts.get(SUPER_ADMIN_UID).customClaims = {}; },
    f => { f.accounts.get(SUPER_ADMIN_UID).tokensValidAfterTime = '2026-10-29T00:00:00Z'; },
    f => { f.data.delete(`users/${SUPER_ADMIN_UID}`); },
    f => { f.data.get(`users/${SUPER_ADMIN_UID}`).status = 'Suspended'; },
    f => { f.data.get(`users/${SUPER_ADMIN_UID}`).role = 'Customer'; },
  ]) {
    const fake = fixture();
    mutate(fake);
    for (const [operation, data] of [
      ['setAccountStatus', { uid: 'owner', action: 'Suspend', reason: 'Test' }],
      ['setReviewFlag', { reviewId: 'r1', flagged: true, reason: 'Test' }],
      ['setStoreProductLimit', { storeId: 's1', productLimit: 0 }],
    ]) {
      await assert.rejects(fake.ops[operation](request(data)), { code: 'permission-denied' });
    }
    assert.equal(logs(fake).length, 0);
    assert.equal(fake.accounts.get('owner').disabled, false);
  }
});

test('a transaction retry rechecks the super-admin profile before committing', async () => {
  const fake = fixture({ retryOnce: data => { data.get(`users/${SUPER_ADMIN_UID}`).status = 'Suspended'; } });
  pendingReport(fake);
  await assert.rejects(fake.ops.setReviewFlag(request({ reviewId: 'r1', flagged: true, reason: 'Test' })), { code: 'permission-denied' });
  assert.equal(fake.data.get('reviews/r1').flagged, false);
  assert.equal(logs(fake).length, 0);
});

test('a fresh sign-in after token revocation can perform authorized operations', async () => {
  const fake = fixture();
  pendingReport(fake);
  fake.accounts.get(SUPER_ADMIN_UID).tokensValidAfterTime = '2026-10-29T00:00:00Z';
  const input = request({ reviewId: 'r1', flagged: true, reason: 'Test' });
  input.auth.token.auth_time = Date.parse('2026-10-29T00:01:00Z') / 1000;
  await fake.ops.setReviewFlag(input);
  assert.equal(fake.data.get('reviews/r1').flagged, true);
  input.auth.token.auth_time -= 120;
  await assert.rejects(fake.ops.setReviewFlag(input), { code: 'permission-denied' });
});
