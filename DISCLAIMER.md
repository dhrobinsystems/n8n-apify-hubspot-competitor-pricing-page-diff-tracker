# ⚠️ Disclaimer & Liability Limitation

**Use at your own risk.** The code, workflows, and scripts in this repository (**n8n-apify-hubspot-competitor-pricing-page-diff-tracker**) are provided for educational and architectural demonstration purposes.

**No Liability:** The author and dhRobin Systems accept no responsibility or liability for any direct, indirect, incidental, or consequential damages that result from using, misusing, or deploying these scripts. This includes, without limitation, lost revenue or margin from pricing decisions, Apify or HubSpot usage charges, API rate-limit penalties, blocked IP addresses or accounts, corrupted or overwritten CRM records, missed or false competitive alerts, and claims brought by third parties whose websites are scraped.

**No Warranty:** All software, n8n JSON blueprints, JavaScript modules, fixtures and documentation are provided "AS IS", without warranty of any kind, express or implied. This includes, but is not limited to, warranties of merchantability, fitness for a particular purpose, and non-infringement. Nothing here guarantees that a pricing page will be scraped correctly, that a detected change is real, complete or current, or that a page change will be detected at all. Pricing pages change layout, render client-side, vary by region, currency and A/B test, and may show different prices to automated visitors.

**Production Testing Required:** Always test thoroughly in an isolated staging environment, such as a HubSpot developer test account or sandbox, with `SANDBOX_MODE=true` and `DRY_RUN=true` enabled, before you connect live HubSpot or Apify credentials. Run the offline simulator (`node scripts/simulate-sandbox-run.js`) after every change to the workflow. Treat every detected pricing change as a lead that a person must check on the live competitor page before it is reported, used in sales enablement or relied on for a pricing decision. Review any snapshot flagged `requires_review` before marking it valid.

**Third-Party APIs & Compliance:** You alone are responsible for complying with the terms of service, rate limits, data privacy regulations (GDPR/CCPA) and security policies of Apify, HubSpot, Slack, and any connected services, and with the terms of use of every website you scrape. That includes:

- confirming that automated access to each competitor's pricing page is permitted by its terms of use and `robots.txt`, and stopping when it is not;
- keeping crawl frequency low (this workflow is designed for one page view per competitor per week) and never circumventing logins, paywalls, CAPTCHAs or other access controls;
- collecting only publicly displayed commercial pricing information, and never personal data such as names, emails or reviews of individuals;
- using the resulting intelligence only for independent business decisions. Do not use it to coordinate, signal or agree prices with competitors; competition and antitrust laws apply to how pricing information is used;
- restricting who can read the HubSpot custom object and the Slack alert channel, and reviewing every automatically created or updated record;
- rotating any token that is ever exposed in logs, screenshots, exports or version control.

**Not Legal or Financial Advice:** Nothing in this repository is legal, compliance or financial advice. Consult qualified counsel about scraping, data protection and competition law in your jurisdiction before you deploy.

**Synthetic Data Only:** All competitor names, domains, portal IDs, object IDs, actor IDs, run IDs and prices in this repository are fictional placeholders (for example "CompetitorAlpha Inc", portal `99000001`, record `comp_001`, `*.example.com`). Any resemblance to real companies or pricing is coincidental.

The full disclaimer is also referenced from README.md.

## License

Released under the MIT License. Copyright (c) 2026 DH Robin (dhRobin Systems). See [LICENSE](LICENSE).

---

Full text: DISCLAIMER.md · Licensed under the MIT License. License: MIT © 2026 DH Robin (dhRobin Systems) · Provided as-is, see the disclaimer.
