function eventMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function reviewNotificationDetails(review, id) {
  const rawStatus = String(review.status || 'Pending').toLowerCase();
  const status = ['approved', 'published'].includes(rawStatus) ? 'Approved'
    : ['rejected', 'hidden'].includes(rawStatus) ? 'Rejected' : 'Pending';
  const legacyStoreId = /^\d+$/.test(String(review.storeId || ''));
  const shop = legacyStoreId ? 'the shop' : review.storeName || 'the shop';
  const reported = review.reviewReport?.status === 'pending';
  const latestAction = review.lastReviewAction?.action;
  const action = status === 'Rejected' ? 'rejected'
    : reported ? 'reported'
      : latestAction || (review.proofFlagged ? 'reportImage' : review.flagged ? 'flagRedundant' : status);
  const details = {
    Pending: { icon: 'rate-review', title: 'Review submitted', message: `Your review for ${shop} is waiting for approval.`, tone: 'orange', statusLabel: 'Pending' },
    Approved: { icon: 'check-circle', title: 'Review approved', message: `Your review for ${shop} has been approved.`, tone: 'green', statusLabel: 'Approved' },
    approvedByStore: { icon: 'check-circle', title: 'Review approved', message: `Your review for ${shop} has been approved.`, tone: 'green', statusLabel: 'Approved' },
    approveReview: { icon: 'check-circle', title: 'Review approved', message: `Your review for ${shop} has been approved.`, tone: 'green', statusLabel: 'Approved' },
    reported: { icon: 'flag', title: 'Review under review', message: `The store reported your review for ${shop}. It is being reviewed.`, tone: 'orange', statusLabel: 'Under review' },
    verifyProof: { icon: 'verified', title: 'Proof verified', message: `The proof for your review of ${shop} was verified.`, tone: 'green', statusLabel: 'Verified' },
    flagRedundant: { icon: 'flag', title: 'Review flagged', message: `Your review for ${shop} was flagged as redundant.`, tone: 'red', statusLabel: 'Flagged' },
    reportImage: { icon: 'flag', title: 'Proof image flagged', message: `The proof image on your review of ${shop} was flagged.`, tone: 'red', statusLabel: 'Image flagged' },
    clearFlag: { icon: 'check-circle', title: 'Review flag cleared', message: `The flag on your review of ${shop} was cleared.`, tone: 'green', statusLabel: 'Cleared' },
    rejected: { icon: 'cancel', title: 'Review needs attention', message: `Your review for ${shop} was not approved.`, tone: 'red', statusLabel: 'Rejected' },
  };
  const outcome = details[action] || details[status];
  const timestampSource = reported ? review.reviewReport.reportedAt || review.updatedAt || review.createdAt
    : review.lastReviewAction?.at || review.updatedAt || review.createdAt;
  const eventTime = eventMillis(timestampSource);
  const eventKey = action === 'Pending' || action === 'Approved' || action === 'rejected'
    ? outcome.statusLabel : `${action}:${Number.isFinite(eventTime) ? eventTime : 'latest'}`;
  return { id: `${id}:review:${eventKey}`, reviewId: id, category: 'Reviews', ...outcome, timestampSource };
}

module.exports = { reviewNotificationDetails };
