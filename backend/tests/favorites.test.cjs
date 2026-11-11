const test = require("node:test");
const assert = require("node:assert/strict");
const { loadService } = require("./helpers.cjs");

// In-memory stream adapter; these tests exercise service behavior, not Firestore rules.
function favoritesStore(initial = {}) {
  const records = new Map(Object.entries(initial));
  const listeners = new Set();
  const auth = { currentUser: { uid: "customer-a" } };
  const db = {};
  let failWrites = false;
  const emit = (listener) => listener.onChange({
    docs: [...records].filter(([, data]) => data.userId === listener.query.constraint.value)
      .map(([id, data]) => ({ id, data: () => ({ ...data }) })),
  });
  const notify = () => listeners.forEach(emit);
  const api = loadService("favorites", {
    "../firebase": { auth, db },
    "firebase/firestore": {
      collection: (_db, name) => ({ name }),
      where: (field, op, value) => ({ field, op, value }),
      query: (collection, constraint) => {
        assert.equal(collection.name, "favorites");
        assert.equal(constraint.field, "userId");
        assert.equal(constraint.op, "==");
        return { collection, constraint };
      },
      doc: (_db, name, id) => {
        assert.equal(name, "favorites");
        return { id };
      },
      onSnapshot: (query, onChange) => {
        const listener = { query, onChange };
        listeners.add(listener);
        emit(listener);
        return () => listeners.delete(listener);
      },
      serverTimestamp: () => ({ seconds: 500 }),
      setDoc: async (reference, data) => {
        if (failWrites) throw new Error("Write rejected");
        records.set(reference.id, data);
        notify();
      },
      deleteDoc: async (reference) => {
        if (failWrites) throw new Error("Write rejected");
        records.delete(reference.id);
        notify();
      },
    },
  });
  return { api, records, auth, listeners, rejectWrites: () => { failWrites = true; } };
}

const saved = (userId, productId, seconds) => ({
  userId, productId, product: "Gaming monitor", shop: "Local tech shop", price: "₱5,000.00",
  imageUrl: "https://example.com/monitor.png", createdAt: { seconds },
});

test("favorites stream shows only the requested customer's products, newest first, and can unsubscribe", () => {
  const fake = favoritesStore({
    "customer-a_old": saved("customer-a", "old", 10),
    "customer-b_private": saved("customer-b", "private", 90),
    "customer-a_new": saved("customer-a", "new", 40),
  });
  let visible;
  const unsubscribe = fake.api.watchFavorites("customer-a", (items) => { visible = items; });
  assert.deepEqual(Array.from(visible, (item) => item.productId), ["new", "old"]);
  assert.equal(visible[0].shop, "Local tech shop");
  assert.equal(visible[0].imageUrl, "https://example.com/monitor.png");
  unsubscribe();
  assert.equal(fake.listeners.size, 0);
});

test("removing and undoing a favorite updates the live list without changing another customer's favorite", async () => {
  const original = saved("customer-a", "monitor", 10);
  const fake = favoritesStore({
    "customer-a_monitor": original,
    "customer-b_monitor": saved("customer-b", "monitor", 20),
  });
  let visible;
  fake.api.watchFavorites("customer-a", (items) => { visible = items; });
  await fake.api.setFavorite("monitor", {}, false);
  assert.equal(visible.length, 0);
  assert.equal(fake.records.has("customer-a_monitor"), false);
  assert.equal(fake.records.has("customer-b_monitor"), true);
  await fake.api.setFavorite("monitor", {
    title: original.product, shopName: original.shop, price: original.price, imageUrl: original.imageUrl,
  }, true);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].product, original.product);
  assert.equal(visible[0].price, original.price);
  assert.equal(visible[0].shop, original.shop);
  assert.equal(visible[0].imageUrl, original.imageUrl);
  assert.equal(fake.records.size, 2);
});

test("signed-out users cannot add or remove favorites", async () => {
  const fake = favoritesStore({ "customer-a_monitor": saved("customer-a", "monitor", 10) });
  fake.auth.currentUser = null;
  await assert.rejects(fake.api.setFavorite("monitor", {}, false), /sign in/);
  await assert.rejects(fake.api.setFavorite("keyboard", { title: "Keyboard" }, true), /sign in/);
  assert.equal(fake.records.size, 1);
});

test("failed removal is reported and leaves the saved product in the list", async () => {
  const fake = favoritesStore({ "customer-a_monitor": saved("customer-a", "monitor", 10) });
  let visible;
  fake.api.watchFavorites("customer-a", (items) => { visible = items; });
  fake.rejectWrites();
  await assert.rejects(fake.api.setFavorite("monitor", {}, false), /Write rejected/);
  assert.equal(visible.length, 1);
  assert.equal(fake.records.size, 1);
});
