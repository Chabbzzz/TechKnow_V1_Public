# Backend and security review

**November 8, 2026 update:** The deployed Firestore rules were fetched and
confirmed to differ from `firestore.rules` only in the review proof-image
condition. The tested local rules were deployed to `techknowcapstone`, and a
fresh fetch confirmed the live rules match `firestore.rules` exactly. The
historical assessment below describes the October 29 state; it should not be
read as the current Firestore deployment status. Storage rules, Functions, and
hosting were outside this review fix.

Date: **October 29, 2026 (Asia/Manila)**. Project: `techknowcapstone`.

**Assessment: the live system is not secure for production.** Its current Firestore rule permits anonymous reads, writes, and deletes across the database. Local repairs and replacement access rules have been implemented and tested, but **nothing was deployed**. Passing local tests does not close the production exposure.

The user supplied the current rule twice and confirmed that only its expiry had been extended:

```text
match /{document=**} {
  allow read, write: if request.time < timestamp.date(2026, 12, 30);
}
```

This grants access until December 30, 2026 at 00:00 UTC (08:00 Manila), then denies client access. Extending the date extends the exposure. Adding restrictive rules alongside this wildcard would not fix it: matching allows are combined. The wildcard must be replaced. See [Firebase rule evaluation](https://firebase.google.com/docs/rules/rules-behavior).

**Scope and evidence**

Reviewed the four Cloud Functions, Firebase client services, signup/login, account suspension, store ownership, product limits, inventory/reservation transactions, reviews, permit uploads, browser rendering of database records, hosting configuration, and both dependency trees. Most files under `backend/services` run on the customer's device or in a browser; they are not trusted server code. Firestore and Storage rules must enforce their permissions. The Admin SDK functions independently enforce authorization because Admin SDK access bypasses client rules. See [Firebase authorization conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

Read-only anonymous Firestore queries selected document names only, with a limit of one. No document names or personal field values were printed or retained in the report. No production writes, deletes, credential guessing, or exploit payloads were attempted.

| Anonymous query | Observed result |
| --- | --- |
| `users` | Allowed; a record exists |
| `reservations` | Allowed; a record exists |
| `reviews` | Allowed; a record exists |
| `permitSubmissions` | Allowed; query returned no records |
| `auditLogs` | Allowed; query returned no records |

Anonymous read access is directly confirmed. Write/delete access follows from the supplied deployed rule; it was deliberately not tested against live records. There is no evidence from this review establishing whether somebody has already exploited that access.

**Findings and repairs**

| ID / severity | Finding and impact | Result of this review |
| --- | --- | --- |
| SEC-01 — Critical | Open Firestore wildcard exposes private account/reservation/review records and permits changes to ownership, account roles/status, inventory, receipts metadata, limits, and audit records. | Complete replacement [Firestore rules](../firestore.rules) prepared and emulator-tested. **Production remains exposed until deployment.** Existing roles/ownership and moderation data need integrity review because they were client-writable. |
| SEC-02 — High | Privileged functions trusted the UID and token claim without checking current Auth restrictions or the active Super Admin profile. A previously issued token could outlive a restriction or privilege removal. | [Server authorization](../backend/functions/operations.cjs) now checks current Auth user, disabled state, token revocation time, current super-admin claim, and the active profile. Profile checks run inside privileged Firestore transactions. Store product creation also rejects disabled/revoked accounts and pending suspension operations. Requires Functions deployment. |
| SEC-03 — High | Database IDs were embedded into inline JavaScript/HTML attributes without both layers of escaping; reservation status was inserted as raw HTML. With the open database, attacker-controlled records could reach an admin's browser. | Fixed ID encoding and status escaping in [dashboard rendering](../backend/dashboard-data.js) and [store portal](../web/admin.html). Snapshot document IDs take precedence over stored `id` fields. Invalid review ratings cannot crash star rendering. Regression tests exercise hostile strings. Requires hosting release. |
| SEC-04 — High, production configuration unverified | Current Storage rules were not available. Client MIME/size checks and `privacy: admin-only` metadata do not enforce privacy. | Proposed [Storage rules](../storage.rules) tested for account/store isolation, file size and declared MIME, anonymous denial, and evidence overwrite prevention. Review proofs are readable by their customer, assigned store admin, and platform admin; permits by owner and platform admin. Submitted evidence cannot be replaced. **These rules are a tested proposal, not a verified description of live Storage.** |
| SEC-05 — High | Permit finalization overwrote user/store status with `Pending Verification`, including after a suspension during upload. It also assumed store ID always equals Auth UID. | [Permit service](../backend/services/permits.js) now resolves the assigned store and rechecks account role, status, ownership, and pending operations in the final transaction. The rules independently block clearing a suspension. File count is capped at 10. |
| SEC-06 — High / Moderate | Dependency audit initially reported 23 affected app packages (including one critical) and nine moderate affected server packages. | Applied compatible app updates and upgraded server SDKs to `firebase-admin ^14.5.0` / `firebase-functions ^7.4.0`. Final server audit: **0**. App production tree still reports **16: 7 high, 3 moderate, 6 low**, with no critical. See dependency details below. |
| SEC-07 — Medium | Store username login queried private user records before authentication; customer popularity counts subscribed to all private reservations. | Store login now uses business email only. Popularity reads product counters. Replacement rules reject public user lookup and global customer reservation queries. |
| SEC-08 — Medium | Client reservation counters and snapshots could be forged with direct writes; client-only ownership checks were insufficient. | Rules require the reservation and counter to commit together, bind the counter to a new reservation ID, validate identity/store/product/numeric price/quantity, and require matching stock changes on acceptance. New writes include authoritative numeric `unitPrice` and product `lastReservationId`. |
| SEC-09 — Medium | Review uploads accepted arbitrary `image/*`; failure while fetching the download URL could leave an unreferenced upload. | Restricted declared image types, bounded review text, rejected empty uploads, and added cleanup on download-URL failure in [review service](../backend/services/reviews.js). Actual file content/malware scanning is not implemented. |
| SEC-10 — Medium | The store review Hide button displayed a success toast without persisting anything. Hosting lacked framing protection. | Removed the misleading action and approval wording. Added frame denial, object blocking, same-origin base restrictions, and no-referrer headers. The CSP is deliberately limited; it is not a complete script-execution policy. |

**What is working in the verified implementation**

- Store product creation uses a trusted callable, validates inputs, resolves ownership from the profile, and serializes additions/limit changes on the store. Direct client creation is denied by the new rules.
- Reservation acceptance uses a transaction so stock and status change together. Regression coverage includes the last available unit, retries, atomic failures, legacy stock-adjusted records, and cross-store rejection.
- Customers can create their own profiles, save favorites, submit reviews and reservations, and update profile/presence/notification fields. They cannot promote themselves, edit account restrictions, moderate reviews, or write audit records.
- Store signup atomically creates a self-owned account/store in `Pending Verification`; store owners cannot set their own product limits. Pending stores retain their existing ability to manage products; this review did not introduce an approval-only publishing policy.
- Privileged moderation and product-limit changes preserve original content and commit an audit record with their database mutation. Suspension uses an explicit operation lock and reconciliation status for cross-service failures.
- The hosting build includes an allowlist of browser backend modules and excludes server functions, tests, rules, and environment files. No service-account/private-key pattern was found in the scanned source files; this was not a full Git-history or machine-secret audit. The public Firebase configuration is not an Admin credential.

**Validation results**

| Check | Result and limits |
| --- | --- |
| Initial local suite | 110/112 passed. Two failures came from a missing domain helper in a test fixture and an obsolete shop-presence assertion after the catalog layout changed; both test fixtures/expectations were corrected. |
| Final service/UI regression suite | **120/120 passed on Node 22.23.4**, the configured server runtime major. Includes new authorization, revocation, permit suspension, and injection cases. Most service tests use an in-memory adapter. |
| Firestore + Storage emulator suite | **16/16 passed**, using demo project `demo-techknow-security`, Java 21, and Firebase CLI 15.34.1. Includes actual reservation creation, store acceptance, and review submission services against Firestore rules, plus positive/negative access tests for each role. A deliberately missing permit submission emits a rules null-value diagnostic and is correctly denied. |
| Cloud Functions entry point | All four exports load with upgraded SDKs on Node 22. No production function invocation was performed. |
| Hosting build | `npm.cmd run build:hosting` passed. Inline scripts in signup/login/store portal parsed successfully. No hosting deployment performed. |
| Server production dependencies | `npm audit --omit=dev --prefix backend/functions`: **0 reported vulnerabilities**. |
| App production dependencies | `npm audit --omit=dev`: **16 reported affected packages remain**. |

Detailed local evidence is in `output/security-audit/`: `backend-tests.log`, `rules-tests.log`, `hosting-build.log`, `backend-dependencies.json`, and `app-dependencies.json`. This generated directory is ignored by Git. Npm totals include dependency chains and are not counts of independently exploitable bugs.

The remaining app findings originate from `@grpc/grpc-js` through Firebase's Node Firestore implementation, `zod` through Expo CLI, `decode-uri-component` through Expo Router/query-string, and `deepmerge` through Expo configuration tools. Exposure depends on the execution path: a tooling or Node dependency finding does not by itself demonstrate a remotely exploitable mobile/browser flaw. Nevertheless these remain unresolved. Npm's forced suggestions included downgrading Expo to 51 and Firebase to 9; those were not applied. Resolve these through a deliberate supported SDK/toolchain migration and repeat native/web testing.

Server SDK 14 requires Node 22 or later and removes legacy namespace APIs; this repository already uses the supported modular entry points. The upgrade was checked against the [Admin SDK release notes](https://firebase.google.com/support/release-notes/admin/node) and [Functions 7.4.0 release](https://github.com/firebase/firebase-functions/releases/tag/v7.4.0). Expo's requested SDK 54 documentation URL redirected to newer docs, so the [official SDK 54 source](https://github.com/expo/expo/blob/sdk-54/docs/pages/versions/v54.0.0/index.mdx) was read before edits. The app remains on SDK 57; compatible patch updates were applied.

**Remaining backend and operational limitations**

- **Live protection is not installed.** The Firebase CLI had no usable authenticated project session. No project settings, live records, rules, Auth accounts, or hosting releases were changed. Production Storage configuration, IAM, backups, and deployed function versions remain unverified.
- **Previously issued download URLs may remain usable.** Firestore privacy and new Storage rules do not make a previously shared tokenized receipt URL private again. Existing exposed proof links need a controlled token-rotation/reissue plan; replacing rules alone is insufficient.
- **Abuse controls remain incomplete.** There is no configured App Check enforcement or application-level per-account reservation/review/upload rate limit in the reviewed code. An authenticated account can create repeated submissions within the permitted schema. File size limits do not provide a total storage quota or malware scan.
- **Cross-service recovery requires trusted administration.** Auth and Firestore cannot share a transaction. Failed suspension reconciliation leaves `adminOperationId` locked and an audit record for repair. Signup can leave an Auth user without a completed profile. Storage/Firestore failures can leave files; recording recovery paths can itself be denied after suspension. There is no automatic reconciliation/orphan cleanup job.
- **Deletion can strand pending reservations.** Archived product deletion does not resolve reservations referring to that product. Acceptance safely fails if the product is gone, but a trusted cancellation/retention policy is still needed.
- **Approval workflows are incomplete.** Permit submission/storage is implemented; a trusted permit approve/reject workflow and government verification are not implemented. Store review hiding is not implemented; the false success action was removed. Platform review flagging is implemented.
- **Existing data has not been migrated or certified.** Corrupted or legacy product records may fail the new validation until repaired. Because the old rules allowed public edits, check role/store ownership/limits/moderation fields against trusted records before relying on them.

**Rollout required to close SEC-01**

1. Back up and review current data and rule configurations using an authenticated project administrator. Inspect Storage's separate Rules tab if Storage is provisioned. Do not extend the open wildcard again.
2. Test the updated clients and functions together in staging. Review old records for numeric product price/stock, stock range 0–10, name/category, ownership, and expected profile fields. Retain legitimate legacy reservation data; new writes carry `unitPrice` and `lastReservationId`.
3. Coordinate the client rollout with the rule replacement. Older installed clients cannot create reservations under the new rules because they do not send the new atomic-binding fields. Publish/update the mobile and web clients; verify business-email login and refresh portal tabs. The new rules also intentionally deny anonymous catalog access and direct client product creation.
4. Deploy the functions and reviewed rules through an authenticated administrator, then publish the hosting artifact. The commands below are prepared for that release; **they were not executed**. Storage deployment additionally requires confirming the target bucket/service and cross-service Firestore rule permissions.

```powershell
firebase deploy --project techknowcapstone --config firebase.admin.json --only functions:platform-admin
firebase deploy --project techknowcapstone --config firebase.security.json --only firestore:rules
# After reviewing/enabling the intended Storage bucket:
firebase deploy --project techknowcapstone --config firebase.security.json --only storage
npm.cmd run build:hosting
firebase deploy --project techknowcapstone --config firebase.hosting.json --only hosting
```

5. Repeat the anonymous read checks: private collection queries must return permission denied. With controlled test accounts, verify signup, profile updates, catalog, favorites, reservation/stock transitions, review proof uploads, permit submission, account suspension, and cross-store denial. Rotate affected download links and reconcile any suspect existing data. Do not restore the open wildcard as a rollback.

Reproduce local validation with Node 22 and Java 21 available on `PATH`:

```powershell
npm.cmd ci
npm.cmd ci --prefix backend/functions
npm.cmd run test:backend
npm.cmd run test:rules
npm.cmd run build:hosting
```

On this machine Java 8 is the default; testing used `C:\Program Files\Java\jdk-21`. The test command uses only a `demo-` project and loopback emulator ports, not production. See [Firebase emulator testing](https://firebase.google.com/docs/rules/unit-tests) and [Storage rule conditions](https://firebase.google.com/docs/storage/security/rules-conditions).

## November 5, 2026 follow-up

The username directory previously allowed anonymous exact-document reads and stored each account's email. The replacement rules now deny directory listing and reads by anyone except the matching signed-in account, and new directory records contain only the UID and username. Customer sign-in now uses email. Customer and store signup reserve the username marker in the same Firestore write as the profile/store records, so the rules prevent duplicate names without exposing account emails. Failed store signup writes now attempt to remove the newly created Auth account.

Customer shop queries now use the allowlisted `storeDirectory` projection. The
private `stores` records are readable only by the owning store account and the
designated super admin. Signup, permit resubmission, and trusted suspension or
restoration keep the projection synchronized. Run
`backend/functions/scripts/sync-store-directory.cjs --project=PROJECT_ID` to
review a dry-run count, then use `--apply` only after confirming the project and
backing up its records. Do this before applying the stricter rules to a database
with existing stores, or their customer listings will be empty until populated.

The backend suite passed 141/141 after this change. The Firestore/Storage rules
emulator could not be run in this environment because Firebase CLI was not
installed and `npx` stalled while trying to fetch it. No production database,
rules, or hosting configuration was changed.

The backend regression suite passed 141/141 tests and the static hosting build completed. The all-platform Expo export also completed with bytecode disabled after Windows denied the initial `hermesc.exe` execution. The Firestore/Storage rule emulator suite could not start because `npx` could not reach `registry.npmjs.org` (EACCES). The rules changes therefore still need emulator verification before rollout. This local follow-up does not change the prior production status: the open wildcard was reported as live and the replacement rules were not deployed. No production database, rules, or accounts were changed.
