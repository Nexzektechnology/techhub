# Hosted and offline verification — 19 November 2026

The core is live at https://nexzekbizhub.vercel.app; manual: https://nexzekbizhub.vercel.app/manual. Vercel production compilation, TypeScript and route generation passed on Node 24. Actual HTTPS home/manual/login/start returned 200, worker/platform health denied unauthenticated access, and the three public mobile pages passed without overflow or page errors.

Supabase installed 64 exact-checksum migration files (001–062 and additive 064 and 066). All public tables have RLS, foreign keys are validated and tracked legacy routine integrity is intact. A real PostgreSQL transaction verified company and warehouse boundaries and restored caller context; all its synthetic identities and business records rolled back. The private Auth bridge is inaccessible to browser roles and preserves the managed Auth table's ability to add columns.

The authenticated live worker returned 200, processed zero charges and reported automatic billing paused. Its Supabase Cron/Vault/pg_net commissioning request returned 200 and recorded a heartbeat. Starter is published as the approved trial. SMTP, Paystack acceptance, custom DNS/HTTPS, full hosted restore and representative concurrent hosted load remain open. The production dependency audit found zero advisories.

The complete pre-adaptation regression passed 324 tests in 64 files. The final regression with hosted Auth permissions passed **327 tests in 65 files**. Lint passed. The five-minute Cron schedule completed an actual successful run, returned HTTP 200 and refreshed the worker heartbeat.

## Current offline workload

The current offline-release workload passed on 19 November 2026 (Africa/Lagos): **100 companies, 1000 active authenticated users, 300 products and 2000 operations at concurrency 20**, with zero failures and zero isolation failures. Source SHA-256: aa23275de90d778828d31248911b716598cdcf1074db601aef8c5677a9fd0f83; run aa5889ab-d532-41a4-a32e-c87d05beea95. Setup: 33.565s; workload: 122.664s. Latency p50 1071.09ms, p95 2632.58ms, p99 2873.99ms. The retained current report is SAAS-OFFLINE-LOAD.json. This is the single-session PGlite correctness workload, not production HTTP capacity. The complete regression on the same release passed **335 tests in 67 files** in 362.50s.

The earlier post-hosting-compatibility run on 18 November passed the same company/user/operation counts with no failures. Its source was 59e02a1aa187682493ba5ea594209a223b30a862b21b83aa71216229fdd8917c, run bdff7c55-dc34-49eb-b58a-49215d2ae5d6; workload 72.891s, p50 598.39ms, p95 1496.31ms and p99 2247.75ms. Those timings describe a different source snapshot and local run, not hosted capacity.

## Historical offline evidence

The following entries describe earlier source snapshots; their negative deployment statements are superseded by the hosted status above.

# Offline SaaS verification — 17 November 2026

## Follow-up — deployment preparation

- The complete SQL/API/business regression passed **321 tests in 63 files** after the subdomain migration. Two additional first-install SQL safety tests passed separately, including preserving an untracked existing record and refusing installation replay. The **11 runtime/configuration tests** passed again after requiring the BizHub deployment profile.
- The full existing browser suite passed **32/32** after separating the BizHub home page from the legacy shop layout. Custom HTTPS-domain routing, cross-company path rejection and cart transfer to central checkout passed. The mobile home/manual check passed again after correcting text wrapping and removing duplicate flagship branding.
- The latest combined tenant browser rerun could not start its servers because Windows exhausted process memory. This is an outstanding final combined rerun, not a passing result. The earlier completed run passed six scenarios; its manual-layout failure was fixed and that scenario subsequently passed in targeted runs.
- Next.js **16.4.6** production webpack compilation, TypeScript, route generation and standalone packaging passed with synthetic credentials and an external-network guard. Copied dotenv files were removed from the standalone output.
- The supplied new-project application keys were accepted by Supabase APIs. Its REST schema exposes no application resources. This was read-only; hosted migrations and operational acceptance have not run. The database-management and Vercel account-token fields remain empty. GitHub's push check failed because it could not obtain authenticated credentials.
- The workload report below predates the domain/branding additions and is retained as historical offline evidence. It does not validate current hosted capacity or certify production readiness.

See [deployment checkpoint](BIZHUB-DEPLOYMENT-PENDING.md) for the current handoff. The following original results describe the earlier verified source snapshot.

The owner requested offline testing before hosting. These results cover local implementation and synthetic fixtures. They do not certify hosted production capacity, provider acceptance or Supabase disaster recovery. Changes remain local; no code was pushed, database migrated, live charge submitted, DNS changed or scheduler installed.

## Recorded deployment targets

