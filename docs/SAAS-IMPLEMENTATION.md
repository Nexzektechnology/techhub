# SaaS implementation — 16–17 November 2026

The commercial foundation, independent storefronts, commerce isolation, scoped branch/warehouse permissions and consent-based automatic subscription billing are implemented locally. Migrations 049–061 are prepared and have not been applied to a hosted database. The owner requested offline testing now, with hosted validation available when hosting is ready. Offline evidence is not a production capacity, provider or disaster-recovery certificate.

## Deployment identity

The owner identified [Nexzektechnology/techhub](https://github.com/Nexzektechnology/techhub) and [Supabase project iipbmwpigedfslqybxmg](https://supabase.com/dashboard/project/iipbmwpigedfslqybxmg). These public identifiers are in `config/saas-deployment.json`. Earlier repository and private environment settings were preserved; a separate `techhub` Git remote was added. No source was pushed and no hosted configuration changed.

Use `build:saas`, `check:saas:hosting` and `db:saas:*` for this deployment. They check the designated project instead of using the earlier Hostinger public defaults. Configure matching credentials privately. A dashboard URL provides no database credentials or proof of migration parity.

## Implemented behavior

| Area | Behavior |
| --- | --- |
| Existing data | Owner-confirmed flagship ownership, restrictive policies, company indexes and validated composite relationships. Original migrations 001–048 and existing IDs/workflows are retained. |
| SQL isolation | Private execution roles constrain original privileged commerce routines to the flagship and new routines to validated company context. Context restores on return/error. Neither role is granted to browser/session roles. Optional legacy modules remain flagship-bound. |
| Commerce | Company categories/products/options, branches/warehouses, stock adjustments, orders, scoped role assignments and storefront publishing. PostgreSQL enforces server prices, warehouse reservations, totals and idempotent payment application. |
| Permissions | Explicit company/branch/warehouse grants, active locations, membership, granular permission/read dependencies and delegated-grant restrictions. Stock and orders respect assigned locations. Legacy administrators cannot read new-company commerce through original RPCs. |
| Public stores | `/store/<slug>` product/cart/checkout/confirmation pages reuse existing components and company branding. Independent bags, catalogue, fulfilment warehouse, delivery fee and verified settlement subaccount. Unavailable stores never fall back to the flagship. |
| Payments | Immutable invoices, separate SaaS key, bounded raw-body signed webhooks and independent provider verification. Tenant payments also verify settlement recipient. Late/ambiguous transactions require reconciliation. |
| Automatic billing | Explicit versioned consent and company-bound AES-256-GCM encryption of reusable provider authorizations; no raw card details. Durable queue, leases, one submission per reference, verify-only recovery, bounded retries, cancellation and in-app notifications. Charges pending over 24 hours enter review. |
| Operations | Authenticated jobs endpoint, scheduler entrypoint, worker heartbeat, reservation expiry and MFA-protected health RPC/API. Audited commercial enrollment for existing companies excludes the owner-operated flagship. |
| Foundation | Verified onboarding, company switching, configurable plans/prices, trials/grace/read-only access, invitations/seat limits, private files/byte quotas, optimized images, versioned branding, domain verification and MFA platform administration. |

## Migration map

- 049–051: commercial kernel, domains/private assets, quotas, runtime guards and rate limits.
- 052: confirmed legacy ownership and composite foreign keys.
- 053–054: private roles, company boundaries, location grants, commerce commands and paginated snapshots.
- 055: published catalogue, checkout/reservations, settlement verification, payment and expiry transactions.
- 056: automatic billing consent, encrypted-token storage, charge queue/leases and notifications.
- 057–058: payment initialization claims and company-scoped cart price refresh.
- 059–060: commercial enrollment/health and company-scoped directory/hierarchy triggers.

The offline inventory reconstructs the resulting catalog. The migrator checks applied checksums, serializes deployment and excludes development seeds. Existing-database migrations require backup/restore evidence; offline tests and hosted acceptance commands do not.

## Verification and limits

See `SAAS-VERIFICATION.md` for measured results. Offline browser acceptance runs the real Next application and PostgreSQL RLS with loopback Auth/REST/payment simulators. The workload exercises 100 companies and 1,000 synthetic users. PGlite queues concurrent work through one session; these timings cannot establish hosted capacity. CI is prepared in `.github/workflows/tenant-offline.yml` without service secrets. The optional hosted workload uses separate staging credentials and pooled TLS connections.

Hosted role/PostgREST behavior, real Auth/Storage restoration, SMTP, actual payment/subaccount responses, HTTPS/DNS, host restarts, scheduler execution and concurrent capacity still need commissioning. No hosted backup, migration, charge, deployment or DNS change was performed.

The full master brief extends beyond this core commerce release. New-tenant POS, procurement/transfers, refunds, customer account history/CRM/reviews, advanced delivery/reports, PDF/email document templates, email notification delivery, support sessions, add-ons, tenant export/deletion and automated orphan cleanup are not implemented by the new tenant endpoints. Existing flagship features remain available where they already existed. Delivery stays disabled for new tenants. Employee/storage limits exist; configurable branch/product/order quotas and request/egress metering are not included. Domain roots enter the central company workspace; custom-domain storefront sessions are not claimed.

Preserve financial evidence and additive schema during rollback; prefer forward fixes after tenant/payment activity. See `SAAS-OPERATIONS.md`.

Dependency hardening: Next.js and its matching ESLint configuration were patched from 16.4.3/16.4.0 to 16.4.6. The production dependency audit returned zero advisories after the update. The upstream [root-parameter cache disclosure advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) affects releases through 16.4.4. This audit result is a point-in-time dependency check, not a security certification.

Migration 061 explicitly places `pg_temp` after the trusted public schema for existing function search paths and revokes public-schema CREATE from browser roles. Tests attempt temporary profile/product spoofing and confirm the original profile role and company records remain authoritative. This follows PostgreSQL's guidance for [safe SECURITY DEFINER functions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

See [the changed-file manifest](SAAS-CHANGES.md) for all modified and added source paths.
