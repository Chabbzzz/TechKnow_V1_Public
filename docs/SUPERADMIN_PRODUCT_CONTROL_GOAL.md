# Super Admin Product Control: revised goal

Date: 2026-10-28

This document defines the revised purpose and proposed scope of Product Control.
It is based on the repository documents and checked against the current store
and customer flows. It does not claim that the proposed screens or workflows
are already implemented or deployed.

## Goal

Provide platform-wide oversight of store product listings so customers can
discover, compare, and reserve products using complete, consistent information
about the product, its store, price, and availability. Help the super admin
identify catalog problems, track their resolution by the responsible store,
and manage store listing policies with an accountable record of changes.

## How the goal supports each role

| Role | Responsibility | What Product Control should support |
| --- | --- | --- |
| Store admin | Create and maintain their own products, prices, categories, images, stock, and archive state; accept or reject their shop's reservations. | Show which listings need correction, why, and any applicable listing limit. Keep inventory decisions with the responsible shop. |
| Customer | Discover products, compare shops, save favorites, receive product alerts, and make reservations. | Help maintain accurate shop identity, comparable product details, and understandable availability. Make hidden, archived, and unavailable states consistent across customer flows. |
| Super admin | Oversee the catalog across shops and administer platform policies. | Inspect listings, identify issues, follow up with the responsible shop, and record policy changes. |

Store-admin sign-in presence is separate from product availability. An offline
shop owner does not mean their products are out of stock. A listing's stock state,
archive state, customer visibility, and policy-limit state must have distinct labels.

## Proposed screen priorities

### 1. Catalog overview

Show total listings, customer-visible listings, archived listings, and listings
needing attention. Make each count filter the corresponding records. Count
product listings separately from units in stock.

Customer visibility must use the same eligibility rules as the customer app.
Do not describe a store as officially verified merely because its record has
enough identity information to appear in the catalog.

### 2. Listings needing attention

Identify concrete, explainable issues:

- Missing product name or category.
- Missing, non-numeric, negative, or non-finite price.
- Missing or invalid stock quantity, or a stock label inconsistent with quantity.
- Missing store assignment or a store record that cannot be resolved.
- A mismatch between expected customer visibility and the listing's actual state.

Show the affected product, responsible store, issue, and recommended correction.
Missing images or descriptions can be completeness suggestions, since the current
creation flow does not require them. Low stock and out-of-stock are normal
inventory states, not automatically violations.

A future correction workflow should record an open/resolved issue, a reason,
the responsible store, and timestamps. Recheck the underlying listing before
marking the issue resolved. Automated checks flag records for human review;
they do not establish fraud or authorize automatic deletion.

### 3. Platform catalog

Provide search and filters for shop, category, stock state, archive state,
customer visibility, and identified issues. A listing detail view should show
the information needed to understand what customers see and what the store
must correct. Keep legitimate offers of the same product from different shops
available for comparison; matching names alone are not grounds for removal.

### 4. Store catalog summary and limits

For each shop, show total, non-archived, and archived listing counts alongside
issue counts. Keep product limits as an optional policy setting within this
summary, rather than using quota usage as the primary measure of catalog quality.

Preserve the requested per-store limit behavior: a whole-number limit, zero to
block additions, or no limit. Existing and archived listings count under the
current policy; lowering a limit does not remove existing products. Label this
explicitly. A listing limit is distinct from the store portal's 0–10 units per
listing stock-entry rule.

The store portal should display the current limit, usage, and remaining capacity
before submission. At the limit, explain why creation is blocked and what the
store can do. A blocked addition must not prevent valid updates to existing
inventory or handling existing reservations.

### 5. Product policy history

Show who changed a limit, which shop was affected, previous and new values,
and when the change occurred. If correction requests or product moderation
are implemented later, give them a reason and an auditable outcome as well.

## Role boundaries

- Store admins remain responsible for their prices, stock, listing edits,
  archive/restore decisions, and reservation fulfillment.
