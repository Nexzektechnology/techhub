# SaaS transformation audit — 16 November 2026

This records the baseline before implementation. Current changes/results are in `SAAS-IMPLEMENTATION.md` and `SAAS-VERIFICATION.md`. The owner subsequently designated `Nexzektechnology/techhub` and Supabase `iipbmwpigedfslqybxmg`; earlier deployment references below are historical evidence. Migrations 053–061 implement the isolated core commerce/permissions and automatic billing described in the implementation report.

## Decision

Evolve the existing Next.js modular monolith. Supabase remains the only production business database; retain Auth, Storage, Paystack, existing UI tokens, Vercel and managed Node deployment paths. **At the audited baseline, commerce was not tenant-isolated.** Company-scoped field operations existed; flagship commerce was global. A module flag alone would not isolate it; subsequent migrations and scoped application endpoints must deploy together.

This is a repository audit, not a certification of the deployed database, DNS, financial account or hosting capacity. Local environment files exist; their secret values have not been printed. No production configuration, schema, payment settings or DNS has been changed. Prior migration documents describe Hostinger production, a WhoGoHost preview, and an untouched Vercel backup; these are historical evidence, not a fresh remote verification.

## Architecture and existing workflows

545 source-controlled/nonignored paths were inventoried before implementation, including native shells and CI. Next 16.4.3 App Router, React 19.3, TypeScript, Tailwind 4, Zod 4, Node 24, Supabase SSR and server-side route handlers form one application. `src/proxy.ts` refreshes verified Auth sessions and supplies nonce CSP and private-response cache headers. `src/lib/server.ts` separates cookie-authenticated RLS clients from the server-only service client. A SQLite adapter is restricted to localhost, nonproduction and absent Supabase settings; it is a development fixture, not a SaaS database.

Existing modules: public catalogue/category hierarchy/brands/deals/gallery/content, merchants, cart/wishlist/account, verified-email authentication/recovery, checkout/reservations/allocations, Paystack initialization and verification, refunds, ledger/settlements/payout requests, POS, product imports, inventory/procurement/suppliers/warehouses, staff/principal reporting, van stock/sales, customer imports and legacy history, support/consent, dispatch/driver feedback, operational custom roles, reversible deletion, company workspaces/branding, outlet routes/GPS visits/shifts, team schedules/messages and emergency contacts. Preserve these implementations.

Public shop routes live in `(shop)`; `/admin` has resource-specific screens and `[resource]`; `/staff`, `/merchant`, `/driver` remain flagship operational portals. `/company/[slug]`, `/field/[slug]`, `/workspaces` use authorized company membership. `/platform` and `/platform/security` form the separate software-owner environment. `/api` contains business mutations and exports; route inventory is generated in `SAAS-INVENTORY.md`. Existing `/api/subscriptions` means newsletter consent, **not billing**; retain it and introduce SaaS billing under a distinct namespace.

## Database and authorization

There are 48 ordered, additive SQL migrations before this change. Migration 001 establishes relational commerce and transactional RPCs; 009 adds `platform_companies`, memberships, platform administrators, modules, domains, audit, brand history and field operations. Later migrations extend these workflows. `SAAS-INVENTORY.md` records tables, columns, foreign keys, indexes, RLS policies, triggers and function signatures from a locally reconstructed PostgreSQL catalog, plus every application route. Reconstruction does not prove remote migration parity.

Identity tables (`profiles`, `auth.users`) are global by design. Flagship tables include organizations/memberships/merchants, products/categories/brands, inventory/reservations/procurement, orders/items/allocations, addresses, payments/refunds/ledger/settlements, deliveries/returns/reviews, content/theme/assets, POS, business/principal data, legacy imports, support, consent, wishlists and global commerce custom-role assignments. Most do not have a company ID. Their policies and SECURITY DEFINER functions use global `app_role()`, staff status, merchant ID or customer identity. Adding an ID column alone will not isolate them.

Tenant tables already include platform memberships/modules/domains/audit/brand versions, field stores/assignments/shifts/visits/routes/location requests, company staff invitations, team schedules/contacts/messages and staff payout requests. Composite company foreign keys in field/team workflows prevent cross-company joins. Company context verifies membership through `auth.uid()`; the URL slug is a selector, not authority. Platform access requires an explicit `platform_admins` grant and an `aal2` claim; company admins cannot elevate themselves. Existing custom commerce roles deliberately exclude other-company members and supplier clients.

## Security assessment and debt

| Finding | Consequence and required action |
| --- | --- |
| Global commerce authorization | Critical cutover blocker. Migrate all linked records, keys, views, RPCs, grants, exports and policies together before new tenants sell goods. |
| Public legacy `brand-assets` bucket, global paths | Appropriate for existing public assets only. New confidential company files require a separate private bucket, tenant paths and RLS; do not break existing image URLs. |
| Company kernel has no commercial subscription state | Add plan/price catalogs, subscriptions, immutable invoice prices and service-only payment application. Never equate a browser redirect with payment. |
| Domains table has only a verified flag | Add ownership challenge, expiry, provider/SSL activation and safe resolution. Hostname alone cannot authorize membership. |
| No self-service tenant creation | Add confirmed-identity onboarding with transactionally enforced retry keys and duplicate-slug handling. Do not reuse global staff role grants. |
| Shared Paystack account/webhook | Historical docs identify an existing Nexzek destination. Preserve it; commission signed event routing or a separate account before billing launch. |
| Company snapshots fetch full memberships; bounded 100-company overview is not a total | Add paginated control-plane queries and aggregate metrics. Do not infer total-company or load capacity from one page. |
| Existing same-origin guard assumes one configured domain | Custom-domain mutations need verified server-side origin resolution. Preserve flagship origin behavior. |
| Email is Supabase Auth SMTP; notifications are not a delivery system | Add an outbox/provider commissioning before promising branded transactional mail or automated reminders. Never spoof an unverified sender. |
| No documented representative concurrency or recovery drill | Production launch remains blocked pending measured load and isolated restore exercises. Unit tests do not certify 100-company capacity. |

