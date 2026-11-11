const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewNotificationDetails } = require('../domain/review-notifications');

test('customers receive a fresh outcome when an approved review is later reported and managed', () => {
  const review = { status: 'Pending', storeName: 'Example Shop', createdAt: '2026-11-09T00:00:00Z' };
  const submitted = reviewNotificationDetails(review, 'review-1');
  assert.equal(submitted.title, 'Review submitted');

  review.status = 'Approved';
  review.lastReviewAction = { action: 'approvedByStore', at: '2026-11-09T00:01:00Z' };
  const approved = reviewNotificationDetails(review, 'review-1');
  assert.equal(approved.statusLabel, 'Approved');
  assert.notEqual(approved.id, submitted.id);

  review.reviewReport = { status: 'pending', reportedAt: '2026-11-09T00:02:00Z' };
  review.lastReviewAction = { action: 'reported', at: '2026-11-09T00:02:00Z' };
  const reported = reviewNotificationDetails(review, 'review-1');
  assert.equal(reported.statusLabel, 'Under review');
  assert.notEqual(reported.id, approved.id);

  review.reviewReport.status = 'actioned';
  review.flagged = true;
  review.lastReviewAction = { action: 'flagRedundant', at: '2026-11-09T00:03:00Z' };
  const flagged = reviewNotificationDetails(review, 'review-1');
  assert.equal(flagged.statusLabel, 'Flagged');
  assert.notEqual(flagged.id, reported.id);
});

test('proof verification on an already approved review is shown as a new customer notification', () => {
  const review = {
    status: 'Approved', storeName: 'Example Shop',
    lastReviewAction: { action: 'approvedByStore', at: { seconds: 1794182400 } },
  };
  const approved = reviewNotificationDetails(review, 'review-2');
  review.proofVerified = true;
  review.lastReviewAction = { action: 'verifyProof', at: { seconds: 1794182460 } };
  const verified = reviewNotificationDetails(review, 'review-2');
  assert.equal(verified.title, 'Proof verified');
  assert.notEqual(verified.id, approved.id);
  assert.equal(verified.category, 'Reviews');
});
