import { useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../backend/firebase';

// Existing sessions also lose access when their profile is suspended.
export function useAccountAccess(enabled) {
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled || pathname === '/' || pathname === '/signup') return;
    let stopProfile = () => {};
    let cancelled = false;
    const stopAuth = onAuthStateChanged(auth, user => {
      stopProfile();
      if (!user) return;
      stopProfile = onSnapshot(doc(db, 'users', user.uid), async snapshot => {
        if (cancelled || auth.currentUser?.uid !== user.uid) return;
        if (['suspended', 'banned', 'disabled'].includes(String(snapshot.data()?.status || '').toLowerCase())) {
          try {
            await signOut(auth);
            router.replace('/');
          } catch (error) {
            console.warn('Suspended session could not be closed', error);
          }
        }
      }, error => console.warn('Account access could not be checked', error));
    });
    return () => { cancelled = true; stopAuth(); stopProfile(); };
  }, [enabled, pathname]);
}
