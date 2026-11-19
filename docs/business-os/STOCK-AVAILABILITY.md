# Stock availability and evidence

The existing tenant model stores one `tenant_inventory` row per company, warehouse and product. `on_hand` is physical stock remaining in that warehouse. `reserved` is physical stock already allocated to active ecommerce reservations. Database constraints enforce `0 <= reserved <= on_hand`.

**Available to sell = on_hand − reserved.** Consolidated quantities sum only warehouses the actor can read, optionally restricted to the selected branch. Product master reorder points apply independently to each warehouse's available quantity. These are threshold alerts, not predictions or purchase recommendations.

Checkout reserves units, trusted payment confirmation consumes both on-hand and reserved quantities, and expiry releases reserved units without adding physical units. A stock adjustment changes on-hand stock only and must leave at least the reserved quantity. Product locks serialize these changes with existing checkout/payment routines. A negative adjustment records a reduction with its reason; it is not a damaged-stock or quarantine subledger.

Existing movement records include reservation-release events. Migration 063 labels known order-expiry records `reservation_release`, and a trigger classifies future expiry inserts. The business workspace displays them as reserved units released rather than physical receipts. Other existing tenant movement records represent physical adjustments or verified paid sales. Never derive physical inventory by summing every historical `quantity`; use the authoritative inventory and reservation rows.

Affiliate/customer custody, committed-order distinctions beyond current reservations, in-transit stock, damaged/quarantined stock, inspection queues and serial/batch balances do not exist in this foundation release. No zero balances for those categories are fabricated, and none are added to availability. Their subsequent phases must define dispatch, acknowledgement, custody, return inspection and availability transitions before those figures are displayed.

The new business command receives a client-generated UUID, locks that tenant/key, validates actor/location and payload, updates stock and writes a movement plus immutable receipt in the same transaction. Identical retries from the same still-authorized actor return the original result. Changed data, action or actor with the same key is rejected. Failed commands leave neither a receipt nor a movement. The current form retains this key during a mounted-page retry; this is not an offline durable queue or cross-device recovery feature.

New-tenant movements and command receipts reject UPDATE and DELETE. Corrections are new authorized compensating movements with a reason. Existing flagship mutation behavior is retained. Existing low-level unkeyed commerce RPCs remain for compatibility with established integrations; the current receiving UI now uses the keyed business endpoint. Retiring that legacy mutation path requires a separately tested client migration. Therefore platform-wide financial idempotency is not claimed.

Product unit cost is a current master reference only. Changing it neither revalues existing stock nor posts cost of sales. Historical cost layers, serial costs, double-entry journals, financial valuation, actual profit and margin protection remain later work.
