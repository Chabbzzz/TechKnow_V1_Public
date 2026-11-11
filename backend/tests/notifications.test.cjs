const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeStore, loadService } = require("./helpers.cjs");
const { createStoreService } = require("../services/admin");
const { createOperations } = require('../functions/operations.cjs');

const joinedAt = "2026-10-20T00:00:00.000Z";
const uploadedAt = "2026-10-26T00:00:00.000Z";
function setup() {
  const state = { auth: { currentUser: { uid: "customer" } }, db: {}, reads: ["earlier:review:Approved"] };
  const service = loadService("notifications", {
    "../firebase": state,
    "firebase/firestore": {
      doc: (_db, collection, uid) => ({ collection, uid }),
      arrayUnion: (...ids) => ({ union: ids }),
      setDoc: async (ref, fields, options) => {
        if (state.fail) throw new Error("Write rejected");
        assert.equal(ref.collection, "users");
        assert.equal(ref.uid, "customer");
        assert.equal(options.merge, true);
        state.reads = [...new Set([...state.reads, ...fields.notificationReadIds.union])];
      },
    },
  });
  return { service, state };
}
const product = (overrides = {}) => ({
  id: "keyboard", storeId: "store-a", storeName: "Charles Computers",
  name: "Mechanical Keyboard", createdAt: uploadedAt, ...overrides,
});

test("a store upload becomes an alert with its exact product and store identity", async () => {
  const fake = fakeStore({
    'users/owner': { role: 'Store Admin', storeId: 'store-a' },
    'stores/store-a': { ownerId: 'owner' },
  });
  fake.runtime.serverTimestamp = () => uploadedAt;
  const ops = createOperations({ auth: { getUser: async () => ({ disabled: false }) }, db: fake.runtime.db, timestamp: () => uploadedAt,
    error: (code, message) => Object.assign(new Error(message), { code }) });
  fake.runtime.app = { functions: () => ({ httpsCallable: () => async data => ({
    data: await ops.createStoreProduct({ auth: { uid: 'owner' }, data }),
  }) }) };
  const store = createStoreService(fake.runtime, { uid: "owner", role: "Store Admin", storeId: "store-a" });
  const ref = await store.createProduct({ name: "Mechanical Keyboard", category: "Peripherals", price: 1500, stock: 5 });
  const { service } = setup();
  const record = { ...fake.data.get(ref.path), id: ref.id, storeName: "Charles Computers" };
  const [alert] = service.productNotifications([record], joinedAt);
  assert.equal(alert.productId, ref.id);
  assert.equal(alert.storeId, "store-a");
  assert.equal(alert.category, "Alerts");
  assert.equal(alert.title, "New product at Charles Computers");
  assert.match(alert.message, /Charles Computers added Mechanical Keyboard/);
  assert.equal(alert.product, record);
});

test("stock, image and price edits do not create a fresh unread alert", () => {
  const { service } = setup();
  const [before] = service.productNotifications([product()], joinedAt);
  const [after] = service.productNotifications([product({ price: 2000, stock: 1, imageUrl: "new-image", updatedAt: "2026-10-27T00:00:00Z" })], joinedAt);
  assert.equal(after.id, before.id);
  assert.equal(after.timestamp, before.timestamp);
  const readIds = new Set([before.id]);
  assert.equal(readIds.has(after.id), true);
});

test("alerts exclude old, undated, archived, demo and unverified products", () => {
  const { service } = setup();
  const alerts = service.productNotifications([
    product({ createdAt: "2026-10-01T00:00:00Z" }), product({ createdAt: null }),
    product({ createdAt: "invalid" }), product({ archived: true }),
    product({ id: "presentation-product-demo" }), product({ storeName: "" }),
    product({ storeId: "" }), product({ name: "" }),
  ], joinedAt);
  assert.equal(alerts.length, 0);
  assert.equal(service.productNotifications([product()], null).length, 0);
});

test("products added while offline remain available and sort by creation time", () => {
  const { service } = setup();
  const alerts = service.productNotifications([
    product({ id: "earlier", createdAt: { toMillis: () => Date.parse(joinedAt) } }),
    product({ id: "latest" }),
    product({ id: "other-store", storeId: "store-b", storeName: "Another Store" }),
  ], joinedAt);
  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].id, "product:latest:created");
  assert.equal(alerts[2].id, "product:earlier:created");
  assert.match(alerts[1].message, /^Another Store added/);
  assert.equal(service.notificationTimestamp(alerts[0].timestamp), Date.parse(uploadedAt));
});

test("reading one or all alerts preserves previous read IDs across concurrent writes", async () => {
  const { service, state } = setup();
  await Promise.all([
    service.markNotificationsRead("customer", ["product:a:created"]),
    service.markNotificationsRead("customer", ["product:b:created", "product:b:created"]),
  ]);
  assert.deepEqual(state.reads, ["earlier:review:Approved", "product:a:created", "product:b:created"]);
  await service.markNotificationsRead("customer", []);
  assert.equal(state.reads.length, 3);
});

test("read state cannot be saved for another account and write failures propagate", async () => {
  const { service, state } = setup();
  await assert.rejects(service.markNotificationsRead("other", ["product:a:created"]), /sign in/);
  state.fail = true;
  await assert.rejects(service.markNotificationsRead("customer", ["product:a:created"]), /Write rejected/);
  assert.deepEqual(state.reads, ["earlier:review:Approved"]);
  state.auth.currentUser = null;
  await assert.rejects(service.markNotificationsRead("customer", ["product:a:created"]), /sign in/);
});
