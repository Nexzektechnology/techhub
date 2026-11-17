# BizHub deployment status — 18 November 2026

The core commerce release is live at [nexzekbizhub.vercel.app](https://nexzekbizhub.vercel.app). The [online user manual](https://nexzekbizhub.vercel.app/manual) includes business setup, stock, employee permissions, billing and domain instructions.

## Connected services

- Vercel: nexzektechnology/nexzekbizhub, Node 24, Next.js 16.4.6, build:saas. Production deployment dpl_2WNkry2jB4u8mkKi8sUkq7VCbwpp passed installation, compilation, TypeScript and route generation.
- Supabase: iipbmwpigedfslqybxmg. The initial catalog and Auth identity store were empty. All 62 original/core migrations committed atomically; the additive hosted Auth compatibility migration 064 brings the installed ledger to 63 files. Version 063 is reserved for separate, unreviewed Business OS work and is excluded from this release.
- GitHub: Nexzektechnology/techhub main received the core source. Hosting compatibility fixes are maintained in the isolated codex/bizhub-hosting-fix checkout; see Git history for the final pushed revision.
- The confirmed owner identity has separate platform authorization. The owner must set a password and enroll an authenticator; privileged platform operations require MFA. No legacy commerce administrator privilege was granted to that identity.
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

Public signup needs a published plan and a production SMTP sender. Paid checkout and subscription renewals need the correct Paystack credentials, published prices, verified settlement accounts and provider acceptance. The scheduler remains payment-paused until that configuration exists. Do not reuse another deployment's payment credentials.

The requested nexzekbizhub.com and example wenlas.com returned no public DNS answers during inspection. Neither domain was bought, delegated or connected. Domain routing remains disabled until DNS and HTTPS are commissioned. Businesses can use central /store/<slug> paths meanwhile.

Hosted capacity/load and full Supabase Auth/Storage backup-restoration acceptance remain open. Offline workload results do not certify production capacity. The broader enterprise modules listed in SAAS-IMPLEMENTATION.md are outside this deployed core release.

The root .vercel/project.json still points to the earlier edgedirect2u deployment. It was preserved. Deploy only from an explicitly linked, isolated BizHub release.
