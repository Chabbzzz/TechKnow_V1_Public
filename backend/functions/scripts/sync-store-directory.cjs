const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function coordinate(value, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function publicStoreRecord(snapshot) {
  const store = snapshot.data();
  const name = [store.name, store.storeName, store.businessName]
    .find(value => typeof value === 'string' && value.trim())?.trim();
  const hasAccountIdentity = Boolean(store.ownerId || store.ownerUid || store.uid || store.email || store.businessEmail || store.username);
  if (!name || !hasAccountIdentity || /^\d+$/.test(snapshot.id)) return null;

  return {
    id: snapshot.id,
    name,
    address: typeof store.address === 'string' ? store.address : '',
    latitude: coordinate(store.latitude ?? store.location?.latitude ?? store.coordinates?.latitude, -90, 90),
    longitude: coordinate(store.longitude ?? store.location?.longitude ?? store.coordinates?.longitude, -180, 180),
    status: typeof store.status === 'string' ? store.status : 'Active',
    verificationStatus: typeof store.verificationStatus === 'string' ? store.verificationStatus : 'pending',
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function main() {
  const projectId = argument('project');
  if (!projectId) throw new Error('Pass the intended Firebase project with --project=PROJECT_ID.');
  const apply = process.argv.includes('--apply');
  initializeApp({ projectId });
  const db = getFirestore();
  const stores = await db.collection('stores').get();
  const records = stores.docs.map(publicStoreRecord).filter(Boolean);

  if (!apply) {
    console.log(`Dry run for ${projectId}: ${records.length} sanitized shop listings would be created.`);
    console.log('No database writes were made. Add --apply after reviewing the target project and backup.');
    return;
  }

  for (let offset = 0; offset < records.length; offset += 400) {
    const batch = db.batch();
    for (const record of records.slice(offset, offset + 400)) {
      batch.set(db.collection('storeDirectory').doc(record.id), record);
    }
    await batch.commit();
  }
  console.log(`Created or refreshed ${records.length} sanitized shop listings in ${projectId}.`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
