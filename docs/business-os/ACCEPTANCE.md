# Acceptance coverage

This file distinguishes working repository workflows from the full requested platform. Hosted acceptance remains pending. An existing flagship workflow is not evidence of tenant availability.

| Requested workflow | Evidence / release boundary |
|---|---|
| 1. Product creation | Existing tenant database and browser product creation/edit retained; new product master covered in `business-os.test.ts` and offline browser acceptance. |
| 2. Purchase order | Existing table; complete tenant lifecycle pending phase 6. |
| 3. Goods received | Manual verified keyed stock adjustment works; PO-linked goods receipts pending phase 6. |
| 4. Stock increase | Keyed command, one receipt/movement on replay, exact warehouse and aggregate quantities covered. |
| 5. Cash sale | Tenant cash/change/split-tender sale, source journal and browser checkout covered; flagship tests retained. |
| 6. Credit sale | Tenant credit limits/terms, partial tender, receivable and immutable source journal covered. |
| 7. Partial customer payment | POS and central finance partial collections allocate debt without revenue again; keyed retries covered. |
| 8. Full customer payment | Full tenant credit settlement and trusted ecommerce confirmation covered locally. |
| 9. Affiliate release | Independently approved, confirmed handover; stock/reservation/ownership accounting covered in affiliate custody tests. |
| 10. Affiliate acknowledgement | Verified-email recipient acknowledgement and explicit staff attestation covered locally. |
| 11. Affiliate partial sale | Recipient declaration plus staff-verified partial sale; correct consignment/wholesale ownership and commission covered. |
| 12. Affiliate remittance | Actual confirmed gross remittance, safe replay and separate commission payment/credit refund covered. |
| 13. Affiliate stock return | Declaration leaves custody unchanged; partial physical inspection, resellable acceptance and damage covered. |
| 14. Stock transfer | Pending controlled dispatch/receive/approval workflow. |
| 15. Inventory adjustment | Keyed positive/negative adjustment, reservation protection, scope and immutable movement evidence covered. |
| 16. Customer return | Tenant POS inspected partial return, tax/cost reversal and refund covered; flagship retained. |
| 17. Supplier payment | Service bills and partial/full supplier payments with AP journal covered; goods procurement still pending. |
| 18. Expense recording | Expense posting, source evidence and linked reversal covered locally. |
| 19. Journal balancing | Double-entry source posting plus independent deferred balance constraint, immutability and period locks covered. |
| 20. Bank reconciliation | Statement CSV import, duplicate evidence, exact source matching and audited unmatch covered; live bank feeds/settlements pending. |
| 21. Branch reporting | Stock and exact financial reports enforce authorized location scope; broader executive analytics pending. |
| 22. Tenant isolation | Hostile read/write/FK/direct-browser/forged-context tests, plus original commerce RLS tests. |
| 23. Role authorization | Company-level directory/master grants; assigned-warehouse stock; revocation and stale-replay checks. |
| 24. Offline transaction sync | Mounted POS cash sales persist encrypted in IndexedDB and replay unchanged keys, including lost committed responses; conflict review covered. Offline cold start remains pending. |
| 25. Duplicate payments | Original trusted provider confirmation/replay tests retained; new stock/master receipt replay tested independently. |
| 26. Notification delivery | Existing billing notifications retained; general workflow/email/SMS delivery pending. |
| 27. Failed payment handling | Original payment tests retained; provider abstraction and broader tenant payment operations pending. |
| 28. Audit integrity | Immutable keyed receipts, movements, financial journals, payment/return/custody events and bank-match history covered locally. |

New HTTP tests cover authentication, origin checks, malformed input, unknown fields, body bounds, company resolution, rate-limit failures, no-store headers and branch/search pagination. Database tests also cover tenant-local identifier uniqueness, customer editing, supplier reuse, cost isolation, literal search and pagination counts. Browser tests use the real app, PostgreSQL and role enforcement with loopback-only identity/payment simulators; these do not establish hosted Auth/PostgREST/provider behavior or concurrent production capacity.
