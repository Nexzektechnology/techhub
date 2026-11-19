# BizHub deployment status — 19 November 2026

The core commerce release is live at [nexzekbizhub.vercel.app](https://nexzekbizhub.vercel.app). The [online user manual](https://nexzekbizhub.vercel.app/manual) includes business setup, stock, employee permissions, billing and domain instructions.

## Connected services

- Vercel: nexzektechnology/nexzekbizhub, Node 24, Next.js 16.4.6, build:saas. Final production deployment dpl_FTBes3PmHtkuHRxiCt91XKb9uibS (source 1822093) passed installation, compilation, TypeScript and route generation.
- Supabase: iipbmwpigedfslqybxmg. The initial catalog and Auth identity store were empty. All 62 original/core migrations committed atomically. Additive hosted Auth compatibility migration 064 and offline commerce migration 066 bring the installed ledger to 64 exact-checksum files. Separate Business OS migrations are excluded; their overlapping version numbers must be resolved before integration.
- GitHub: Nexzektechnology/techhub main received the core source. Hosting fixes and the updated manual were pushed as 1822093. Vercel could not connect its GitHub integration to the repository; CLI deployments work, but push-triggered deployment still needs the Vercel GitHub app authorized for this repository.
- The confirmed owner identity has separate platform authorization, a password and one verified MFA factor. Privileged platform operations require MFA. No legacy commerce administrator privilege was granted to that identity.
- Supabase Auth uses the canonical production origin and a narrow callback allowlist. Email confirmation and TOTP remain enabled.
- Twelve host environment variables were configured privately. No dotenv file or server credential was uploaded as source.

## Hosted verification

- Public home, manual, sign-in and start pages returned HTTP 200. Unauthenticated worker and platform-health requests returned 401.
- Mobile home, manual and sign-in pages passed at 390px with no horizontal overflow or page errors; screenshots are retained privately.
- Actual PostgreSQL probes passed company isolation, successful/rejected RPC context restoration and warehouse-scoped permissions. Synthetic users/companies/locations rolled back.
- Every public table has RLS. Foreign keys are validated. Legacy routine integrity violations: zero. Browser roles cannot access private tenant/identity implementations or Vault secrets.
- An authenticated worker call returned HTTP 200, processed zero charges and explicitly reported automatic billing paused. The Supabase Cron job runs every five minutes, with its credential in Vault. Its pg_net commissioning request returned 200 and recorded a worker heartbeat. No Paystack key, authorization, charge job, invoice or order existed during this test.
- The full regression passed 324 tests in 64 files before the hosted Auth adaptation. The final complete rerun passed 327 tests in 65 files with managed Auth access removed from private roles. The identity adaptation and installer tests passed separately; scheduler/runtime tests passed 14 checks.
- The current production dependency audit reports zero advisories. Development-tooling warnings remain separate.

## Service commissioning still required

The owner approved and published Starter as a 14-day trial with five employees, 100 MB storage and commerce. Production email delivery still needs a configured SMTP sender. Paid checkout and subscription renewals need the correct Paystack credentials, published prices, verified settlement accounts and provider acceptance. The scheduler remains payment-paused until that configuration exists. Do not reuse another deployment's payment credentials.

## Offline update and app delivery

The offline commerce update and app-download links are on GitHub main at b1452ea. They are not yet live on Vercel. The prepared production source upload is isolated from the root E-Edge project. Vercel CLI credential refresh reached an additional email identity check for the existing account; publication awaits that one-time verification. Never commit account tokens or use an expired device code.

Encrypted offline storage, cold reopening, reconnect, lost-response replay, conflict review, safe cancellation and actor isolation passed local Chrome acceptance. Migration 066 passed a rollback-only actual Supabase probe. Synchronization requires the app to be open, unlocked and connected; native device acceptance remains open.

Windows and signed Android assets were successfully published in GitHub release [bizhub-v1.0.0](https://github.com/Nexzektechnology/techhub/releases/tag/bizhub-v1.0.0). Build and signature evidence, installation instructions and limitations are in BIZHUB-APPS.md.

The additional Business OS work was backed up as d106701 on [codex/business-os-snapshot-20261119](https://github.com/Nexzektechnology/techhub/tree/codex/business-os-snapshot-20261119). That snapshot is separate from the tested production release and has not been applied to Supabase or deployed. Continuing local inventory changes are not automatically included in that snapshot.

The requested nexzekbizhub.com and example wenlas.com returned no public DNS answers during inspection. Neither domain was bought, delegated or connected. Domain routing remains disabled until DNS and HTTPS are commissioned. Businesses can use central /store/<slug> paths meanwhile.

The backup inventory currently lists no physical backups and PITR is disabled. A local logical schema export could not run because the required Docker tooling is unavailable; no successful hosted backup or restore is claimed. Hosted capacity/load and full Supabase Auth/Storage backup-restoration acceptance remain open. The final offline workload passed for 100 companies, 1,000 users and 2,000 operations with zero failures; it does not certify production capacity. The broader enterprise modules listed in SAAS-IMPLEMENTATION.md are outside this deployed core release.

The root .vercel/project.json still points to the earlier edgedirect2u deployment. It was preserved. Deploy only from an explicitly linked, isolated BizHub release.
