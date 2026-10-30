# ADR 0003: Expense category and review status
Status: Accepted · Date: 2026-10-30
## Context
For year-end tax reports every receipt needs an expense category, and
the user needs to see what is still to check versus what can be
reported, without any reporting, filtering or tax logic existing yet.
## Decision
`categories` is its own table (id, name, sort_order, active), seeded
at startup with `INSERT OR IGNORE`, same pattern as `apartments`. A
receipt belongs to at most one category (`category_id`, nullable).
`receipts` also gets a `status` column (`needs_review` or `approved`,
default `needs_review`). Changing either is a classification change,
not a data edit -- it never sets `edited_at` and never touches
`extracted_json`, `ai_result_json` or `created_at`; `PUT /receipts/{id}`
and reset never change category, status or apartment. Re-extracting a
receipt keeps its category and apartment but resets status to
`needs_review`, since the underlying data was just replaced. Setting
`approved` requires an apartment, a category, a valid ISO purchase date
and a total -- data-quality warnings do not block it, since the user
makes the final call. The ten seeded category names are PLACEHOLDERS
and must be confirmed with a tax advisor before being relied on for an
actual filing. Per-line-item categories, filters, reports, CSV export,
and tax/depreciation rules are out of scope here.
## Consequences
A receipt without a category or without an approved status is excluded
from nothing today -- the status is a gate the frontend and future
reporting can check, not an enforcement in this ticket. Categories can
be renamed or reordered later without a destructive migration, same as
apartments.
## Check
Same layering as ADR 0001/0002: `category_id`/`status` validation lives
in `api/routes.py`, the `categories` table and its queries in
`adapters/sqlite_repository.py`, and the `Category`/`ReceiptStatus`
models in `domain/models.py`.
