# Email alerts and news validation

Implemented 2026-10-23. This is local implementation evidence, not deployment or inbox-delivery verification.

- Added separate admin alert/news workflows, restricted formatted content, draft persistence, recipient review, immutable submitted alerts, and authenticated news listing/detail/Home preview.
- Tested recipient eligibility, changed-review rejection, repeated-send idempotency, changed-address skipping, terminal status persistence, rejection retry, uncertain SMTP outcomes, restart recovery, restore cancellation, pagination, and login destination preservation.
- Production HTTP integration checks cover authentication, origin protection, draft privacy, publication/unpublication, SSR pages, unsafe content rejection, sending to isolated test recipients, and sent-content immutability. SMTP in these tests points exclusively to a closed loopback port.
- Browser verification used a fresh temporary database with fictional accounts and no production credentials. Confirmed caret and selected-text links, bold/list formatting, publication, reader views, recipient changes clearing send review, selected-recipient submission, and uncertain-delivery reporting.
- Inspected desktop and 390px mobile layouts. The mobile article had no horizontal overflow, and browser logs reported no warnings or errors.
- Independent review found an ambiguous `ECONNECTION` classification and a caret-link insertion defect. Both were reproduced and fixed. SMTP regression test failed before the fix and passed afterward; the browser went from zero clickable caret-inserted links to links in both editor and preview.

Operational choices: SMTP rejection and proven pre-send failures are retryable; other exceptions remain uncertain. A browser send action queues work and is labeled Submitted, while Sent is reserved for recipient SMTP acceptance. One application instance remains required. News publishing never sends email. No deployment or real email was performed.
