const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../web/admin.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '../dashboard-data.js'), 'utf8');
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 2);
}
const decode = value => value.replace(/&(?:quot|#39|lt|gt|amp);/g, text => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[text]));
const hostileId = `id' onmouseover='attack()' data-x='\"><img src=x onerror=attack()>`;
test('admin proof viewer opens inline Firestore images and existing receipt URLs', () => {
  for (const proofFileUrl of ['data:image/jpeg;base64,/9j/AA==', 'https://example.test/receipt.png']) {
    const elements = new Map();
    const context = { reportingReview: false, acceptingReviewIds: new Set(),
      window: { storeReviews: [{ id: 'r1', proofFileUrl, proofFile: '', proofFileName: 'receipt.jpg' }] },
      document: { getElementById: id => {
        if (!elements.has(id)) elements.set(id, { style: {}, reset() {}, removeAttribute(name) { delete this[name]; } });
        return elements.get(id);
      }, querySelectorAll: () => [] }, openModal: id => assert.equal(id, 'modal-proof'), updateReviewApproval() {}, updateReviewReportState() {},
    };
    vm.createContext(context);
    vm.runInContext(functionSource(html, 'openReviewProof'), context);
    context.openReviewProof('r1');
    elements.get('review-proof-image').onload();
    assert.equal(elements.get('review-proof-image').src, proofFileUrl);
    assert.equal(elements.get('review-proof-image').style.display, 'block');
    assert.doesNotMatch(html, /id="review-proof-file-name"/);
  }
});
test('untrusted reservation IDs remain a single argument and status markup is escaped', () => {
  const context = {};
  vm.createContext(context);
  for (const name of ['escapeReservationText', 'reservationActions', 'reservationStatusBadge', 'renderStars']) vm.runInContext(functionSource(html, name), context);
  const markup = context.reservationActions('pending', { id: hostileId });
  const handlers = [...markup.matchAll(/onclick="([^"]*)"/g)];
  assert.equal(handlers.length, 2);
  const calls = [];
  for (const [, handler] of handlers) vm.runInNewContext(decode(handler), { updateReservationStatus: (...args) => calls.push(args), attack() { throw new Error('Injected code executed'); } });
  assert.deepEqual(calls, [[hostileId, 'Accepted'], [hostileId, 'Rejected']]);
  assert.doesNotMatch(context.reservationStatusBadge('<img src=x onerror=attack()>'), /<img/);
  assert.doesNotMatch(context.reservationStatusBadge('__proto__'), /\[object Object\]/);
  for (const invalid of [-1, 6, Infinity, '5', null]) assert.doesNotThrow(() => context.renderStars(invalid));
});
test('stored review IDs and product IDs cannot break out of HTML event attributes', () => {
  const body = { innerHTML: '', querySelectorAll: () => [] };
  const context = { window: { storeReviews: [{ id: hostileId, rating: 5, review: 'Good', proofFileUrl: 'https://example.test/receipt.png' }] }, document: { getElementById: () => body }, reviews: [] };
  vm.createContext(context);
  for (const name of ['escapeReservationText', 'adminRecordDate', 'renderStars', 'renderReviews', 'statusBadge', 'renderInventoryTable']) vm.runInContext(functionSource(html, name), context);
  context.renderReviews();
  const proofButtonId = body.innerHTML.match(/data-review-proof="([^"]*)"/)[1];
  assert.equal(decode(proofButtonId), hostileId);
  assert.doesNotMatch(body.innerHTML, /<img src=x onerror=attack\(\)>/);
  const start = dashboard.indexOf('  function renderStoreProducts(');
  const end = dashboard.indexOf('\n  function renderStoreArchivedProducts(', start);
  vm.runInContext(dashboard.slice(start, end), context);
  context.window.renderInventoryTable = context.renderInventoryTable;
  context.renderStoreProducts([{ id: hostileId, stock: 1, name: 'Keyboard' }]);
  const ids = [];
  for (const [, action] of body.innerHTML.matchAll(/onclick='([^']*)'/g)) vm.runInNewContext(decode(action), { editProduct: id => ids.push(id), archiveProduct: id => ids.push(id), attack() { throw new Error('Injected code executed'); } });
  assert.deepEqual(ids, [hostileId, hostileId]);
});
