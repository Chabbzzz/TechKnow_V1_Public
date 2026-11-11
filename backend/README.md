# Firebase application services

Security review (October 29, 2026): the owner-supplied Firestore test rule
allowed public reads/writes until December 30. On November 8, 2026, the live
Firestore rules were fetched, compared with `firestore.rules`, and the review
proof-image condition was deployed. A fresh fetch confirmed the deployed rules
match this file exactly. Storage rules, Functions, and hosting were not part of
that deployment. Read the [audit report](../docs/BACKEND_SECURITY_AUDIT.md)
for the historical assessment and remaining rollout requirements.

The app uses Firebase Authentication, Cloud Firestore, and Firebase Storage.
This directory contains **client-side services**, not a trusted Node/Express
server or Firebase Admin SDK. Firebase Security Rules remain the authorization
boundary. The service refactor did not change production records; the later
Firestore rules deployment is noted above.

```text
backend/
  config/firebase-config.js  Shared public project configuration
  client/firebase.js        Expo SDK initialization and native auth persistence
  domain/reservations.js     Pure reservation validation and stock transitions
  services/
    reservations.js         Customer reservation transactions (modular SDK)
    reviews.js              Review and inline proof image creation (Firestore)
    review-proof-image.js   Receipt image compression for Expo and web
    favorites.js            Favorite writes and live subscriptions (modular SDK)
    admin.js                Admin sessions and store operations (compat SDK)
    review-moderation.js    Superadmin warnings/suspensions with private notices
    customer-auth.js        Server profile check before customer app access
    permits.js              Permit uploads and final submission batch (compat SDK)
  tests/                    Local service and regression tests
  firebase.js               Compatible export for existing imports
  dashboard-data.js         Existing browser presentation/controller adapter
```

`app/` and `components/` own screens and presentation. `hooks/` own React state
and subscription lifetimes. `web/` contains the existing static dashboards and
their UI. `constants/` contains presentation helpers; `ml/` contains ranking and
language analysis. Existing routes, collection names, and import paths remain.

New writes should follow **UI -> service -> domain validation -> Firebase**.
Keep modal rendering and navigation out of services. Multi-document changes
belong in transactions or batches. Existing read-only subscriptions can remain
in hooks; always return their unsubscribe functions.

## Connections

Existing Expo imports still work:

```js
import { auth, db, storage } from "../backend/firebase";
import { createReservation } from "../backend/services/reservations";
```

Other exports are `firebaseApp`, `firebaseConfig`, and `analytics` (a promise
resolving to browser Analytics or `null`). Native auth uses AsyncStorage.

Static pages load Firebase compat scripts, then
`../backend/config/firebase-config.js`, then `firebase-config.js`.
The latter provides `window.techKnowFirebase`, including `persistenceReady`
and `authReady`. It uses named Firebase apps (`techknow-store-portal` and
`techknow-superadmin-portal`) so customer/store sign-in or sign-out cannot replace
the super-admin identity in other tabs. Super-admin login and dashboard pages
declare `data-auth-portal="superadmin"` on the body. Firestore, Storage, Functions,
and presence use the same portal app instance; the customer app retains its
default Firebase app. On first use after this change, admins must sign in again
to establish their separate portal session. Admin pages then load `domain/reservations.js`,
`services/admin.js`, and `dashboard-data.js` in that order. The permit upload
page loads `services/permits.js`. Serve the repository root so `../backend/`
URLs resolve; serving only `web/` was already insufficient for the dashboard.

The shared configuration and domain modules expose CommonJS exports for
Metro/Node and browser globals for the existing classic-script pages. There
is no extra bundler or runtime dependency.

## Implemented flows

- **Reservation:** authenticated customer -> trusted callable transaction reads product/store and active requests ->
  validate ownership, availability, and quantities -> create Pending or Waiting
  List record and increment the product counter together. Product/store names
  and peso price come from stored records. Stock changes only on acceptance.
- **Pending request cap:** the callable reservation endpoint checks a
  customer's Pending and Waiting List requests in the same transaction as
  creation. It blocks a sixth active request and returns a limit alert to the
  customer. Accepted, rejected, completed, and canceled requests do not use a
  pending slot.
