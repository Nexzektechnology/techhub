# Business foundation increment — 17 November 2026

## Delivered locally

New workspace: `/company/<slug>/business`, linked from company operations and commerce. Navigation follows the user's actual permissions. Company name, configured logo, primary color and body font are retained. The workspace has stock KPI cards, a scoped low-stock list, branch filtering, search, pagination, customer/supplier editing, product master editing, stock adjustments, movement accountability, empty/error/read-only states, responsive tables, a collapsible sidebar and `/` to focus search. Figures come from PostgreSQL, not sample dashboard data.

Migration 063 extends existing products and suppliers, introduces an independent tenant customer master and immutable command receipts, and reuses inventory/movements and existing permissions. Product fields include tenant-local SKU/barcode, supplier, exact-kobo cost/wholesale/minimum references and the existing reorder point. Customer and supplier records can be edited or inactivated without deleting their identity. Creating a contact creates neither an Auth user nor a financial entry.

The command engine covers customer, supplier, master and stock commands, with actor-bound idempotency, transaction locks, tenant foreign keys, server validation, original result replay and audit linkage. The existing receiving form now uses that keyed endpoint. Posted new-tenant movement records and receipts reject edits/deletion. Reservation release events are distinguished from physical stock changes. The older product snapshot omits the new private cost/supplier fields; inventory-only staff never receive that master data.

## Verification

See [ACCEPTANCE.md](ACCEPTANCE.md) for all 28 requested workflow boundaries. The final full regression run passed 346 tests in 67 files. Focused database/API/commerce/first-install checks and real-app browser acceptance were rerun after review changes. Desktop and 390px mobile screenshots were inspected; browser tests exercise actual PostgreSQL RLS with loopback Auth/payment fixtures. Production webpack build, TypeScript and ESLint are release checks; final run results are recorded below.

## Remaining scope and release gate

This is the first foundation increment, not the completed operating system. The unified command boundary does not yet cover existing legacy integrations or every sale/payment. Existing unkeyed commerce RPC stock writes remain compatible; the current UI uses the keyed engine. Mounted-page retry does not survive a reload and is not offline synchronization. The product supplier selector shows the first 100 active suppliers; the supplier directory itself is searchable and paginated. Cost references do not implement historical valuation, profit or margin enforcement. The customer directory does not yet link ecommerce history, credit accounts or Auth profiles. New directories/master data require company-level authority; location-only roles receive scoped stock information. Broad public API, exports, approvals, tax/e-invoice compliance, affiliate custody, serialized stock and the remaining phases are pending.

This increment adds no dependencies, retains the authentication stack and deployment infrastructure, and delivers its schema changes in additive migration 063. No real customer records, production database, provider settings, payment, DNS or hosted deployment were changed. The designated SaaS preflight rejected the local database target before connection. Hosted schema/migration inspection, verified backup/restore evidence and staging acceptance are still required before migration 063 is applied to that project. Read [AUDIT-AND-PLAN.md](AUDIT-AND-PLAN.md) and [STOCK-AVAILABILITY.md](STOCK-AVAILABILITY.md) before rollout.

## Final local check results

- `npx vitest run`: final run passed all 346 tests in 67 files, including the populated-database upgrade, business commands, API, commerce, pricing and first-install regression tests.
- `npx playwright test --config playwright.tenant.config.ts`: all 9 browser tests passed against fresh isolated fixtures, including both new workflows and existing tenant store/domain/bag/payment/billing/product regressions.
- `npm run lint`: passed.
- `npm run typecheck`: passed; the final production build also completed TypeScript checking.
- `NEXT_DIST_DIR=.next-preview npm run build -- --webpack`: passed, including static generation and standalone tracing. Build-generated preview-only TypeScript include entries were removed from the source configuration afterward.
- Desktop overview and mobile overview/history screenshots inspected under `artifacts/business-os-*.png` (ignored local QA artifacts). Screens used synthetic fixture records only.
- `git diff --check`: passed. The pre-existing untracked `supabase/.temp/` directory was left untouched.

Concurrent workspace changes to historical migration 052 and `tests/saas-install.test.ts` appeared during final verification; this upgrade did not author or revert them. Review their migration checksum implications separately before hosted installation. Migration 063 independently projects the storefront view's existing columns before extending products, so an upgrade from the older whole-row-dependent view preserves its interface, grants, owner, invoker rights and read-only behavior without exposing cost fields. A separate populated-database upgrade test preserves existing supplier/stock/order/reservation records, confirms the pending order can still be paid, and exercises a new post-upgrade receipt.