Positive controls include server-only secrets, verified Auth sessions, SQL role checks, explicit function revokes, RLS, integer-kobo prices, raw-body HMAC, independent provider verification, idempotency, stable inventory lock order, validated image signatures, no SVG uploads, CSP, same-origin mutation checks, permission-scoped exports and private cache headers. These require regression testing, not replacement. Current dependency advisories need CI's `npm audit` check; this audit does not claim a fresh online vulnerability scan.

## Hosting, integration and environment inventory

`next.config.ts` emits standalone Node output, limits build CPUs, preserves apex redirects, image hosts and security headers. `vercel.json` uses the existing build path. WhoGoHost uses a separate preflight/build path; no MySQL is needed. Android/Windows shells allow explicitly trusted existing domains; new tenant-domain/native support needs separate acceptance. CI runs lint, type generation, unit/PostgreSQL tests, dependency audit, Playwright, standalone build and production smoke.

Existing variables: public site origin, Supabase URL/publishable key; private Supabase service key, Paystack secret, optional cron secret; deployment-only database URL/CA; local-demo/database-path and build-output settings. `.env.example` documents names. Never copy private values into client variables or reports. Supabase Cron handles stock expiry and location retention. No evidence of a production queue, live Realtime listener or separate microservice was found.

## Backup and migration requirements

Owner clarification received during implementation: **all existing commerce belongs to E-Edge Direct 2U**. Proposed migration 052 records the flagship owner on legacy commerce, retains compatibility and validates company-aware foreign keys. It keeps a restrictive flagship boundary until the actual multi-company commerce cutover. This clarification does not verify the deployed catalog or replace the required hosted backup and staging validation.

Clean baseline commit: `5d660671dbc1edd61d4700539be9c43bf619e4a4`. Local ignored backups: `.data/saas-baseline-20261116/repository.bundle` (SHA-256 `fa9085a13ea4d9c83dd88fff19766485490873f75ee6674712fff797198eb0da`) and `source.zip` (`5ea839c7288e84622cbcdfb0813aedc4e67dfee6406878cd6ebf8abe405d74ea`). These contain tracked source/history, not live database or Storage backups. Do not describe them as database disaster recovery.

Verification: the Git bundle records complete history, and the ZIP was extracted into a separate ignored directory with 553 files. A synthetic local PostgreSQL fixture also passed a physical backup/restore and migration count/balance comparison. Hosted Supabase/Auth/Storage restoration remains unverified.

Before live schema changes: inventory the deployed catalog and migration checksums; export schema/data with a consistent PostgreSQL snapshot and role configuration; back up private/public Storage objects and Auth configuration; verify PITR availability; restore into an isolated project; record counts, foreign-key consistency, representative financial balances and ownership mapping. All present commerce records require reviewed mapping to the flagship or their actual owner; no automatic reassignment based on guessed names. Compare counts and balances after migration. `scripts/database.cjs` already refuses untracked schema drift and serializes migrations; retain it. Add a backup/restore evidence gate for SaaS production migrations.

Potential breaking changes: global primary keys/slugs, profile roles and staff grants, public views and all definer RPCs, storefront/cart persistence across companies, image URL lifetimes, cookies across unrelated domains, callback allowlists, default branding and native domain restrictions. Stage changes behind explicit provisioning; keep compatibility facades. Suspension must preserve records and allow authorized billing recovery/export.

## Controlled implementation sequence

1. Audit, catalog/route inventories and source baseline (this report); run current checks.
2. Add tenant commercial metadata, configurable plan/price/module catalogs, subscription periods, invoice/payment and usage ledgers with RLS. Existing companies remain grandfathered; existing field access is preserved.
3. Confirmed-account self-service onboarding, idempotent tenant creation and secure workspace switching. Use existing Auth email verification/recovery.
4. Extend existing brand tokens and version history in company settings; reuse approved fonts/validation; add private tenant asset flow.
5. Domain submission/ownership challenge and provider-gated activation/resolution. Configure actual DNS/SSL/Auth origins separately after staging acceptance.
6. Paystack checkout and verification, signed dedicated webhook, immutable invoice amount checks, renewals/cancellation/grace periods and reconciliation; no implicit live provider changes.
7. MFA-gated plan administration and aggregate commercial dashboard; paginated company lists.
8. Company-scoped roles/permissions and explicit branch/warehouse assignments; preserve current field-role semantics.
9. Storage quotas and private access; durable rate limits and usage reporting; outbox/background work, monitoring, measured performance.
10. Two-company SQL and direct-API attacks, regression tests, staging payment/email/domain/Storage acceptance, backup restore and load evidence, then production deployment review.

Commerce cutover is a separate staged migration across the full catalog and financial graph. Additional tenants must not receive access to flagship inventory while it is unfinished. Each phase's actual files, checks, rollback and remaining work are recorded in `SAAS-IMPLEMENTATION.md`. No phase or production-readiness claim is inferred merely from this plan.