- **Acceptance/rejection:** restore admin session -> resolve the store from its
  user profile and ownership record -> transaction reads reservation/product ->
  validate transition -> commit stock and reservation status together. Legacy
  `stockAdjusted` records do not deduct stock twice. Rejection restores their
  stock once; already finalized requests cannot be processed again.
- **Unclaimed reservations:** a Cloud Scheduler function checks every five
  minutes for Pending, Waiting List, and accepted-but-unclaimed reservations
  created at least 24 hours ago. The deadline is based on the server's
  `createdAt`, not the customer's pickup date/time or the store's acceptance
  time. It atomically marks each one Rejected and restores stock only if the
  reservation actually deducted inventory. The
  store can mark pickups as claimed from the Accepted tab; claimed reservations
  are kept as Completed and are excluded from expiry. The oldest waiting-list
  reservations remain visible to the store for follow-up; they are not
  auto-accepted without the store's confirmation. Deploy the
  reservation indexes, rules, and Functions code with `firebase deploy --project
  techknowcapstone --config firebase.admin.json --only firestore:indexes,firestore:rules,functions:platform-admin`.
  Rejection happens on the first successful scheduler run after the deadline
  (normally within five minutes), even with the app closed. Completed, rejected,
  and already-canceled records are excluded. Expiry pages through the backlog;
  failed records are logged and retried on subsequent runs.
- **Product management:** all store queries require store scope; transactions
  verify ownership before updates, archive/restore, or deletion. Updates cannot
  overwrite store ownership or demand counters. The existing 0–10 stock input
  limit and 30-day archive policy remain. Cleanup rechecks archive state and
  expiry inside the transaction.
- **Review:** require auth, rating 1–5, feedback, and an existing store before
  creating a Pending review. Customers can attach one image receipt or invoice
  under 5 MB from the mobile photo library. The app compresses it to fit a
  Firestore document and writes the image data with the review in one atomic
  transaction. Store admins can view the proof and approve pending reviews
  directly. Store approval and reporting use Firestore transactions with a
  matching immutable audit entry; Firestore rules enforce ownership and keep
  customer content unchanged. These store actions work on the free plan
  without Cloud Functions. Superadmin oversees approved reviews and pending
  store reports. Its centered review details modal offers Warning and Suspend,
  with a required customer-visible reason. Both actions derive the recipient
  from the review's saved `userId` and atomically write a private
  `moderationNotifications` notice, immutable audit and review reference.
  Suspension also updates the customer's profile. Rules require the designated
  superadmin UID, trusted claim and active admin profile. Warnings appear in
  the author's Alerts and unread badge. Customer login checks the server
  profile before navigation, displays the suspension reason and signs out
  restricted accounts. Existing sessions also sign out on suspension. This
  free-plan path enforces app access through profiles and security rules; it
  does not disable the Firebase Auth credential with the Admin SDK.
- **Favorites:** preserve the `userId_productId` document ID; observe changes
  live and stop listeners/reset state on account changes and unmount.
- **Permit submission:** validate files/store ownership -> create uploading
  record -> upload documents under the owner's Storage path -> atomically
  finalize submission, store, and user records. Failed submissions retain
  uploaded paths for recovery. Browser confirmation-storage failures do not
  change a successful submission to failed.

## Validation

Account presence: the customer app and authenticated browser portals write a
server-timestamp heartbeat every 30 seconds under the signed-in user's
`presenceSessions` map. Each running device/tab has an independent key. The
super-admin Accounts and Shop Product Usage tables show only Active/Inactive;
missing or expired sessions are Inactive. Shop presence follows its store admin.
Account suspension fields remain separate and are never changed by heartbeats.
Backgrounding/hiding the app or signing out removes that session when connected.
Crashes and lost connections expire after 90 seconds, with a dashboard refresh
every 5 seconds (up to 95 seconds total). Offline transactions cannot queue stale
heartbeats for replay. Expired session entries are pruned on subsequent writes.
This uses existing Firestore, not Realtime Database disconnect detection. Deployed
rules must allow a signed-in user to update their own `presenceSessions` field;
the local tests do not verify deployed rules or actual device connectivity.

