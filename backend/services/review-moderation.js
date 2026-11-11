(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.techKnowReviewModeration = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ db, auth, serverTimestamp }, session) {
    return { async moderate(reviewId, action, reason) {
      if (auth.currentUser?.uid !== 'techknow-superadmin' || session.uid !== auth.currentUser.uid) throw new Error('Sign in to the superadmin account again.');
      if (!['warning', 'suspend'].includes(action)) throw new Error('Choose Warning or Suspend.');
      if (typeof reviewId !== 'string' || !reviewId || reviewId.includes('/')) throw new Error('Invalid review.');
      reason = String(reason || '').trim();
      if (!reason || reason.length > 1000) throw new Error('Enter a reason of 1 to 1000 characters.');
      const reviewRef = db.collection('reviews').doc(reviewId);
      const notification = db.collection('moderationNotifications').doc();
      return db.runTransaction(async transaction => {
        const admin = await transaction.get(db.collection('users').doc(session.uid));
        const snapshot = await transaction.get(reviewRef);
        if (!admin.exists || admin.data().role !== 'Super Admin' || admin.data().status !== 'Active') throw new Error('Superadmin access is required.');
        if (!snapshot.exists) throw new Error('This review no longer exists.');
        const review = snapshot.data();
        if (!review.userId || review.userId === session.uid) throw new Error('This review does not have an eligible customer account.');
        const userRef = db.collection('users').doc(review.userId);
        const user = await transaction.get(userRef);
        if (!user.exists || (user.data().role || 'Customer') !== 'Customer') throw new Error('Only the customer who wrote this review can receive this action.');
        if (['suspended', 'banned', 'disabled'].includes(String(user.data().status || '').toLowerCase()) || user.data().adminOperationId) throw new Error('This customer account is already restricted.');
        if (action === 'warning' && review.authorModerationId) throw new Error('A warning has already been sent for this review.');
        const data = { userId: review.userId, reviewId, action, reason, adminUid: session.uid, createdAt: serverTimestamp() };
        transaction.set(notification, data);
        transaction.set(db.collection('auditLogs').doc(notification.id), { ...data, target: reviewId, status: 'completed', notificationId: notification.id });
        transaction.update(reviewRef, { authorModerationId: notification.id, updatedAt: serverTimestamp(),
          ...(review.reviewReport?.status === 'pending' ? { reviewReport: { ...review.reviewReport, status: 'actioned' } } : {}) });
        if (action === 'suspend') transaction.update(userRef, { status: 'Suspended', suspensionReason: reason,
          suspensionReviewId: reviewId, suspendedAt: serverTimestamp(), moderationNotificationId: notification.id, updatedAt: serverTimestamp() });
        return { ...data, notificationId: notification.id };
      });
    } };
  }
  return { createService };
});
