const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtimeCode = fs.readFileSync(path.resolve(__dirname, "../../web/firebase-config.js"), "utf8");

test("browser runtime waits for compat auth restoration and unsubscribes the startup listener", async () => {
  let stopped = false;
  const auth = {
    currentUser: null,
    setPersistence: async () => {},
    onAuthStateChanged(callback) {
      queueMicrotask(() => {
        auth.currentUser = { uid: "restored-user" };
        callback(auth.currentUser);
      });
      return () => { stopped = true; };
    },
  };
  const firebase = {
    apps: [{ name: "techknow-store-portal", auth: () => auth, firestore: () => ({}) }],
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: "local" } } }),
    firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => "timestamp", delete: () => null } }),
  };
  const window = { firebase, techKnowFirebaseConfig: require("../config/firebase-config") };
  vm.runInNewContext(runtimeCode, { window, firebase, console, document: { body: { dataset: {} } } });
  await window.techKnowFirebase.authReady;
  assert.equal(window.techKnowFirebase.auth.currentUser.uid, "restored-user");
  assert.equal(window.techKnowFirebase.storage, null);
  assert.equal(stopped, true);
});

// Model LOCAL persistence by Firebase app name, including the customer default
// app. The old shared-default runtime fails the isolation assertions below.
function browser() {
  const firebase = {
    apps: [],
    initializeApp(config, name = '[DEFAULT]') {
      const listeners = new Set();
      const auth = {
        currentUser: null,
        persistence: null,
        async setPersistence(value) { this.persistence = value; },
        onAuthStateChanged(callback) {
          listeners.add(callback);
          queueMicrotask(() => { if (listeners.has(callback)) callback(this.currentUser); });
          return () => listeners.delete(callback);
        },
        async signInWithEmailAndPassword(uid) {
          this.currentUser = { uid };
          listeners.forEach(callback => callback(this.currentUser));
          return { user: this.currentUser };
        },
        async signOut() {
          this.currentUser = null;
          listeners.forEach(callback => callback(null));
        },
      };
      const db = { appName: name };
      const storage = { appName: name };
      const app = { name, options: config, auth: () => auth, firestore: () => db,
        storage: () => storage, functions: () => ({ appName: name, auth }) };
      this.apps.push(app);
      return app;
    },
    app(name = '[DEFAULT]') { return this.apps.find(app => app.name === name); },
  };
  firebase.auth = Object.assign(() => firebase.app().auth(), { Auth: { Persistence: { LOCAL: 'local' } } });
  firebase.firestore = Object.assign(() => firebase.app().firestore(), {
    FieldValue: { serverTimestamp: () => 'timestamp', delete: () => 'delete' },
  });
  firebase.storage = () => firebase.app().storage();
  const customer = firebase.initializeApp(require('../config/firebase-config'));
  async function open(authPortal) {
    const window = { firebase, techKnowFirebaseConfig: require('../config/firebase-config') };
    vm.runInNewContext(runtimeCode, { window, firebase, console,
      document: { body: { dataset: authPortal ? { authPortal } : {} } },
    });
    await window.techKnowFirebase.authReady;
    return window.techKnowFirebase;
  }
  return { firebase, customer, open };
}

test('customer and store login, signup and logout never replace the super-admin session', async () => {
  const { customer, open } = browser();
  const admin = await open('superadmin');
  await admin.auth.signInWithEmailAndPassword('techknow-superadmin');
  const adminEvents = [];
  const stop = admin.auth.onAuthStateChanged(user => adminEvents.push(user?.uid || null));
  await Promise.resolve();
  const store = await open();
  await customer.auth().signInWithEmailAndPassword('customer-1');
  await store.auth.signInWithEmailAndPassword('store-owner');
  await customer.auth().signOut();
  // Account creation also signs in the new user on the customer Auth instance.
  await customer.auth().signInWithEmailAndPassword('new-customer');
  await store.auth.signOut();
  assert.equal(admin.auth.currentUser.uid, 'techknow-superadmin');
  assert.deepEqual(adminEvents, ['techknow-superadmin']);
  stop();
});

test('portal login survives page navigation and reload with services bound to the same app', async () => {
  const { open, firebase } = browser();
  const login = await open('superadmin');
  await login.auth.signInWithEmailAndPassword('techknow-superadmin');
  const dashboard = await open('superadmin');
  assert.equal(dashboard.auth.currentUser.uid, 'techknow-superadmin');
  assert.equal(dashboard.app, login.app);
  assert.equal(dashboard.auth.persistence, 'local');
  assert.equal(dashboard.db.appName, dashboard.app.name);
  assert.equal(dashboard.storage.appName, dashboard.app.name);
  assert.equal(dashboard.app.functions().auth, dashboard.auth);
  assert.equal(firebase.apps.filter(app => app.name === dashboard.app.name).length, 1);
  const storeLogin = await open();
  await storeLogin.auth.signInWithEmailAndPassword('owner');
  const storeDashboard = await open();
  assert.equal(storeDashboard.auth.currentUser.uid, 'owner');
  assert.equal(storeDashboard.storage.appName, 'techknow-store-portal');
  assert.equal(dashboard.serverTimestamp(), 'timestamp');
  assert.equal(dashboard.deleteField(), 'delete');
});

test('super-admin logout still ends its own session without signing out customers or stores', async () => {
  const { open, customer } = browser();
  const admin = await open('superadmin');
  const store = await open();
  await admin.auth.signInWithEmailAndPassword('techknow-superadmin');
  await store.auth.signInWithEmailAndPassword('owner');
  await customer.auth().signInWithEmailAndPassword('customer');
  await admin.auth.signOut();
  assert.equal((await open('superadmin')).auth.currentUser, null);
  assert.equal(store.auth.currentUser.uid, 'owner');
  assert.equal(customer.auth().currentUser.uid, 'customer');
});

test('both super-admin pages select the same isolated portal session', () => {
  for (const page of ['superadmin-login.html', 'superadmin.html']) {
    const html = fs.readFileSync(path.resolve(__dirname, '../../web', page), 'utf8');
    assert.match(html, /<body\b[^>]*data-auth-portal="superadmin"/);
  }
});
