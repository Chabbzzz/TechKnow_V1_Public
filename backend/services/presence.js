(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.techKnowPresence = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const HEARTBEAT_MS = 30000;
  const EXPIRES_MS = 90000;

  function milliseconds(value) {
    const result = value?.toMillis ? value.toMillis() : typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(result) ? result : 0;
  }
  function fresh(value, now) {
    const time = milliseconds(value);
    return time > 0 && time <= now + HEARTBEAT_MS && now - time < EXPIRES_MS;
  }
  function accountStatus(user, now = Date.now()) {
    if (!user || ['suspended', 'banned', 'disabled'].includes(String(user.status || '').toLowerCase())) return 'Inactive';
    return Object.values(user.presenceSessions || {}).some(time => fresh(time, now)) ? 'Active' : 'Inactive';
  }
  function storeStatus(store, users, now = Date.now()) {
    if (['suspended', 'banned', 'disabled'].includes(String(store.status || '').toLowerCase())) return 'Inactive';
    const owners = [store.ownerId, store.ownerUid, store.uid].filter(Boolean);
    return users.some(user => (owners.includes(user.id)
      || (user.role === 'Store Admin' && (user.storeId || user.id) === store.id))
      && accountStatus(user, now) === 'Active') ? 'Active' : 'Inactive';
  }

  // Transactions require a server connection: offline heartbeats cannot queue
  // up and later make a disconnected session appear online when they flush.
  function createWriter({ reference, transaction, timestamp, remove, now = Date.now }) {
    return (uid, sessionId, active) => transaction(async tx => {
      const ref = reference(uid);
      const snapshot = await tx.get(ref);
      const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists;
      if (!exists) return; // Signup may still be creating the profile; retry on the next beat.
      const user = snapshot.data();
      const changes = {};
      for (const [id, seenAt] of Object.entries(user.presenceSessions || {})) {
        if (/^[A-Za-z0-9_-]+$/.test(id) && !fresh(seenAt, now())) changes[`presenceSessions.${id}`] = remove();
      }
      const allowed = !['suspended', 'banned', 'disabled'].includes(String(user.status || '').toLowerCase());
      changes[`presenceSessions.${sessionId}`] = active && allowed ? timestamp() : remove();
      tx.update(ref, changes);
    });
  }

  function createTracker({ write, sessionId, available = true, report = console.warn,
    every = setInterval, cancel = clearInterval }) {
    let uid = null;
    let disposed = false;
    let queued = 0;
    let queue = Promise.resolve();
    function send(target, active) {
      if (!target) return queue;
      queued++;
      queue = queue.then(() => write(target, sessionId, active))
        .catch(error => report('Presence could not be updated', error))
        .finally(() => { queued--; });
      return queue;
    }
    function setUser(user) {
      if (disposed) return;
      const next = user?.uid || null;
      if (uid === next) return;
      send(uid, false);
      uid = next;
      if (available) send(uid, true);
    }
    function setAvailable(value) {
      if (disposed || available === value) return;
      available = value;
      send(uid, available);
    }
    const timer = every(() => {
      if (!disposed && uid && available && !queued) send(uid, true);
    }, HEARTBEAT_MS);
    async function leave() {
      const previous = uid;
      uid = null;
      let timeout;
      // A lost connection must never prevent logout.
      await Promise.race([send(previous, false), new Promise(resolve => { timeout = setTimeout(resolve, 1500); })]);
      clearTimeout(timeout);
    }
    return {
      setUser, setAvailable, leave,
      dispose() { disposed = true; cancel(timer); return leave(); },
    };
  }
  return { HEARTBEAT_MS, EXPIRES_MS, accountStatus, storeStatus, createWriter, createTracker };
});
