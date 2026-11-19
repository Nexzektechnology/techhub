# Finance and bookkeeping

The local implementation extends the existing transaction graph with an immutable, balanced ledger. Migrations 065–068 add the chart, periods, source journals, supplier service bills, expenses, central customer collections, bank-statement matching and exact financial reports. Migration 067 posts trusted ecommerce confirmations to provider clearing. The existing provider verification remains authoritative.

## Accounting boundaries

- Integer kobo is used in postings; aggregate monetary report/export values are strings. CSV columns explicitly identify kobo.
- POS sales, payments and inspected returns post together with the operational transaction. Collections reduce receivables and do not recognize revenue again.
- Cash and bank exclude terminal/provider clearing until actual settlement. Opening inventory and existing POS debt are established once; historical revenue or cash is not invented.
- Verified opening stock credits opening equity. Goods received before an invoice credit goods received not invoiced. Physical count gains/losses use adjustment accounts. PO-linked invoicing and goods-receipt matching remain a later procurement workflow.
- Cost is recorded standard cost, not FIFO or weighted average. Unknown-cost sales and stock are disclosed. Configuration and cost changes retain history.
- Manual journals cannot bypass source control accounts. Posted manual entries, expenses and transfers are corrected by a linked reversal. Reconciled bank movements must first be unmatched with a reason.
- Service bills and partial/full supplier payments are implemented. Goods bills, supplier returns, credit notes, withholding and jurisdiction-specific tax certification remain pending.

## Reports and access

The finance workspace includes P&L, balance sheet, trial balance, book cash flow, exact source drill-down and current AR/AP aging. Dates filter accounting reports; live operational debt and aging remain current. Ledger and balance exports enforce financial read plus report access on the server. Ledger exports stop with an explicit error above 10,000 lines. Branch-scoped users cannot read another location or import company-wide bank statements.

Reconciliation accepts a bank-neutral CSV with exact signed NGN, stable bank row IDs, duplicate validation, exact direction/account/amount matches and immutable match history. This imports evidence supplied by staff; it is not a live bank connection or independent provider certification.

## Evidence

`tenant-ledger.test.ts`, `finance-operations.test.ts`, `online-accounting.test.ts` and `tenant-finance-api.test.ts` cover source consistency, deferred balance constraints, immutable journals, idempotency, period locks, roles, classifications, collections, reconciliation and exact amounts. Browser acceptance posts opening funds, expenses and a supplier bill/payment, matches a bank row and follows balances to source entries. Hosted migration, backup restoration and real provider settlement remain unverified external release requirements.
