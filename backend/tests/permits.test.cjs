const test = require("node:test");
const assert = require("node:assert/strict");
const { createPermitService } = require("../services/permits");
const { fakeStore } = require("./helpers.cjs");
const file = { name: "permit.pdf", type: "application/pdf", size: 100 };
function setup(options) {
  const fake = fakeStore({
    "users/owner": { role: "Store Admin", status: "Active" },
    "stores/owner": { ownerId: "owner", name: "Actual store", status: "Active" },
    "storeDirectory/owner": { id: "owner", name: "Actual store", address: "", latitude: null, longitude: null, status: "Active", verificationStatus: "pending" },
  }, options);
  const paths = [];
  fake.runtime.storage = { ref: () => ({ child: (path) => ({ async put() { paths.push(path); } }) }) };
  return { ...fake, paths, service: createPermitService(fake.runtime) };
}

test("permit uploads under owner and commits all three records together", async () => {
  const fake = setup();
  const result = await fake.service.submit({ files: [file] });
  assert.equal(result.storeName, "Actual store");
  assert.match(fake.paths[0], new RegExp(`^permit-submissions/owner/${result.id}/`));
  assert.equal(fake.data.get(`permitSubmissions/${result.id}`).status, "pending");
  assert.equal(fake.data.get("users/owner").permitSubmissionId, result.id);
  assert.equal(fake.data.get("stores/owner").permitSubmissionId, result.id);
  assert.equal(fake.data.get("storeDirectory/owner").status, "Pending Verification");
});

test("failed final batch preserves user/store status and records uploaded paths for recovery", async () => {
  const fake = setup({ failCommit: true });
  await assert.rejects(fake.service.submit({ files: [file] }), /Commit rejected/);
  assert.equal(fake.data.get("users/owner").status, "Active");
  assert.equal(fake.data.get("stores/owner").status, "Active");
  assert.equal(fake.data.get("storeDirectory/owner").status, "Active");
  const failed = [...fake.data.entries()].find(([key]) => key.startsWith("permitSubmissions/"))[1];
  assert.equal(failed.status, "upload_failed");
  assert.equal(failed.documents.length, 1);
});

test("deleted user is not recreated by permit finalization", async () => {
  const fake = setup();
  await assert.rejects(fake.service.submit({ files: [file], onProgress() { fake.data.delete("users/owner"); } }), /Missing document/);
  assert.equal(fake.data.has("users/owner"), false);
  assert.equal(fake.data.get("stores/owner").status, "Active");
});

test("invalid or oversized permit files never create a submission", async () => {
  const fake = setup();
  for (const files of [[], [{ ...file, size: 11 * 1024 * 1024 }], [{ ...file, name: "program.exe" }]]) {
    await assert.rejects(fake.service.submit({ files }));
  }
  assert.equal(fake.data.size, 3);
  assert.equal(fake.paths.length, 0);
});

test('permit submission resolves a store ID distinct from its owner UID', async () => {
  const fake = setup();
  fake.data.get('users/owner').storeId = 'assigned-store';
  fake.data.set('stores/assigned-store', fake.data.get('stores/owner'));
  fake.data.set('storeDirectory/assigned-store', { ...fake.data.get('storeDirectory/owner'), id: 'assigned-store' });
  fake.data.delete('stores/owner');
  fake.data.delete('storeDirectory/owner');
  const result = await fake.service.submit({ files: [file] });
  assert.equal(fake.data.get(`permitSubmissions/${result.id}`).storeId, 'assigned-store');
  assert.equal(fake.data.get('stores/assigned-store').permitSubmissionId, result.id);
  assert.equal(fake.data.get('storeDirectory/assigned-store').status, 'Pending Verification');
  assert.match(fake.paths[0], /^permit-submissions\/owner\//);
});

test('a suspension during upload cannot be overwritten by permit finalization', async () => {
  const fake = setup();
  await assert.rejects(fake.service.submit({ files: [file], onProgress() {
    fake.data.get('users/owner').status = 'Suspended';
    fake.data.get('stores/owner').status = 'Suspended';
  } }), /no longer submit/);
  assert.equal(fake.data.get('users/owner').status, 'Suspended');
  assert.equal(fake.data.get('stores/owner').status, 'Suspended');
  assert.equal(fake.data.get('storeDirectory/owner').status, 'Active');
  const submission = [...fake.data.entries()].find(([key]) => key.startsWith('permitSubmissions/'))[1];
  assert.equal(submission.status, 'upload_failed');
});

test('restricted accounts and excessive files are rejected before uploading', async () => {
  for (const mutate of [
    f => { f.data.get('users/owner').status = 'Suspended'; },
    f => { f.data.get('stores/owner').status = 'Suspended'; },
    f => { f.data.get('users/owner').adminOperationId = 'pending'; },
    f => { f.data.get('users/owner').role = 'Customer'; },
  ]) {
    const fake = setup(); mutate(fake);
    await assert.rejects(fake.service.submit({ files: [file] }));
    assert.equal(fake.paths.length, 0);
  }
  const fake = setup();
  await assert.rejects(fake.service.submit({ files: Array(11).fill(file) }));
  assert.equal(fake.data.size, 3);
});
