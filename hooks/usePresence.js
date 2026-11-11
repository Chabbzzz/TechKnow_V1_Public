import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { beforeAuthStateChanged, onAuthStateChanged } from 'firebase/auth';
import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../backend/firebase';
import { createTracker, createWriter } from '../backend/services/presence';

export function usePresence() {
  useEffect(() => {
    const isWeb = Platform.OS === 'web';
    const available = () => isWeb
      ? document.visibilityState !== 'hidden' && navigator.onLine !== false
      : AppState.currentState === 'active';
    const tracker = createTracker({
      sessionId: doc(collection(db, 'users')).id,
      available: available(),
      write: createWriter({
        reference: uid => doc(db, 'users', uid),
        transaction: callback => runTransaction(db, callback),
        timestamp: serverTimestamp, remove: deleteField,
      }),
    });
    const stopBeforeAuth = beforeAuthStateChanged(auth, user => {
      if (auth.currentUser?.uid !== user?.uid) return tracker.leave();
    }, () => tracker.setUser(auth.currentUser));
    const stopAuth = onAuthStateChanged(auth, user => tracker.setUser(user));
    const update = () => tracker.setAvailable(available());
    const hide = () => tracker.setAvailable(false);
    let stopLifecycle;
    if (isWeb) {
      document.addEventListener('visibilitychange', update);
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      window.addEventListener('pagehide', hide);
      window.addEventListener('pageshow', update);
      stopLifecycle = () => {
        document.removeEventListener('visibilitychange', update);
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('pageshow', update);
      };
    } else {
      const listener = AppState.addEventListener('change', state => tracker.setAvailable(state === 'active'));
      stopLifecycle = () => listener.remove();
    }
    return () => { stopAuth(); stopBeforeAuth(); stopLifecycle(); void tracker.dispose(); };
  }, []);
}
