# Platform administration setup

Management access uses real Firebase Authentication for project `techknowcapstone`.
There is no demo login, public signup, hardcoded password, or local role bypass.
Only UID `techknow-superadmin` with the server-issued `superAdmin: true` claim
and an active `users/{uid}` Super Admin profile can use the management controls.

The Super Admin workspace at `web/superadmin.html` requires a successful login
through `web/superadmin-login.html`. It loads the authenticated management view
and redirects unauthenticated users to login. The server still enforces the
designated identity and admin claim for all privileged actions.

The October 29 security review confirmed anonymous Firestore reads. The owner
supplied the deployed wildcard rule allowing public reads/writes until December 30.
Requiring web login does not protect the database. Complete replacement rules and
emulator tests are now prepared locally; they have not been deployed. See the
[security report](../../docs/BACKEND_SECURITY_AUDIT.md) for release requirements.

For an offline screen preview, open `web/superadmin.html?preview=1`.
All six sections are navigable.
Preview loads no Firebase SDK, session, data adapter, or management service; counts
and tables explicitly indicate that live records are not loaded. The preview's
The preview's **Open live data** link opens the authenticated workspace and then
requires Super Admin sign-in.

## Create the one account

From the repository root, using trusted project Admin credentials stored outside
this repository:

```powershell
npm.cmd ci --prefix backend/functions
node backend/functions/scripts/provision-superadmin.cjs --credentials "C:\private\firebase-admin.json" --email "superadmin@techknow.test"
```

The script creates the fixed Auth UID, profile, and custom claim. It prints a
cryptographically generated password once to the local terminal. Save it securely.
It refuses another existing Super Admin profile, a conflicting email, or a
restricted designated account. Rerunning preserves the existing password and
finishes incomplete provisioning. It never deletes or demotes other accounts.
If an account was created before a later step failed, retain the printed password
and rerun with the same email.

`superadmin@techknow.test` is a login identifier, not a deliverable mailbox. Use a
controlled real email instead if password-reset emails are needed. No account has
been provisioned merely by adding these files. The public web Firebase config
cannot create privileged claims; a service-account credential or authorized
Application Default Credentials are required.

## Deploy server controls

With an authenticated Firebase CLI and a project configured for Cloud Functions:

```powershell
firebase deploy --project techknowcapstone --config firebase.admin.json --only functions:platform-admin,firestore:indexes,firestore:rules
```

The separate configuration deploys the `platform-admin` codebase and leaves
existing hosting configuration untouched. It uses Node 22 and `us-central1`.
The predeploy hook packages the shared reservation policy into
`backend/functions/shared/reservations.cjs`. That copy is required because
Firebase uploads only the functions directory; imports outside it are unavailable
after deployment. Run `node backend/functions/scripts/package-reservation-policy.cjs`
after changing the shared domain policy when running backend tests locally.
Serve the web pages and their shared browser backend modules over HTTP/HTTPS,
with `web/` and `backend/config`, `backend/domain`, `backend/services` paths intact.
Exclude `backend/functions/`, credentials, tests, and node_modules from static
hosting. Visit `web/superadmin-login.html` to sign in for live access.

## Store review approval and reporting

The store portal uses `createStoreService().approveReview()` and
`reportReview()` in `backend/services/admin.js`. These are Firestore
transactions supported on the free plan, so store review actions do not
require deployed Cloud Functions or a billing upgrade.

Firestore rules verify the active store owner, preserve customer content,
and require every change to commit with a new, matching `auditLogs` entry.
The review stores that audit document ID as `storeReviewAuditId`. Stores
cannot alter or delete audits, resolve reports, or approve flagged or
reported reviews. A pending report blocks duplicate reports until the
superadmin acts. Server-side moderation endpoints remain available for
other callers when deployed, but are not called by the store portal.

Deploy the rules before serving the updated `web/admin.html`,
`backend/dashboard-data.js`, and `backend/services/admin.js`. The scoped
release in `output/store-review-actions/firebase.deploy.json` preserves the
existing production review submission rules and adds only the store review
and audit permissions. The backed-up production rules are stored beside it.

## Store favorite analytics

`getStoreFavoriteCounts` counts current documents in `favorites` by product ID
for the signed-in store owner's active products. It includes existing favorites
without a `storeId`, ignores the unused product `favorites` field, and returns
only product IDs and totals. Customer favorite-list read permissions are unchanged.
The Analytics card refreshes on entry, every 30 seconds while visible, and when
**Refresh favorites** is pressed. Failed requests show an unavailable state.

Deploy this callable before serving the updated admin page:

```powershell
firebase deploy --project techknowcapstone --config firebase.admin.json --only functions:platform-admin:getStoreFavoriteCounts
```

## Reservation lifecycle

The customer app creates reservations through the authenticated
`createCustomerReservation` callable. It counts Pending and Waiting List records
in a transaction and serializes each customer's submissions, so the sixth
unconfirmed request is rejected with a limit message. It queries by customer ID
and counts pending statuses in the transaction, without a composite index.
Each request reserves one product unit. The cap applies across all shops and
products for the authenticated user. Accepted, Rejected, Cancelled/Canceled,
and Completed requests no longer consume pending slots. For example, four
Pending requests and one Accepted request allow one more Pending request.
The same transaction rejects another request for a product at the same shop
while that customer already has a Pending, Waiting List, or Accepted request.
Rejected, cancelled, and completed requests allow a new submission.
The transaction reads the current records and locks a server-only
`reservationLimits/{uid}` document; it does not rely on a counter that could
become stale when a shop changes status. The rules reject direct client creates
and writes to this lock, so existing requests cannot bypass the callable cap.

