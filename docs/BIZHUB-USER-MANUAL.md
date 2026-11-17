# Nexzek BizHub user manual

Updated 18 November 2026. Open [Nexzek BizHub](https://nexzekbizhub.vercel.app) or the [online manual](https://nexzekbizhub.vercel.app/manual). The app and Supabase database are hosted. Public registration needs a published plan and production email delivery; paid checkout needs Paystack commissioning. Custom domains and shared subdomains need their DNS/HTTPS setup.

## First platform owner setup

Finish the private account setup, choose your password, then open [Platform security](https://nexzekbizhub.vercel.app/platform/security) and enroll your authenticator. In **Platform billing**, review plans, publish approved prices and enable the plan you want businesses to select. Configure production email delivery before inviting outside users.

## Getting started

1. Open the central BizHub app and choose **Create your business**.
2. Create an account and confirm the email verification link.
3. Enter the company name, contact information, business category and company URL name.
4. Choose the available plan. Prices and trial periods are configured by the platform operator.
5. Use **My workspaces** to open the company. Choose the company URL name carefully: `nex` produces `nex.nexzekbizhub.com` once the platform domain is connected. Reserved names such as `app`, `www`, `api` and `admin` are not issued as business subdomains.

An explicitly labelled preview has account registration and payments closed until its services are connected.

## Products, locations and stock

Open **Commerce & inventory** from your company workspace.

1. In **Locations**, create a branch and a warehouse within it.
2. In **Products**, add a category, then create the product. Enter its price in naira, a suitable image URL and a description. Add options such as Size if needed.
3. Use **Edit product** to change details or publishing status.
4. In **Inventory**, choose the product and warehouse, enter a positive quantity to receive stock and give a reason. A negative quantity records a correction.
5. Review on-hand, reserved and available stock. Creating a product does not receive stock, and stock cannot be reduced below the amount already reserved.

## Employees and permissions

Invite the employee in the company's **Team** area first. They must confirm their account.

In **Commerce & inventory > Permissions**, create a role and assign it to the employee with company, branch or warehouse scope. Include `inventory.read` with `inventory.adjust`, and `catalogue.read` with `catalogue.edit`. Use **Revoke** when access is no longer needed. Staff should use individual accounts rather than the administrator's password.

Company administrators have company-wide authority. Other staff need explicit commerce permissions. A warehouse assignment does not grant stock access to other warehouses.

## Branding and publishing the store

Use **Branding** to draft and publish the company name, colours, approved font and logo. Previous published versions can be restored. For a logo upload, use **Account & billing > Private company files > Logos**, then **Use as company logo**. Publishing that selected logo intentionally makes it public; unrelated documents remain private.

In **Commerce & inventory > Storefront**, select the fulfilment warehouse, set the delivery fee and publish. The operator must verify and link the company's payment settlement subaccount before checkout opens. Only stock available in the chosen fulfilment warehouse is offered to shoppers.

## Orders and payments

Customers browse the business store, select options and fill their bag. On a business domain, **Continue to secure checkout** brings public product choices into the central BizHub checkout and checks current prices again. Passwords, card details and shipping addresses are not transferred from the store domain.

The customer signs in, enters delivery information and proceeds to the payment provider. Stock is reserved for 30 minutes. The app independently checks the payment reference, amount, currency and settlement recipient; a return-page visit alone does not confirm payment.

Staff review paid orders in **Orders**, mark eligible orders **Ready for dispatch**, then **Confirm delivered** as fulfilment progresses. Customers should keep their confirmation URL. If a payment is uncertain, verify the original reference before attempting another charge. Late or ambiguous payments need reconciliation.

## Billing and private files

**Account & billing** shows the plan, period end, employee/storage usage and invoice history. Choose a published plan/cycle for a new payment. Automatic renewal is optional and requires explicit authorization plus an eligible reusable payment method. **Turn off automatic renewal** stops future unsent charges; an already submitted charge still needs reconciliation. Cancellation takes effect at the current period end.

Operational writes may become read-only after expiry; records are retained. Supported private uploads are PNG, JPEG, WebP and PDF within the plan's allowance. Downloads use time-limited links.

## Using a BizHub subdomain

Example: **`nex.nexzekbizhub.com`**.

- Choose `nex` as the business URL name during registration.
- The platform operator connects `nexzekbizhub.com` and `*.nexzekbizhub.com` to the Vercel project once.
- A customer does not need to buy a separate domain or edit DNS for their assigned BizHub subdomain.
- Review **Your business address** in account settings and publish the store.
- Unknown, reserved or inactive subdomains do not open a different company's store.

The platform domain's DNS and wildcard HTTPS certificate must be ready before these addresses work. Company URL labels stay assigned to their companies.

## Connecting wenlas.com

The following is an example for a business that owns `wenlas.com`; it is not a claim that this domain is currently connected.

1. Create the company and publish its store.
2. In **Account & billing > Your domains**, add `wenlas.com` without `https://` or a path.
3. Copy the app's TXT challenge. At the domain's DNS provider, add a TXT record named `_saas-verification` with the exact `saas-verification=...` value shown by the app. Providers that require full names use `_saas-verification.wenlas.com`.
4. Wait for DNS updates, then choose **Verify DNS**. Keep the record for future ownership checks.
5. The platform operator adds `wenlas.com` to the same Vercel project's **Settings > Domains** and supplies the exact website A/CNAME values Vercel requests.
6. Add those website records at the customer's DNS provider. Add Vercel's separate ownership TXT record if requested.
7. After Vercel reports valid DNS and HTTPS, the operator activates the domain in **Platform billing > Domain commissioning**.
8. Open `https://wenlas.com`: customers shop under that domain; staff sign-in and secure checkout use the central app. Reverify ownership before its displayed expiry date.

Do not change email MX, SPF, DKIM or DMARC records simply to connect the website. `www.wenlas.com` is a separate hostname; configure it in Vercel or give it an HTTPS redirect to the primary domain.

## Platform operator: nexzekbizhub.com DNS

Add the apex domain and `*.nexzekbizhub.com` to the same Vercel project. Use the actual values shown by that project.

For wildcard HTTPS, Vercel needs DNS challenge access. You can move the domain to Vercel nameservers **after preserving every existing DNS record**, or keep the existing DNS provider and delegate `_acme-challenge` to both Vercel nameservers. The latter also needs the wildcard website CNAME; certificate validation and website routing are different records.

After DNS/HTTPS are valid, configure the central HTTPS app URL, matching Supabase Auth redirects, `SAAS_TENANT_ROOT_DOMAIN=nexzekbizhub.com` and domain routing. Keep staff authentication and checkout on the central app; do not share parent-domain session cookies across businesses.

Use a verified platform administrator with MFA for company suspension, plans, prices, settlement accounts and domain activation. The hosted worker is scheduled every five minutes through Supabase Cron, using Vault for its private credential. Monitor its heartbeat in platform health. Automatic payments remain paused until Paystack and billing are commissioned.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Domain unavailable | Correct company mapping, current ownership verification, active HTTPS and a published store. |
| Empty store | Published products, images and available stock in the fulfilment warehouse. |
| Staff see no stock | Active membership, permission role and exact branch/warehouse assignment. |
| Checkout unavailable | Subscription write access, active location, published store and verified settlement account. |
| Uncertain payment | Verify the same reference; inspect reconciliation jobs before another attempt. |
| Email link fails | Latest link, central Auth redirect configuration and email provider setup. |

New-tenant POS, advanced procurement/transfers, tenant refunds/reports, customer history and other enterprise additions remain tracked separately. Do not assume every legacy module is enabled for new businesses.

## Current provider references

- [Vercel domain and wildcard DNS setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel multi-tenant domain configuration](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains)
- [Vercel cron scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

The in-app guide is available at [the online manual](https://nexzekbizhub.vercel.app/manual), with a **Print or save as PDF** button.
