# TechKnow Beta Testing Reviewer Guide

## Purpose

Use this guide to review the customer experience on mobile and web, the store
admin portal, and the super-admin views. It includes repeatable tasks, expected
results, questions to ask testers, and known limits that should be disclosed.

## Current verification baseline

- `npm.cmd run test:backend`: **96 passed, 0 failed**. These are local service,
  domain, browser-runtime, and regression checks; they do not exercise the live
  Firebase project, deployed Security Rules, or every screen interaction.
- `expo export --platform all`: **web, iOS, and Android bundles built**. Bundle
  export confirms compilation; it does not replace browser or device testing.
- This workspace does not include a confirmed end-to-end beta run with real
  test accounts on physical devices.

## Beta readiness gate

Before inviting external testers, use a separate beta Firebase project with
synthetic accounts and data, and verify its deployed Firestore and Storage Rules
for each role. The project notes report that the current deployed Firestore
rules allow unauthenticated reads of collections that include user/account
records. Confirm and fix that exposure before using real user data or opening a
public beta. See [backend/README.md](../backend/README.md) and
[backend/functions/README.md](../backend/functions/README.md).

Also confirm that the platform admin callable functions and the trusted
super-admin account are deployed and provisioned if beta reviewers are expected
to test privileged actions. Do not share real credentials in the reviewer form.

## Test setup

Prepare these test accounts and records in the beta environment:

| Account/data | Preparation |
| --- | --- |
| Customer A | Verified account with no saved searches, favorites, or reservations |
| Customer B | Existing account with at least one favorite, reservation, and notification |
| Store Admin A | Role and store ownership configured for one test shop |
| Store Admin B | Separate shop, for checking store-to-store data isolation |
| Super Admin | Only if privileged moderation/account actions are in scope; use the designated trusted account |
| Test catalog | In-stock, low-stock, out-of-stock, archived, and cross-shop comparison listings |
| Test review | Pending review with optional sample receipt image; do not use a real receipt |

Record the app build/version, browser and version, device model, OS version,
account role, test ID, and start time. Use synthetic contact details and images.
Do not include passwords, private account data, receipts, or precise personal
locations in screenshots or feedback.

## Customer app review

Run the customer flows in the mobile app and, where available, the Expo web
build. Repeat key flows on both so differences are visible.

| ID | Task | Expected result |
| --- | --- | --- |
| C1 | Create a customer account, accept the terms, sign out, then sign back in. | Validation is clear, the account is created once, and the same account can sign in again. |
| C2 | Browse Home, search by product/store text, change categories, open a product comparison, and return. | Relevant results appear; navigation returns to the expected screen; missing data is explained. |
| C3 | Open a listing from two shops and compare price, rating, and availability. | The comparison identifies each shop and does not show stale or mismatched product details. |
| C4 | Favorite a listing, leave the screen, return, and sign in on another session. | Favorite state is retained and reflects the same customer account. |
| C5 | Reserve an in-stock product; select shop/date/time; submit; then open reservation history. | One reservation is created with the selected details and a clear pending state. Repeated taps must not create duplicates. |
| C6 | Have the store accept or reject the reservation, then refresh the customer view. | The current status appears. Stock changes only according to the accepted/rejected transition. |
| C7 | Attempt a reservation for an out-of-stock listing. | The app explains that it is waitlisted/unavailable as appropriate and does not overstate stock. |
| C8 | Submit a review with a 1–5 rating and feedback, then try an invalid/empty review. | Valid reviews enter the pending state; invalid reviews receive helpful validation. |
| C9 | Attach a synthetic receipt image to a review, inspect its preview, and submit. | The selected image is shown and the review can be associated with its proof. Remove/retry behavior is understandable. |
| C10 | Open Notifications, filter categories, mark one/all read, leave and return. | Counts and read state update and remain consistent for the signed-in account. Product alerts open the right comparison. |
| C11 | Open nearby shops with location allowed, denied, and unavailable. | Permission state is explained; distances only appear for valid location data; denying location does not invent a location. |
| C12 | Open Nearby Shops with shops inside and outside 5–10 km, then select a shop on the Leaflet map. | Only shops 5–10 km from current GPS appear. Each has a driving route and distance below the map. No matches show “There are no shops near you.” GPS and route failures have separate messages. |
| C13 | Edit profile fields and inspect the profile email display. | Changes persist after returning. The displayed email masks its 2nd, 4th, and 6th local-part characters as designed. |
| C14 | Scroll long Home, Search, and Notifications lists and use the up arrow. | The arrow appears after scrolling and smoothly returns the list to its top. |

## Store admin portal review

Review the responsive store portal in a desktop browser and a narrow/mobile
browser viewport. The portal includes Dashboard, Products, Archived Products,
Reservations, Reviews, NLP Summary, Analytics, Permits, and Alerts.

