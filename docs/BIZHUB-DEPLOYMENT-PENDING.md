# BizHub deployment checkpoint — 17 November 2026

Requested targets: Vercel account `nexzektechnology`, GitHub `Nexzektechnology/techhub`, and Supabase project `iipbmwpigedfslqybxmg`. A new Vercel deployment has not been created.

## Confirmed Supabase access

The supplied publishable and server-only application keys were saved in ignored `.env.saas.local`. Both were accepted by the designated project's APIs. The authenticated REST schema exposes zero application resources: the company table, tenant checkout and assigned-subdomain functions are absent. This is a read-only observation, not a complete database inventory. No hosted SQL, Auth configuration, Storage changes or business data migration has been applied.

Application API keys do not authorize database DDL through the Management API. Its separate account token is still absent. The Vercel account-token field is also empty, and the CLI remains signed out. Previously issued device codes have expired. GitHub's non-interactive push check failed because no authenticated GitHub credentials are available.

## Prepared release

- Company commerce isolation, scoped warehouse permissions, public storefronts, subscription billing and migrations 049–062 are in source. Original migrations 001–048 remain unchanged.
- Assigned subdomains and verified custom domains serve a company's public store. Private routes and cross-company paths are rejected. Sign-in and checkout remain on the central app; cart transfer rechecks current company prices.
- The BizHub home page and account shell have their own branding. The online manual is at `/manual`; the readable copy is `BIZHUB-USER-MANUAL.md`.
- The repository's Vercel build command now selects `build:saas`. Its preflight pins the designated Supabase project and requires the BizHub platform profile. A setup preview cannot pass runtime readiness checks.
- `npm run prepare:saas:release` creates a separate source directory, omitting private dotenv files and the earlier `.vercel` link, and checks source bytes against known private credential values.
- `npm run db:saas:bundle` generates an ignored first-install SQL bundle. It wraps all 62 migrations and their exact checksums in one transaction and refuses an existing public schema or prior application ledger. It was tested for successful installation, replay refusal and preserving an untracked existing record. It has not run on Supabase.

## Verification

The full SQL/API/business run passed 321 tests in 63 files. Two additional first-install safety tests passed, and the 11 runtime/configuration tests passed again. The existing browser suite passed all 32 scenarios. Domain/cart handoff and mobile home/manual checks passed; consult the current verification report for the final combined tenant run.

Next.js 16.4.6 production compilation, TypeScript, route generation and standalone packaging passed with synthetic credentials and external network requests blocked. The previous 100-company workload report predates the new domain changes; it does not certify hosted capacity.

## Continue deployment

Account authorization remains necessary. A temporary loopback setup helper can privately verify and save Vercel/Supabase account tokens; neither it nor its values belongs in Git or a deployment. It is not part of the customer application.

After authorization: inspect the designated database catalog and migration history; use the guarded first-install path only for a genuinely new schema, or reconcile/restore existing data before normal migration. Create and explicitly link a separate BizHub Vercel project. Configure real host environment values, Supabase Auth redirects and the intended platform administrator. Publish and inspect the actual returned URL. Then commission DNS/TLS, provider payments, authenticated scheduling, monitoring and hosted acceptance.

The root `.vercel/project.json` still points to the previous **edgedirect2u** project. Preserve that deployment. Use the isolated release directory and an explicitly verified new project; never deploy unqualified from the old link.
