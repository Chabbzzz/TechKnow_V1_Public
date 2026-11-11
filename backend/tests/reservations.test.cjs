const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../domain/reservations");
const { loadService, fakeStore } = require("./helpers.cjs");
const { createCustomerReservationCreator } = require('../functions/customer-reservations.cjs');

const initial = () => ({
  "users/owner": { role: "Customer", status: "Active" },
  "products/p1": { name: "Current name", price: 500, category: "GPU", stock: 1, storeId: "s1", reservationCount: 2 },
  "stores/s1": { name: "Current store" },
});
function service(fake) {
  const handler = createCustomerReservationCreator({ db: fake.runtime.db,
    timestamp: fake.runtime.serverTimestamp,
    error: (code, message) => Object.assign(new Error(message), { code }) });
  return loadService("reservations", { "../firebase": fake.runtime, "firebase/functions": {
    getFunctions: (_app, region) => { assert.equal(region, 'us-central1'); return {}; },
    httpsCallable: (_functions, name) => {
      assert.equal(name, 'createCustomerReservation');
      return async data => ({ data: await handler({ data,
        auth: { uid: fake.runtime.auth.currentUser.uid, token: {} } }) });
    },
  } });
}
const input = { productId: "p1", storeId: "s1", note: "  Please hold  " };

test("profile unsuccessful activity and history share all declined status aliases", () => {
  for (const status of ["Rejected", " REJECTED "]) {
    assert.deepEqual(policy.statusForReservation(status), { label: "Rejected", type: "declined" });
  }
  for (const status of ["Cancelled", "Canceled", "Failed", "Declined", "Denied", "Unsuccessful"]) {
    assert.deepEqual(policy.statusForReservation(status), { label: "Declined", type: "declined" });
  }
});

test("waiting-list and successful reservations are not counted as unsuccessful", () => {
  for (const status of [undefined, "Pending", "Waiting List", "waitlisted", "waiting-list"]) {
    assert.equal(policy.statusForReservation(status).type, "pending");
  }
  for (const status of ["Accepted", "Confirmed", "Ongoing"]) {
    assert.equal(policy.statusForReservation(status).type, "confirmed");
  }
  assert.equal(policy.statusForReservation("Completed").type, "completed");
});

test("reservation saves authoritative product/store details and does not deduct stock until acceptance", async () => {
  const fake = fakeStore(initial());
  const result = await service(fake).createReservation({ ...input, productName: "Stale name", price: "1" });
  const saved = fake.data.get(`reservations/${result.id}`);
  assert.equal(saved.product, "Current name");
  assert.equal(saved.price, "\u20b1500.00");
  assert.equal(saved.shop, "Current store");
  assert.equal(saved.note, "Please hold");
  assert.equal(saved.status, "Pending");
  assert.equal(fake.data.get("products/p1").stock, 1);
  assert.equal(fake.data.get("products/p1").reservationCount, 3);
});

test("Firestore fallback reserves a legacy shop before its public directory record is migrated", async () => {
  const fake = fakeStore(initial());
  fake.runtime.auth.currentUser = { uid: "owner", email: "owner@example.test", displayName: "Customer" };
  const firestore = {
    ...fake.modular,
    where: (...clause) => clause,
    query: (reference, clause) => reference.where(...clause),
    getDocs: (reference) => reference.get(),
  };
  const fallback = loadService("reservations", {
    "../firebase": fake.runtime,
    "firebase/firestore": firestore,
    "firebase/functions": {
      getFunctions: () => ({}),
      httpsCallable: () => async () => { throw Object.assign(new Error("Not deployed"), { code: "functions/not-found" }); },
    },
  });
  const result = await fallback.createReservation({ ...input, storeName: "Current store" });
  assert.equal(fake.data.get(`reservations/${result.id}`).shop, "Current store");
  assert.equal(fake.data.get("products/p1").reservationCount, 3);
  await assert.rejects(fallback.createReservation({ ...input, storeName: "Current store" }),
    { code: "already-exists" });
  assert.equal(fake.data.get("products/p1").reservationCount, 3);
});

test("transaction retry returns final waiting-list result and commits only one reservation/counter increment", async () => {
  const fake = fakeStore(initial(), { retryOnce(data) { data.get("products/p1").stock = 0; } });
  const result = await service(fake).createReservation(input);
  assert.equal(result.waitlisted, true);
  assert.equal(fake.data.get(`reservations/${result.id}`).status, "Waiting List");
  assert.equal(fake.data.get("products/p1").reservationCount, 3);
  assert.equal([...fake.data.keys()].filter((key) => key.startsWith("reservations/")).length, 1);
});

test("cross-store, deleted store, archived product and invalid stock requests do not write", async () => {
  for (const mutate of [
    (data) => { data["products/p1"].storeId = "other"; },
    (data) => { delete data["stores/s1"]; },
    (data) => { data["products/p1"].archived = true; },
    (data) => { data["products/p1"].stock = "invalid"; },
  ]) {
    const records = initial(); mutate(records);
    const fake = fakeStore(records);
    await assert.rejects(service(fake).createReservation(input));
    assert.equal([...fake.data.keys()].some((key) => key.startsWith("reservations/")), false);
    assert.equal(fake.data.get("products/p1").reservationCount, 2);
  }
});

test("failed commit leaves reservation and demand counter unchanged", async () => {
  const fake = fakeStore(initial(), { failCommit: true });
  await assert.rejects(service(fake).createReservation(input), /Commit rejected/);
  assert.equal(fake.data.get("products/p1").reservationCount, 2);
  assert.equal(fake.data.size, 3);
});

test("reservation requires a signed-in customer", async () => {
  const fake = fakeStore(initial()); fake.runtime.auth.currentUser = null;
  await assert.rejects(service(fake).createReservation(input), /sign in/);
});

test("legacy stock-adjusted reservations are accepted without a second deduction", () => {
  const result = policy.reservationTransition({
    storeId: "s1", nextStatus: "Accepted",
    reservation: { storeId: "s1", status: "Pending", stockAdjusted: true, quantity: 1 },
    product: { storeId: "s1", stock: 0 },
  });
  assert.equal(result.productChanges.stock, 0);
});

test("invalid transition, quantity, and cross-store product are rejected", () => {
  const args = {
    storeId: "s1", nextStatus: "Accepted",
    reservation: { storeId: "s1", status: "Pending", quantity: 1 },
    product: { storeId: "s1", stock: 3 },
  };
  assert.throws(() => policy.reservationTransition({ ...args, nextStatus: "anything" }));
  assert.throws(() => policy.reservationTransition({ ...args, reservation: { ...args.reservation, quantity: 0.5 } }));
  assert.throws(() => policy.reservationTransition({ ...args, product: { ...args.product, storeId: "other" } }));
});