Customer product alerts use the live `products` and `storeDirectory` catalog subscriptions.
Every signed-in customer sees listings created since their account was created in
Notifications > Alerts, including listings added while they were offline. Each
alert names the store and product and opens the existing product comparison view.
The Alerts tab badge counts unread product alerts. IDs use the product ID and
creation event, so editing price, stock or images does not create another alert.
Read IDs are merged atomically into the existing `users.notificationReadIds` field
and observed across screens/devices. Archived/deleted/unverified listings leave
the feed with the catalog. This is an in-app feed, not OS push delivery when the
app is closed; it requires no new Firestore collection or deployed function.

```sh
npm run test:backend
node node_modules/expo/bin/cli export --platform all --output-dir output/backend-verification --max-workers 2
```

On PowerShell installations blocking `npm.ps1`, use `npm.cmd run test:backend`.
If Windows denies execution of `hermesc.exe`, append `--no-bytecode` to validate
the Android/iOS/web JavaScript bundles; that does not validate native bytecode.
Tests use Node's test runner, Expo's installed Babel tooling, and an in-memory
Firebase adapter. They cover retries, atomic failure, store isolation, stock
transitions, archive checks, auth restoration, and permit finalization. They do
not prove deployed Security Rules or real network concurrency behavior.

## Remaining integration boundaries

- Proposed Firestore/Storage rules and `firebase.security.json` now exist.
  `npm run test:rules` verifies them with local Firebase emulators. They must be
  released together with the updated clients/functions and validated against
  controlled production accounts; current Storage configuration is unverified.
- Store-admin pages and super-admin management controls require a Firebase
  session and matching role. The super-admin page requires login; this UI check
  does not close the currently public database access. Store accounts
  require `users/{uid}.role = "Store Admin"`, a `storeId` (defaults to UID), and
  a matching `ownerId`, `ownerUid`, or `uid` on that store. Super-admin pages
  require `role = "Super Admin"`, the fixed `techknow-superadmin` UID, and a trusted
  `superAdmin: true` custom claim. See [platform setup](functions/README.md).
  These roles must be assigned/protected by
  trusted administration. Pending Verification store accounts keep their
  existing portal access; suspended/banned/disabled accounts are rejected.
- Customer signup/profile updates and store signup still span Auth and
  Firestore, which cannot share a transaction. Existing partial-signup recovery
  remains a separate integration concern; this refactor does not delete accounts.
- Store login uses business email, without querying private users before sign-in.
  Customer demand counts read product counters, not private reservations.
- Customer shop listings read only the allowlisted `storeDirectory` projection.
  The `stores` collection contains owner, login, and operational fields and is
  readable only by that store's owner and the designated super admin. Signup,
  permit status changes, and account suspension synchronize the public
  projection. Existing stores need a one-time projection backfill before the
  stricter rules can serve their listings; see
  `functions/scripts/sync-store-directory.cjs` (dry run unless `--apply` is passed).
- Permit submission is implemented; trusted permit approval and government
  verification are not. Platform moderation and account actions have trusted callable
  endpoints and persisted audit records; deployment and rule integration are
  required before using them against the live project.
- Storage and Firestore cannot share a transaction. Failed uploads/finalization
  can leave stored files; failed submission documents retain successful paths.
  Production cleanup belongs in a trusted job. The existing product-image
  compressed-data fallback is preserved.

## Review proofs

Review proofs follow the product image approach: users select an image under
5 MiB, then the client prepares a JPEG data URL no larger than 700 KiB. The
image is saved once in `reviews.proofFileUrl` together with the review in one
transaction; `proofFile` and `proofStoragePath` remain empty. No Firebase
Storage upload is involved. The store admin's existing View proof dialog can
display the inline image and previously saved Storage links. Review reads
remain scoped to the customer, the selected store admin, and the platform
admin. Deploy `firestore.rules` and `firestore.indexes.json` together to allow
bounded inline images and exclude image fields from indexing.

## SDK reference

The required [Expo SDK 54 URL](https://docs.expo.dev/versions/v54.0.0/) currently
redirects to newer documentation. Its [archived SDK 54 source](https://github.com/expo/expo/blob/sdk-54/docs/pages/versions/v54.0.0/index.mdx)
was read before changes. This workspace uses Expo SDK 57; compatible patches
were applied during the security review. Firebase transaction behavior follows the
[official transaction/batch documentation](https://firebase.google.com/docs/firestore/manage-data/transactions).

The public Firebase config is not an Admin credential. Never place Admin SDK
service-account files or private keys in this directory or the Expo bundle.
