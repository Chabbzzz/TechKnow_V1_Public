import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase';

export function suspensionMessage(profile) {
  return `Your account has been suspended due to a rude or inappropriate review.${profile?.suspensionReason ? ` Reason: ${profile.suspensionReason}` : ''} Please contact TechKnow support.`;
}

export async function signInCustomer(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  try {
    // Always check the server; a cached Active profile must not bypass suspension.
    const snapshot = await getDocFromServer(doc(db, 'users', credential.user.uid));
    const profile = snapshot.data();
    if (['suspended', 'banned', 'disabled'].includes(String(profile?.status || '').toLowerCase())) {
      throw Object.assign(new Error(suspensionMessage(profile)), { code: 'auth/account-suspended' });
    }
    if (!snapshot.exists() || profile.adminOperationId) throw new Error('Account access could not be verified.');
    return credential;
  } catch (error) {
    if (auth.currentUser?.uid === credential.user.uid) await signOut(auth);
    throw error;
  }
}