- [GitHub: Nexzektechnology/techhub](https://github.com/Nexzektechnology/techhub), added as the separate `techhub` remote.
- [Supabase: iipbmwpigedfslqybxmg](https://supabase.com/dashboard/project/iipbmwpigedfslqybxmg), recorded in `config/saas-deployment.json` and the environment example.

Earlier private environment files and the original source remote were preserved. Matching new-project credentials must be configured privately on the host. Use the SaaS build/migration profiles rather than the earlier flagship Hostinger defaults.

## Results

| Check | Result |
| --- | --- |
| Full SQL/API/business regression | **318 passed in 63 files**, including two-company isolation, original functionality and a synthetic physical database restore. |
| Hosted-load target safety | **9 runtime tests passed again** after strengthening the guard against the same Supabase project through another connection endpoint. No connection was made by these guard tests. |
| Tenant browser acceptance | **5/5 passed** on the real Next app with loopback Auth/REST/Paystack simulators and actual PostgreSQL RLS. |
| Complete existing browser suite | **32/32 passed**, including product editing/deletion/restoration, bag/reservations, Theme Studio, field GPS checks, authentication/recovery, service-worker privacy, CSP and mobile layouts. |
| Lint / diff whitespace | Passed. |
| Known-private-value scan | 3,239 source/standalone text files checked; **zero matches**. No copied dotenv files remain in the standalone artifact. |
| Production compilation | Next.js **16.4.6**, webpack, TypeScript, route generation and standalone asset packaging passed. External requests were blocked by a verification-only preloader; credentials were synthetic. |
| Production dependency audit | **0 advisories** after the Next.js security patch. Development tooling is excluded from this audit result. |
| Database catalog | **61 migrations and 152 routes** inventoried offline, including function owners, grants and trusted search paths. |
| Workload | **100 companies, 1,000 active authenticated users, 300 products, 2,000 logical operations, concurrency 20; zero failures and zero isolation failures.** |

Tenant browser checks exercise separate company/flagship bags; unauthorized branch/warehouse API attempts; paid checkout, signed webhooks and replay; explicit automatic renewal, a single due charge and cancellation; and an owner creating/editing product options, receiving stock and shopping on a 390px-wide screen. The mobile screenshot was inspected and the overflow assertion passed. Images and payment-provider responses were simulated; actual CDN/provider delivery remains a hosted acceptance task.

The expanded regression found and corrected shared directory-trigger compatibility, missing private legacy Auth lookup grants, settlement-recipient snapshot access under RLS, and an unscoped legacy refund service-role lookup. Tests also cover delegated permission escalation, temporary-table spoofing, expired reservations, ciphertext tampering, expired charge leases, cancellation replay and malformed scheduler authentication.

## Reproducible workload evidence

The original historical report was superseded by the current report linked above; the following figures are retained as historical evidence.

- Executed: `2026-11-16T23:07:08.330Z` (17 November, Africa/Lagos).
- Run ID: `7794b61a-c66d-4a3a-bd0d-c1dd371e3821`.
- Source SHA-256: `a71387eae23265e4ef9a941fcd9462b314b3cf804332de082852cbc71131bc5f`.
- Setup: 31.052 seconds; workload: 114.432 seconds.
- Logical-operation latency: p50 **969.05ms**, p95 **2375.23ms**, p99 **2595.59ms**.
- Mix: 1,000 catalogue operations, 400 inventory reads, 200 stock adjustments, 200 checkout/payment-replay operations, and 200 cross-company attack probes. Every operation also authenticates and checks its own company/warehouse snapshot.

The engine is **PGlite with a single PostgreSQL session**; concurrent client operations queue through that session. These percentiles describe this offline fixture only. They are not HTTP latency or production multi-connection capacity measurements. The report explicitly records `production_capacity_certified: false`. Its source hash covers application source, migrations, scripts, package/lock files, Next configuration and the designated deployment configuration.

## Reproduce and commission

```text
npm run lint
npm test
npm run test:tenant:e2e
npm run test:e2e
npm run test:load:offline
node scripts/saas-inventory.cjs
```

For production compilation, configure the actual host public settings and run `npm run build:saas`. The local verification build used dummy public keys and must not be uploaded as a credentialed release. The SaaS packager removes copied build dotenv files from the standalone artifact. Configure private runtime settings on the host; source environment files are not altered by packaging.

Hosted validation is prepared through `npm run test:load:hosted` with a separate staging database profile. It does not require a pre-existing hosted report or migration evidence file merely to run. See [SAAS-OPERATIONS.md](SAAS-OPERATIONS.md) for project-bound migration commands, scheduler commissioning, real payment/email/domain acceptance and backup/restore evidence. The existing-database migration evidence gate protects actual data changes.

**Production acceptance remains open:** hosted PostgreSQL/PostgREST role behavior, real Auth/Storage restoration, actual Paystack/subaccount and failure responses, SMTP, HTTPS/DNS, process restarts, scheduled execution, alert delivery and representative pooled/HTTP load. The wider master brief also has outstanding modules documented in [SAAS-IMPLEMENTATION.md](SAAS-IMPLEMENTATION.md); this report does not claim that the entire enterprise platform is complete.

The retained workload source hash identifies the historical offline snapshot and does not identify the later hosting changes. [Changed files](SAAS-CHANGES.md) lists the implementation paths.


## Offline synchronization follow-up — 18 November 2026

The new full regression initially passed 334 tests in 67 files. After adding the ordered-fulfilment case, the complete 19 November rerun passed all 335 tests in 67 files. Two Chrome acceptance scenarios passed actual service-worker cold reopening, encrypted storage, wrong-passphrase rejection, reconnect, lost-response replay, conflicts, safe cancellation, actor switching and mobile layout. TypeScript and lint passed. Local production webpack compilation passed; its standalone artifact is not distributable because the isolated node_modules junction caused tracing exclusions. Vercel publication of this change requires renewed device authorization. Migration 066 is installed, and a rollback-only actual Supabase probe verified stock replay, chained changes and company/warehouse isolation. No synthetic records were retained.

The owner explicitly approved and opened Starter: 14-day trial, five employees, 100 MB, with commerce. No prices or Paystack payments were enabled. The owner password is set and one MFA factor is verified. Desktop and Android build status is recorded in BIZHUB-APPS.md.
