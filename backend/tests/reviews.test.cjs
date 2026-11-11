const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeStore, loadService } = require("./helpers.cjs");
const proofPolicy = require("../domain/review-proofs");
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=';
function setup(options = {}) {
  const fake = fakeStore({ "storeDirectory/s1": { name: "Current store" } }, options);
  const service = loadService("reviews", {
    "../firebase": fake.runtime, "firebase/firestore": fake.modular,
    "firebase/storage": new Proxy({}, { get() { throw new Error("Proofs must not use Storage"); } }),
  });
  const submit = (proofFile) => service.submitReview({ storeId: "s1", rating: 5, feedback: "Good visit", proofFile });
  return { ...fake, service, submit };
}

test("review validates rating and existing store before writing", async () => {
  const fake = setup();
  for (const rating of [0, 6, 2.5]) {
    await assert.rejects(fake.service.submitReview({ storeId: "s1", rating, feedback: "Good" }));
  }
  await assert.rejects(fake.service.submitReview({ storeId: "missing", rating: 5, feedback: "Good" }));
  assert.equal(fake.data.size, 1);
  await assert.rejects(fake.submit(), { code: "validation/invalid-proof" });
  assert.equal(fake.data.size, 1);
  const id = await fake.service.submitReview({ storeId: "s1", rating: 5, feedback: "  Good  ",
    proofFile: { dataUrl: PNG, fileSize: 100, fileName: 'receipt.png' } });
  const review = fake.data.get(`reviews/${id}`);
  assert.equal(review.review, "Good");
  assert.equal(review.storeName, "Current store");
  assert.equal(review.status, "Pending");
  assert.equal(review.proofFileUrl, PNG);
  assert.equal(review.proofFileName, 'receipt.png');
  assert.equal(review.proofFile, '');
  assert.equal(review.proofStoragePath, '');
});

test("existing shops can receive reviews before their directory migration", async () => {
  const { getStoreListings } = require('../../constants/stores.js');
  for (const shop of getStoreListings()) {
    const fake = setup();
    const id = await fake.service.submitReview({ storeId: shop.id, rating: 5, feedback: "Good visit",
      proofFile: { dataUrl: PNG, fileSize: 100, fileName: 'receipt.png' } });
    assert.equal(fake.data.get(`reviews/${id}`).storeId, shop.id);
    assert.equal(fake.data.get(`reviews/${id}`).storeName, shop.name);
  }
});

test("live store restrictions suppress known listings and block review submission", async () => {
  const { getStoreListings } = require('../../constants/stores.js');
  const shop = getStoreListings()[0];
  for (const status of ['Suspended', 'Banned', 'Disabled']) {
    const fake = setup();
    fake.data.set(`storeDirectory/${shop.id}`, { name: shop.name, status });
    await assert.rejects(fake.service.submitReview({ storeId: shop.id, rating: 5, feedback: "Good",
      proofFile: { dataUrl: PNG, fileSize: 100, fileName: 'receipt.png' } }), /no longer available/);
    assert.equal([...fake.data.keys()].some(path => path.startsWith('reviews/')), false);
  }
});

test("proof image is stored once in Firestore with the selected store review", async () => {
  const fake = setup();
  const id = await fake.submit({ dataUrl: PNG, fileSize: 4 * 1024 * 1024, fileName: 'receipt.png' });
  const review = fake.data.get(`reviews/${id}`);
  assert.equal(review.storeId, 's1');
  assert.equal(review.proofFileUrl, PNG);
  assert.equal(review.proofFileName, 'receipt.png');
  assert.equal(review.proofFile, '');
  assert.equal(review.proofStoragePath, '');
});

test("source images must be nonempty and under 5 MB", async () => {
  const fake = setup();
  for (const fileSize of [0, -1, 5 * 1024 * 1024, 5 * 1024 * 1024 + 1, NaN, undefined]) {
    await assert.rejects(fake.submit({ dataUrl: PNG, fileSize }), { code: 'validation/invalid-proof' });
  }
  assert.equal(fake.data.size, 1);
  await fake.submit({ dataUrl: PNG, fileSize: 5 * 1024 * 1024 - 1 });
});

test("inline proof data rejects unsupported types, invalid encodings and oversized fields", async () => {
  const fake = setup();
  for (const dataUrl of [undefined, '', 'file:///receipt.png', 'https://example.test/receipt.png',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:application/pdf;base64,JVBERg==',
    'data:image/jpeg;base64,!!!!', 'data:image/jpeg;base64,AAA',
    'data:image/jpeg;base64,' + 'A'.repeat(proofPolicy.MAX_INLINE_PROOF_SIZE)]) {
    await assert.rejects(fake.submit({ dataUrl, fileSize: 100 }), { code: 'validation/invalid-proof' });
  }
  assert.equal(fake.data.size, 1);
});

test("large compressed proof fits in one Firestore document without duplicating image data", async () => {
  const fake = setup();
  const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(4 * Math.floor((proofPolicy.MAX_INLINE_PROOF_SIZE - 22) / 4));
  const id = await fake.submit({ dataUrl, fileSize: 5 * 1024 * 1024 - 1 });
  const review = fake.data.get(`reviews/${id}`);
  assert.ok(Buffer.byteLength(JSON.stringify(review)) < 1024 * 1024);
  assert.equal(review.proofFileUrl, dataUrl);
  assert.equal(review.proofFile, '');
});

test("failed submissions leave neither a partial review nor a separate proof record", async () => {
  const fake = setup({ failCommit: true });
  await assert.rejects(fake.submit({ dataUrl: PNG, fileSize: 100 }));
  assert.equal(fake.data.size, 1);
});
