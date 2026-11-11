const test = require('node:test');
const assert = require('node:assert/strict');
const { loadService } = require('./helpers.cjs');
const { MAX_PROOF_SIZE, MAX_INLINE_PROOF_SIZE } = require('../domain/review-proofs');

function setup({ platform = 'android', size = 4 * 1024 * 1024, encodings = ['/9j/AA=='] } = {}) {
  const calls = [], released = [];
  let attempt = 0;
  const service = loadService('review-proof-image', {
    'react-native': { Platform: { OS: platform } },
    'expo-file-system': { File: class { get size() { return size; } } },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      ImageManipulator: { manipulate: uri => {
        assert.equal(uri, 'file:///receipt.png');
        return {
          resize: dimensions => calls.push(dimensions),
          renderAsync: async () => ({
            saveAsync: async options => {
              calls.push(options);
              return { uri: 'file:///prepared.jpg', base64: encodings[Math.min(attempt++, encodings.length - 1)] };
            },
            release: () => released.push('image'),
          }),
          release: () => released.push('context'),
        };
      } },
    },
  });
  const asset = { uri: 'file:///receipt.png', type: 'image', fileName: 'receipt.png', width: 1200, height: 2400, fileSize: 1 };
  return { service, calls, released, asset };
}

test('mobile proof preparation preserves the whole receipt and produces an inline JPEG', async () => {
  const fake = setup();
  const proof = await fake.service.prepareProofImage(fake.asset);
  assert.equal(proof.fileSize, 4 * 1024 * 1024);
  assert.equal(proof.dataUrl, 'data:image/jpeg;base64,/9j/AA==');
  assert.equal(proof.fileName, 'receipt.jpg');
  assert.equal(fake.calls[0].height, 1280);
  assert.equal(Object.hasOwn(fake.calls[0], 'width'), false);
  assert.deepEqual(fake.released, ['image', 'context']);
});

test('proof preparation rejects actual source files at 5 MB despite smaller picker metadata', async () => {
  for (const size of [0, MAX_PROOF_SIZE, MAX_PROOF_SIZE + 1]) {
    const fake = setup({ size });
    await assert.rejects(fake.service.prepareProofImage(fake.asset), { code: 'validation/invalid-proof' });
    assert.equal(fake.calls.length, 0);
  }
});

test('large source images are recompressed until the complete data URL fits the Firestore budget', async () => {
  const fake = setup({ encodings: ['A'.repeat(MAX_INLINE_PROOF_SIZE), '/9j/AA=='] });
  const proof = await fake.service.prepareProofImage(fake.asset);
  assert.ok(proof.dataUrl.length <= MAX_INLINE_PROOF_SIZE);
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[2].compress < fake.calls[1].compress, true);
  assert.deepEqual(fake.released, ['image', 'context']);
});

test('small web images use their browser file size and can be prepared without enlargement', async () => {
  const fake = setup({ platform: 'web' });
  const proof = await fake.service.prepareProofImage({ ...fake.asset, width: 100, height: 200, file: { size: 4096 } });
  assert.equal(proof.fileSize, 4096);
  assert.equal(fake.calls[0].height, 200);
});

test('images that cannot fit fail clearly and release decoded native resources', async () => {
  const fake = setup({ encodings: ['A'.repeat(MAX_INLINE_PROOF_SIZE)] });
  await assert.rejects(fake.service.prepareProofImage(fake.asset), { code: 'validation/invalid-proof' });
  assert.equal(fake.released.length > 0, true);
  assert.equal(fake.released.filter(x => x === 'image').length, fake.released.filter(x => x === 'context').length);
});
