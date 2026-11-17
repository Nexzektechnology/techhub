# SaaS testing, deployment and recovery

The owner has now requested deployment. Offline checks have passed and application-key access to the designated Supabase project was verified read-only. Account authorization for database installation and Vercel deployment remains unavailable. Tests need no hosted credentials or migration evidence. No hosted mutation or new deployment has been performed. See [current checkpoint](BIZHUB-DEPLOYMENT-PENDING.md).

## Deployment identity and build

Repository: [Nexzektechnology/techhub](https://github.com/Nexzektechnology/techhub). Supabase: [iipbmwpigedfslqybxmg](https://supabase.com/dashboard/project/iipbmwpigedfslqybxmg). Public identifiers are in `config/saas-deployment.json`. The earlier flagship remote/private environment were preserved; `techhub` is a separate Git remote. No source was pushed.

Legacy `build:vercel`/`build:hostinger` prepare the previous flagship defaults. For this SaaS host use `npm run build:saas`, which does not call that legacy preparation script. Privately configure the actual HTTPS `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL=https://iipbmwpigedfslqybxmg.supabase.co`, its matching publishable/anon key, and `LOCAL_DEMO=false`. Matching server-only service/payment/encryption/scheduler credentials belong in host settings. Never mix keys from the previous project. `npm run check:saas:hosting` checks runtime configuration offline without contacting providers.

## Offline verification now

```text
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run test:tenant:e2e
npm run test:load:offline
node scripts/saas-inventory.cjs
```

Tenant browser tests supply fake credentials, loopback identity/REST/Paystack fixtures and an ephemeral PostgreSQL engine with every migration. Real application login, SQL RLS, cart isolation, denied warehouse mutations, checkout, signed webhooks, payment replay, explicit automatic renewal and cancellation run without external service access. Browser external HTTPS requests are intercepted; provider/image overrides are disabled in production. Fixtures refuse production startup.

The workload provisions 100 companies, 1,000 synthetic users and 300 products. It performs 2,000 mixed authenticated/catalogue/inventory/stock/checkout/payment-replay/isolation operations at logical concurrency 20. Active actor/company counts, percentiles, errors and source hash are saved in `artifacts/tenant-load-offline.json`. PGlite queues work through a single PostgreSQL session; this measures offline correctness and contention, not hosted production throughput. Bounded overrides: `LOAD_COMPANIES`, `LOAD_USERS_PER_COMPANY`, `LOAD_REQUESTS`, `LOAD_CONCURRENCY`.

## Hosted validation when ready

1. Use an isolated staging application/database, provider test keys and controlled email delivery. The designated primary project is not automatically a disposable staging fixture. Check its actual catalog, migration ledger and role privileges; PGlite does not reproduce every hosted Supabase/PostgREST behavior.
2. Configure `DATABASE_URL` privately for the designated SaaS project and run `npm run db:saas:plan`. Its exact direct/pooler project check runs before connecting. For another intentionally isolated staging project, use generic `db:plan`/`db:migrate` with that staging environment. Both preserve checksum/evidence protection.
3. For existing data, capture consistent PostgreSQL, Auth/configuration and Storage backups and restore separately. Compare every table count, validated relationships, representative IDs, stock/reservations and order/payment/refund/ledger balances. All historical commerce belongs to E-Edge Direct 2U (`10000000-0000-4000-8000-000000000001`) as confirmed by the owner. Complete the evidence file below. A genuinely empty database does not require a fabricated backup attestation.
4. Apply migrations 049–062 after reconciliation; original 001–048 are unchanged. For a genuinely empty schema, `npm run db:saas:bundle` prepares an atomic first-install SQL-editor fallback that refuses existing public tables or a previous ledger. It never runs hosted SQL itself. Measure locks/index validation on restored data. The normal runner excludes development seeds and refreshes PostgREST. Confirm private execution roles cannot be assumed by anon/authenticated/authenticator, appropriate schema/Auth grants exist, and all public business tables have RLS.
5. Deploy a clean checkout with the SaaS build profile. Commission Supabase Auth email redirects/SMTP and private Storage. Use a separately granted platform administrator with MFA to configure published prices/modules at `/platform/billing`. Create two confirmed company owners and warehouse staff; receive stock and publish both stores. Test direct PostgREST/API attacks as well as UI behavior.
6. Link each provider-verified settlement subaccount in platform billing; its registered business name must match the company. Test actual provider responses, amount/currency/reference, settlement recipient, unique transaction identity, duplicate/stale webhooks, expiry, concurrent checkout, outages and abandoned initialization. Never resubmit an ambiguous reference.
7. Configure `STAGING_DATABASE_URL`, optional `STAGING_DATABASE_CA_PATH` and matching `STAGING_PROJECT_REF`; run `npm run test:load:hosted`. It refuses the existing `DATABASE_URL` target and requires an exact Supabase direct/pooler identity. It uses pooled verified-TLS connections, creates prefixed synthetic data and sends no provider charges. Fixtures remain for inspection. It uses synthetic SQL Auth claims; real HTTP/Auth/Storage acceptance is separate. A prior hosted report is not required to invoke it.
8. Commission HTTPS, process restart/recovery, callback/webhook delivery, scheduler, monitoring and complete backup/Auth/Storage restoration before commercial traffic. Record actual hosted latency/error/recovery measurements.

## Scheduled billing

Commerce uses `PAYSTACK_SECRET_KEY` and `/api/payments/webhook`; SaaS uses a separate `SAAS_PAYSTACK_SECRET_KEY`, `/api/saas/billing/webhook` and `/billing/return`. SaaS never falls back to the commerce key. Preserve historical shared provider webhook routing until deliberately commissioned.

Configure a separate, backed-up 32-byte base64 `SAAS_BILLING_ENCRYPTION_KEY`. Reusable authorization ciphertext authenticates the company ID; raw card details are never stored. Do not remove/rotate the key without migrating and verifying existing tokens. Renewals use the immutable price/cycle explicitly consented by the payer; publishing a replacement price cannot silently increase it.

Set private `CRON_SECRET` (at least 32 characters) and `SAAS_WORKER_URL=https://<canonical-host>/api/saas/jobs`. Configure the host scheduler to run `npm run ops:billing` every five minutes, or invoke that endpoint with bearer authentication through the host scheduler. No schedule has been installed. HTTP is permitted only with `--offline` on 127.0.0.1.

The worker expires inventory reservations even when charging is unconfigured. Otherwise it queues due renewals, leases up to five jobs and submits each reference once. Recovery leases verify existing references and never repeat charges. Verified failed/abandoned attempts back off; three failures halt automatic attempts until payer review/update. Pending/ambiguous charges enter review after 24 hours. In-app notifications exist; email delivery is not implemented. Cancellation disables future unsent jobs and pending consent intents; already submitted payments must still be reconciled.

Monitor MFA-protected `GET /api/platform/health` for worker freshness (15 minutes), due/review jobs, unsafe grants, legacy routine changes, missing RLS, invalid foreign keys and stale domains. Configure host alert delivery separately. Never manually mark a job paid to bypass independently verified invoice payment.

## Private migration evidence

For SaaS migrations on existing data, point `SAAS_MIGRATION_EVIDENCE` at private JSON outside Git/document roots:

```json
{
  "target_sha256": "<actual database target hash>",
  "backup_file": "C:\\private\\before-saas.dump",
  "backup_sha256": "<consistent backup SHA-256>",
  "restored_at": "<successful isolated restore UTC timestamp>",
  "restoration_verified": true,
  "record_counts_verified": true,
  "ownership_reviewed": true,
  "rls_tests_passed": true,
  "storage_backup_verified": true
}
```

Restore evidence must be within 24 hours. `targetHash()` in `scripts/saas-migration-gate.cjs` hashes username/host/port/database without the password; compute from privately loaded credentials. Backup hashing streams bounded chunks. Flags are operator attestations, not independent certification. The repository migrator enforces this gate; manual SQL editors do not. It does not restrict offline tests or hosted acceptance commands.

## Domains, files and recovery

Domain TXT ownership does not establish routing or TLS. Keep `SAAS_DOMAIN_ROUTING=false` until commissioned. Verified customer domains and assigned platform subdomains serve public storefronts at their own address. Authentication and checkout use the central origin, with a bounded public-cart handoff and fresh company prices. Customers need no shared cross-domain session. Preserve production SMTP/DNS during staging.

Private uploads use `tenant-files/tenants/{company_id}/{folder}/{uuid}.{ext}`, locked byte reservations and server uploads. Browser INSERT is denied; downloads use scoped signed URLs. Images are decoded, bounded, stripped of metadata and re-encoded. Publishing a selected logo exposes that logo only. Uncertain uploads retain quota until cleanup is confirmed. Automated orphan reconciliation and tenant export/deletion remain outside this release.

Baseline `5d660671dbc1edd61d4700539be9c43bf619e4a4` has a verified Git bundle and separately extracted source ZIP (553 files); paths/hashes are in `SAAS-AUDIT.md`. A synthetic physical database restore compares counts and financial/stock totals, but cannot certify hosted Supabase/Auth/Storage recovery.

Before new tenant activity, a compatible application baseline can be restored while retaining additive schema. After activity, prefer forward fixes, preserve financial evidence and maintain reconciliation. Do not drop tenant keys/tables/assets to undo deployment. Full restoration requires aligned database/Storage/provider evidence before reopening writes. Confirm actual PITR availability, external encrypted backups and measured RPO/RTO through an isolated restore drill.

For a standalone Node host, the SaaS build copies `public` and `.next/static` into `.next/standalone`. Start `node --use-system-ca .next/standalone/server.js` with the host-assigned `PORT` and private runtime environment. Vercel can use its normal Next.js deployment with the same SaaS build command. Neither path provisions database credentials or schedules the billing worker automatically.

The SaaS packager removes copied `.env` files from standalone output, including the previous flagship's public defaults. It does not change source environment files. The local build used synthetic public/service credentials and blocked external requests; rebuild on the host with the actual public configuration before deploying. Do not upload the offline verification build as a credentialed release.
