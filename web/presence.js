/* Track each signed-in browser tab independently of account access controls. */
(() => {
  const runtime = window.techKnowFirebase;
  const { createTracker, createWriter } = window.techKnowPresence;
  const available = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
  const tracker = createTracker({
    sessionId: runtime.db.collection('users').doc().id,
    available: available(),
    write: createWriter({
      reference: uid => runtime.db.collection('users').doc(uid),
      transaction: callback => runtime.db.runTransaction(callback),
      timestamp: runtime.serverTimestamp, remove: runtime.deleteField,
    }),
  });
  runtime.presence = tracker;
  runtime.auth.onAuthStateChanged(user => tracker.setUser(user));
  const update = () => tracker.setAvailable(available());
  document.addEventListener('visibilitychange', update);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  window.addEventListener('pagehide', () => tracker.setAvailable(false));
  window.addEventListener('pageshow', update);
})();