`cancelUnclaimedReservations` runs every five minutes. It rejects Pending,
Waiting List, and accepted-but-unclaimed reservations whose server `createdAt`
is at least 24 hours old. Acceptance does not restart the timer; the customer's
pickup date/time does not extend it. The first successful run after that deadline
rejects the record (normally within five minutes of expiry). Pending/waiting
requests normally hold no inventory; only a record with `stockAdjusted: true`
returns its quantity to stock in the same transaction. Repeated or overlapping
runs cannot return stock twice. A deleted product is recorded as a restoration
issue without recreating inventory. Other invalid inventory records are logged
and retried on the next run while subsequent pages continue processing. The
store can mark a pickup as claimed in the Accepted reservations tab; that moves
the record to Completed so it is excluded from expiry.
The `status` and `createdAt` composite index is declared in the root
`firestore.indexes.json`; deploy it with the Functions code using the command in
the backend README. Cloud Scheduler and the required Google Cloud APIs must be
enabled for the Firebase project. The job marks the returned stock as available
for store review; it does not accept waiting-list reservations automatically.

## Security rules and current authorization

`firestore.rules` protects private records and role/status/ownership fields;
`storage.rules` proposes access controls for the three application upload folders.
Use `firebase.security.json` and `npm run test:rules` from the repository root.
Do not append these rules underneath the open wildcard: it must be replaced.
Coordinate the client update because new reservation writes carry `unitPrice`
and `lastReservationId`. Production Storage settings still need review.

Callables check the current Auth record, including disabled/revoked sessions.
Platform actions require the fixed UID, token claim, current custom claim, and
an active Super Admin profile checked inside the transaction. Audit writes and
store product limits remain server-only. Pending suspension operations also
block store creation and protected access under the proposed rules.

The server uses Firebase Admin 14 / Functions 7 with Node 22. The entry point
and regression suite were verified on Node 22.23.4. Follow the coordinated
release steps in the security report; local tests are not deployment proof.

## Available behavior

- Inspect shops, user profiles, products (including archived/unassigned), and
  reservations. Review oversight includes approved reviews and pending store reports;
  pending unreported reviews are handled by the owning store admin.
- Suspend or restore ordinary accounts. Suspension disables Firebase Auth,
  revokes refresh tokens, and updates the user and owned store status. Restoration
  preserves the pre-suspension status and any pre-existing Auth restriction.
- Flag/clear a review with a reason while preserving its content and rating.
- Set each shop's product limit from Product Control > Shop Product Usage.
  `setStoreProductLimit` accepts a non-negative integer or `null` for unlimited,
  saves `stores.productLimit`, and commits an audit record in the same transaction.
  Zero blocks all additions. Lowering a limit keeps existing products.
- Store uploads use `createStoreProduct`, which resolves ownership from the signed-in
  user's profile, validates product fields, and checks the current limit in a server
  transaction. All products, including archived products, count. Permanent deletion
  releases capacity; archiving/restoring does not change usage. A write to the store
  serializes additions with other additions and limit changes.
- Read the newest 200 persisted audit events, including pending and failed actions.

Deploy both new callables before publishing the updated store and super-admin pages.
Product creation now requires the callable; it does not fall back to direct writes.
Merge these requirements into the actual deployed Firestore rules before rollout:
deny client product creation, prevent changes to an existing product's `storeId`,
and prevent client writes to `stores.productLimit` and `productUsageUpdatedAt`
(including on store creation). Preserve authorized updates, archive/deletion,
registration and customer reads. Remove any overlapping permissive grants, since
a separate deny rule cannot override them. The deployed rules are not in this
repository, so direct-write bypass protection still requires rule integration and
emulator verification. These changes do not deploy or replace production rules.

Account operations serialize through `users/{uid}.adminOperationId`. Auth and
Firestore cannot commit atomically. If interrupted, the pending audit and lock
remain for investigation; failures after Auth changes record
`reconciliation_required`. Compare the actual Auth disabled flag, user/store
statuses, and recorded action; finish or reverse the intended change with trusted
Admin tooling, record the outcome, then clear that user's `adminOperationId`.
Never blindly retry or clear the lock before reconciling. Revoking refresh tokens
does not instantly invalidate every existing ID token; deployed rules must also
enforce the suspended profile/store status for immediate data-access restrictions.

The catalog and reservation panels provide oversight; they do not edit inventory
or fulfill reservations on behalf of a shop. Product tiers, exception approvals,
automatic fraud detection, and government permit verification are not implemented.
Placeholder panels claiming those features were removed from this portal.

## Verification

Run `npm.cmd run test:backend` at the repository root. Tests cover singleton/claim
authorization, portal isolation, protected accounts, concurrency, prior status
restoration, partial failures, and atomic review audits using an in-memory adapter.
They do not replace live Auth, Cloud Functions, or deployed Security Rules tests.
