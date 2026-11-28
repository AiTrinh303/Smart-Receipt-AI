# ADR 0005: The yearly report always counts every saved receipt
Status: Accepted · Date: 2026-11-28

## Context

`GET /reports/yearly` (and its CSV/ZIP exports) takes a `basis` parameter:
`all` (the default — every saved receipt with a valid date, total,
currency and apartment counts) or `approved` (only receipts marked
"Approved"). The Report page offered this as a checkbox, "Only count
receipts I approved", unchecked by default and written to the URL as
`basis=approved` when checked.

The owner does not review every receipt before the tax declaration is
due, and the approved-only totals were never the numbers sent to the tax
advisor. The checkbox added a second set of wording ("not approved",
"No approved receipts in <year>.", "approved receipts only") and a second
code path through the page, the export note and the export links, for a
view nobody used. What is still unreviewed is already shown in the
export card's note ("N not reviewed", with a "Review them" link).

## Decision

The frontend always uses the default basis, `all`:

- The checkbox is removed. `getYearlyReport()` and the export URL
  builders (`reportExportCsvUrl`/`reportExportZipUrl`) no longer accept or
  send `basis`.
- A `basis` param in the page URL (e.g. an old bookmark with
  `basis=approved`) is ignored and dropped from the address bar with
  `replaceState`.
- Every approved-only text and branch is removed: the description is
  always "Spending per apartment, from every saved receipt.", an empty
  apartment says "No receipts in <year>.", the export note counts
  `counted_unreviewed` ("N not reviewed") and never reads
  `excluded.not_approved`, and the text next to the export links is
  "<year>, all receipts".

**The backend is unchanged.** `basis=approved` still works on
`GET /reports/yearly` and the exports, the response still carries
`basis` and `excluded.not_approved`, and the frontend types still
describe them (`ReportBasis`, `ReportExcludedCounts`) — nothing on the
frontend reads them.

## Consequences

- One set of numbers on the page, in the export and in the summary
  cards; the monthly table's Total row (taken from the summary) always
  matches them.
- Reviving an approved-only view means adding a control back in the
  frontend only (the backend support is still there); read this ADR
  first.