- Super admins inspect catalog data and manage platform policy. Routine
  inventory editing and reservation acceptance do not belong in Product Control.
- Review moderation, account suspension, and permit review remain in their
  existing sections, with links from a product or store where useful.
- Product-specific hiding, removal, approval queues, duplicate detection, and
  correction notifications are new capabilities requiring separate implementation.
- Product-count limits do not improve ranking or prove listing quality. Ranking
  inputs must continue to reflect the documented comparison criteria.

## Example workflow

A customer compares keyboards from two shops. One listing has an invalid price.
Product Control identifies that issue and the responsible shop. In the proposed
correction workflow, the super admin records a request for correction, the store
admin updates its listing, and the issue is rechecked and resolved. Customer
comparison uses the corrected price without a super admin changing the shop's
inventory or accepting its reservations.

## Acceptance criteria for the rework

1. Every catalog count and filter can be reconciled with the underlying records.
2. The same listing has consistent shop identity, price, stock, and visibility
   across the super-admin view, store portal, and customer flow.
3. Archived products remain inspectable by admins and are excluded from the
   customer catalog. Out-of-stock products follow the documented waiting-list
   behavior rather than being treated as invalid listings.
4. Each identified issue states a specific reason; normal low-stock conditions
   and legitimate cross-shop comparison offers are not labeled violations.
5. Store admins can only correct their own listings. Proposed correction records
   can be traced from identification through resolution.
6. Limit changes persist, are auditable, and apply consistently to new additions.
   Concurrent additions cannot exceed the limit; existing products are preserved.
7. Failed actions show a useful error, retain input for retry, and never report
   success. Server authorization and database rules enforce role boundaries.

## Current implementation and remaining work

The existing Product Control screen lists all products and shop usage, with
per-store limit inputs. The repository includes callable code for saving limits
and enforcing them during product creation. During the preceding check, both
new callable URLs returned 404; live deployment has not been verified.

The Product Control screen now implements the overview counts, listing search,
shop/category/stock/visibility filters, customer-visibility labels based on the
customer catalog's store-mapping and archive rules, listing-detail checks, and
per-store active/archive/issue summaries. These flags are review guidance only;
they do not persist correction records, notify a store, or change customer access.
Per-store limits remain editable in the store summary.

Correction tracking, store notifications, a product detail/review workflow,
and store-facing quota display are still proposed work. The deployed database
rules are not present in this workspace. Local checks do not establish live rule
enforcement or deployment success.

## Source basis

| Source | Requirement or constraint used |
| --- | --- |
| [Beta Testing Reviewer Guide](BETA_TEST_REVIEWER_GUIDE.md), C2–C7 and C10 | Discovery, accurate cross-shop comparison, reservations, waiting-list behavior, and product alerts. |
| [Beta Testing Reviewer Guide](BETA_TEST_REVIEWER_GUIDE.md), S1–S5 and A3–A6 | Store ownership, inventory maintenance, reservation responsibilities, platform oversight, and privileged access. |
| [Backend services documentation](../backend/README.md), Implemented flows | Authoritative product/store data, stock changes on reservation acceptance, ownership checks, and archive behavior. |
| [Platform administration documentation](../backend/functions/README.md), Available behavior | Catalog oversight, separate account/review actions, per-store limits, audit records, and deployment dependencies. |
| [TOPSIS documentation](../ml/topsis/README.md) | Comparison ranking uses weighted criteria such as price, distance, rating, and stock. |
| [Customer catalog hook](../hooks/useProducts.js) and [store mapping](../constants/stores.js) | Current customer filtering excludes archived/demo listings and unresolved store identities; this is not official permit verification. |
| [Reservation policy](../backend/domain/reservations.js) | Archived products are unavailable for reservation; zero stock uses waiting-list behavior; restricted stores cannot accept new reservation requests. |

The revised priorities are a product-design synthesis of these sources. No
connected external document was accessible during this review, so no thesis or
external requirements document is represented as having been reviewed.
