# ADR 0002: Apartments as a table, chosen on upload
Status: Accepted · Date: 2026-10-29
## Context
Receipts are kept for two holiday apartments, for year-end tax
reports. A receipt needs to be attributed to one of them.
## Decision
`apartments` is its own table (id, name, sort_order, active), seeded
at startup with `INSERT OR IGNORE`. A receipt belongs to at most one
apartment (`apartment_id`, nullable at the schema level but required
by the API at upload time). The apartment is chosen when a receipt is
uploaded and can be changed later; changing it is a classification
change, not a data edit -- it never sets `edited_at` and never touches
`extracted_json`, `ai_result_json` or `created_at`. All existing
receipts are test data with no apartment and get no special support.
Expense categories, a status field (e.g. reimbursed), and tax-year
reports are out of scope here and come later.
## Consequences
A receipt without a valid apartment can't be uploaded; the frontend
must offer the choice before the file picker does anything. Listing
and filtering by apartment later needs no new column, just a `WHERE`.
## Check
Same layering as ADR 0001: `apartment_id` validation lives in
`api/routes.py`, the `apartments` table and its queries in
`adapters/sqlite_repository.py`, and the `Apartment` model in
`domain/models.py`.
