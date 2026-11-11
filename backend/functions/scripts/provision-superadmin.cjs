// Run locally with trusted Firebase Admin credentials. Never serve this as a page.
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { SUPER_ADMIN_UID } = require('../operations.cjs');

async function main() {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const email = (arg('--email') || 'superadmin@techknow.test').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid email using --email.');
  const credentialPath = arg('--credentials') || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let credential;
  if (credentialPath) {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    if (serviceAccount.project_id !== 'techknowcapstone') throw new Error('The service account must belong to techknowcapstone.');
    credential = cert(serviceAccount);
  } else credential = applicationDefault();
  initializeApp({ credential, projectId: 'techknowcapstone' });
  const auth = getAuth();
  const db = getFirestore();
  // Refuse additional super-admin profiles instead of deleting or demoting them.
  const existing = await db.collection('users').where('role', '==', 'Super Admin').get();
  if (existing.docs.some(doc => doc.id !== SUPER_ADMIN_UID)) throw new Error('Another super-admin profile exists. Review it before provisioning the single account.');
  const profile = await db.collection('users').doc(SUPER_ADMIN_UID).get();
  if (profile.exists && ['suspended', 'banned', 'disabled'].includes(String(profile.data().status || '').toLowerCase())) {
    throw new Error('The designated profile is restricted. Review it before provisioning privileges.');
  }
  let user;
  try { user = await auth.getUser(SUPER_ADMIN_UID); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  if (user && user.email?.toLowerCase() !== email) throw new Error('The designated account already exists with another email. No account was changed.');
  if (user?.disabled) throw new Error('The designated account is disabled. Review it in Firebase Console before proceeding.');
  let password;
  if (!user) {
    password = `Tk!${randomBytes(24).toString('base64url')}9a`;
    user = await auth.createUser({ uid: SUPER_ADMIN_UID, email, password, displayName: 'TechKnow Super Admin' });
    // Printed once in the trusted terminal, never written into browser assets.
    console.log(JSON.stringify({ email, temporaryPassword: password, uid: user.uid, setup: 'Account created; completing privileges.' }, null, 2));
  }
  await db.collection('users').doc(SUPER_ADMIN_UID).set({
    uid: SUPER_ADMIN_UID, fullName: 'TechKnow Super Admin', email, role: 'Super Admin', status: 'Active', updatedAt: FieldValue.serverTimestamp(),
    ...(password ? { createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
  await auth.setCustomUserClaims(SUPER_ADMIN_UID, { ...user.customClaims, superAdmin: true });
  console.log(JSON.stringify({ email, uid: SUPER_ADMIN_UID, ready: true, message: password ? 'Account is ready. Use the generated password above.' : 'Existing account is ready; its password was preserved.' }, null, 2));
}
main().catch(error => {
  console.error(`Super-admin setup failed: ${error.message}`);
  console.error('If account creation already succeeded, retain its printed password and rerun with the same email to finish setup.');
  process.exitCode = 1;
});
