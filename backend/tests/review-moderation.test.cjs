const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fakeStore, loadService } = require('./helpers.cjs');
const { createService } = require('../services/review-moderation');
function fixture(options) {
  const store = fakeStore({
    'users/techknow-superadmin': { role: 'Super Admin', status: 'Active' },
    'users/customer': { role: 'Customer', status: 'Active' },
    'reviews/review': { userId: 'customer', review: 'Original', rating: 2, status: 'Approved' },
  }, options);
  store.runtime.auth.currentUser.uid = 'techknow-superadmin';
  return { ...store, service: createService(store.runtime, { uid: 'techknow-superadmin' }) };
}
test('warning targets the saved author and writes a private notice and audit atomically', async () => {
  const f = fixture();
  const result = await f.service.moderate('review', 'warning', '  Rude language  ');
  assert.equal(result.userId, 'customer');
  assert.equal(result.reason, 'Rude language');
  assert.equal(f.data.get('users/customer').status, 'Active');
  assert.equal(f.data.get('reviews/review').review, 'Original');
  assert.equal(f.data.get('moderationNotifications/' + result.notificationId).userId, 'customer');
  assert.equal(f.data.get('auditLogs/' + result.notificationId).status, 'completed');
  await assert.rejects(f.service.moderate('review', 'warning', 'Repeat'), /already been sent/);
  await f.service.moderate('review', 'suspend', 'Repeated rude language');
  assert.equal(f.data.get('users/customer').status, 'Suspended');
  assert.equal(f.data.get('users/customer').suspensionReason, 'Repeated rude language');
});
test('failed commits leave the account, review and notice unchanged', async () => {
  const f = fixture({ failCommit: true });
  await assert.rejects(f.service.moderate('review', 'suspend', 'Reason'), /Commit rejected/);
  assert.equal(f.data.get('users/customer').status, 'Active');
  assert.equal(f.data.size, 3);
});
test('empty reasons, admin targets and changed sessions are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.service.moderate('review', 'warning', ' '), /reason/);
  f.data.get('users/customer').role = 'Store Admin';
  await assert.rejects(f.service.moderate('review', 'suspend', 'Reason'), /Only the customer/);
  f.runtime.auth.currentUser.uid = 'other';
  await assert.rejects(f.service.moderate('review', 'warning', 'Reason'), /Sign in/);
});
test('suspended login signs out before returning an explicit suspension message', async () => {
  let signedOut = 0;
  const auth = { currentUser: { uid: 'customer' } };
  const { signInCustomer } = loadService('customer-auth', {
    '../firebase': { auth, db: {} },
    'firebase/auth': { signInWithEmailAndPassword: async () => ({ user: auth.currentUser }), signOut: async () => { signedOut++; } },
    'firebase/firestore': { doc: () => ({}), getDocFromServer: async () => ({ exists: () => true, data: () => ({ status: 'Suspended', suspensionReason: 'Rude language' }) }) },
  });
  await assert.rejects(signInCustomer('customer@example.test', 'password'), error => error.code === 'auth/account-suspended' && error.message.includes('Rude language'));
  assert.equal(signedOut, 1);
});

test('active login succeeds and an unavailable server profile never grants access', async () => {
  let signedOut = 0;
  let offline = false;
  const auth = { currentUser: { uid: 'customer' } };
  const { signInCustomer } = loadService('customer-auth', {
    '../firebase': { auth, db: {} },
    'firebase/auth': { signInWithEmailAndPassword: async () => ({ user: auth.currentUser }), signOut: async () => { signedOut++; } },
    'firebase/firestore': { doc: () => ({}), getDocFromServer: async () => {
      if (offline) throw new Error('Server unavailable');
      return { exists: () => true, data: () => ({ status: 'Active' }) };
    } },
  });
  assert.equal((await signInCustomer('customer@example.test', 'password')).user.uid, 'customer');
  assert.equal(signedOut, 0);
  offline = true;
  await assert.rejects(signInCustomer('customer@example.test', 'password'), /Server unavailable/);
  assert.equal(signedOut, 1);
});