| ID | Task | Expected result |
| --- | --- | --- |
| S1 | Sign in as Store Admin A and inspect dashboard counts and navigation. | Only the assigned shop's data appears; empty and loading states are clear. |
| S2 | Add a product with valid details and a synthetic image. | The item appears under the signed-in shop with the submitted price, category, and stock. |
| S3 | Try missing, malformed, and boundary values for product fields and image size/type. | Invalid input is rejected with useful feedback; valid boundary values follow the displayed rules. |
| S4 | Edit a product, update quantity, archive it, restore it, and permanently delete an archived test item if available. | Each action updates the expected listing and asks for confirmation where destructive. Ownership and other shops' data remain unchanged. |
| S5 | As Customer A, create a reservation; accept it as Store Admin A. Repeat with a second reservation and reject it. | Reservation tabs/statuses update and stock changes once, without duplicate transitions. |
| S6 | Review a customer-submitted review and open its synthetic proof image. | The review and proof are readable and belong to the expected shop. Record any moderation action that does not persist. |
| S7 | Inspect the NLP Summary for English and Taglish/Hiligaynon test reviews. | Results are presented as review aids. Flag disagreement, sarcasm, or a rating/text mismatch for human review. |
| S8 | Inspect Analytics and compare totals with the seeded test records. | Charts and summaries correspond to available data; missing data is labeled rather than fabricated. |
| S9 | Submit synthetic permit files and inspect the resulting status. | Upload progress/errors are understandable and the submission is recorded for review. Do not treat this as government verification. |
| S10 | Open Alerts, filter and sort entries, dismiss an alert, and try clearing history with and without confirmation. | Entries respond to controls and the confirmation reflects the action. Record whether state persists after reload. |
| S11 | Open the portal at mobile width; navigate each section and operate modals, tables, and upload inputs. | Controls remain visible and usable without horizontal clipping or inaccessible actions. |

## Super-admin review

The super-admin page requires the designated super-admin account and its
server-issued claim. Use only the beta project and authorized test accounts.

| ID | Task | Expected result |
| --- | --- | --- |
| A1 | Open the preview mode. | It clearly indicates that preview data is synthetic and does not load live records. |
| A2 | Open the live workspace while signed out. | The page redirects to Super Admin login and does not show live records. |
| A3 | Sign in with the designated beta super-admin and inspect the workspace. | Shops, products, accounts, reviews, permits, and logs render; authorized actions are available only to that account. |
| A4 | Suspend and restore a disposable ordinary test account; inspect audit records. | Status, access, shop state, and audit records match the action; protected accounts cannot be changed. |
| A5 | Flag and clear a synthetic review with a reason. | The reason and audit record persist while the review text/rating remain intact. |
| A6 | Attempt the same privileged URL/actions as a customer and a store admin. | The UI and server both deny privileged operations. |

## Cross-platform and reliability checks

- Compare mobile, Expo web, desktop store portal, and narrow portal layouts for
  clipped text, missing buttons, keyboard overlap, and unclear back navigation.
- Repeat a save/submit action with a slow connection and a deliberate second tap.
  Confirm there is one record and that errors do not claim success.
- Sign out and switch accounts. Check that account-specific favorites,
  notifications, reservations, and views do not leak between sessions.
- Test denied permissions, empty catalogs, image upload failure, network loss,
  stale location, and expired sessions. Record whether a retry path is available.
- Check accessibility with screen-reader labels, text scaling, keyboard-only web
  navigation, visible focus, and sufficient contrast.
- Confirm prices, dates, time zones, and distances are understandable to local
  beta testers.

## Reviewer feedback form

For every test ID, record:

1. **Result:** Pass / Partial / Fail / Blocked.
2. **What did you expect to happen?**
3. **What happened instead?** Include the exact screen and steps to repeat it.
4. **How serious is it?** Blocker / High / Medium / Low.
5. **How often did it happen?** Every time / Sometimes / Once.
6. **Which device, OS, browser, and build were used?**
7. **Can you attach a redacted screenshot or screen recording?** Remove private data and location details.
8. **How easy was the task?** 1 (very difficult) to 5 (very easy).
9. **What was confusing, slow, or missing?**
10. **Would you trust this flow for a real product, review, reservation, or account? Why?**

## Questions beta reviewers may ask

| Question | Suggested answer |
| --- | --- |
| What does the customer app do? | It lets customers discover local tech listings, compare shops, save favorites, make reservations, write reviews, see notifications, and find nearby shops. |
| Does a reservation immediately deduct stock? | No. The documented flow changes stock when the shop accepts the reservation. The tester should report any different result. |
| Are product alerts push notifications when the app is closed? | No. They are an in-app feed and badge; OS push delivery is not implemented. |
| What is the store portal for? | Shop admins manage their own products, reservations, reviews, permit submissions, analytics, and alerts through the web portal. |
| Does submitting a permit mean the business has been officially verified? | No. Permit upload/submission exists, but the store dashboard's verification is documented as a simulated placeholder. |
| Are sentiment or NLP labels final decisions? | No. The NLP summary is an aid. Mixed language, sarcasm, and model disagreement need human review. |
| What does TOPSIS do? | It ranks comparison candidates using weighted criteria such as price, distance, rating, and stock; reviewers should check whether the shown ranking is understandable and useful. |
| What does the map's distance mean? | List distances are straight-line estimates. Walking/driving directions use a routed road path when available; they are not safety-rated or live-traffic routes. |
| Why might an admin action be unavailable? | The signed-in account must have the designated super-admin identity and claim, and the privileged Cloud Function must be deployed. |
| Is the system production-ready? | Build and local backend checks pass, but beta results, deployed Security Rules, real Firebase integrations, native-device behavior, and operational setup still need confirmation. |

## Reporting and exit criteria

Before widening the beta, resolve all security blockers, confirm no cross-account
or cross-shop data appears, and close every Blocker/High issue. Re-run failed
scenarios on the affected platform. Keep a dated issue log with test ID,
reproduction steps, owner, status, and verification result. Do not mark a feature
verified solely because its bundle builds or its service-level test passes.
