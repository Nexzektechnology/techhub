# Affiliate accountability and stock custody

Migration 069 introduces company-scoped partner records, independently approved release requests, physical handovers, recipient acknowledgements, sale/return declarations, verified partial sales, actual remittances, earned/paid commission, inspected returns, missing stock and interbranch receipt. The command receipt, immutable event, movement and journal commit together. Repeating the same actor/key/payload does not repeat the event.

The company workspace and mobile recipient portal use `/company/[slug]/affiliates`. A recipient signs in with the verified email configured on the partner record. Server checks limit recipients to their own releases and declarations; recipients do not receive unit costs or company finance access. Partner declarations require staff verification before they become sales or accepted stock returns. A staff-recorded acknowledgement is explicitly labelled an attestation rather than recipient authentication.

## Ownership and balances

- Consignment, field-agent and representative allocations remain company-owned inventory in custody. Handover removes available warehouse units without recording cash or revenue. Verified sales create affiliate receivables, revenue, COGS and earned commission.
- Wholesale credit recognizes revenue and receivable at physical release. Subsequent sell-through does not record revenue again. Accepted unsold returns create credits; actual refunds settle an overpaid credit balance explicitly.
- Temporary custody authorizes no sales. Interbranch custody moves units through transit and a verified destination receipt without recording revenue or money.
- Declaring a return does not change warehouse stock. Only physical inspection restores resellable units. Damaged units stay excluded, with their recorded cost written off where company ownership remains.
- Statements distinguish goods in custody, sold goods, remittances, credit balances, commission, accepted returns, damage and missing stock. Gross remittance and commission payment are separate recorded events. Configured tax/version is snapshotted with approved terms, partial sales and wholesale return tax use exact cumulative rounding, and changed tax configuration blocks stale handovers. Commission is calculated on the agreed amount before tax.

## Remaining scope

Serialized-unit/IMEI provenance, multi-product release documents, jurisdiction-specific tax classification/certification, recipient onboarding notifications, electronic signature capture, automated reminders, loss-recovery agreements, advance deposits and production concurrency/load validation remain pending. Existing platform stock allocation is preserved rather than silently migrated into this ledger. The enhanced tenant executor still deliberately refuses flagship writes until a safe commissioning/backfill path exists.

## Evidence

`affiliate-custody.test.ts` verifies independent approval, protected inventory, no consignment release revenue, partial sale and earned commission, retry-safe remittance, recipient cost/access isolation, declared-versus-inspected returns, damage, wholesale credit refunds and interbranch receipt. HTTP tests verify strict input, trusted origin, server company resolution, verification and actual-payment confirmation. Browser acceptance exercises company, independent manager and mobile recipient sessions against isolated local PostgreSQL and identity fixtures. These checks do not certify hosted or external services.
