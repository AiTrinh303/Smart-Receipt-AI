# ADR 0004: Remove expense categories
Status: Accepted · Date: 2026-11-03

## Context

ADR 0003 added an expense-category classification (`categories` table,
`receipts.category_id`, `GET /categories`, `PUT /receipts/{id}/category`,
plus the matching frontend select and history filter) alongside review
status. The user decided they do not want to categorize receipts at all --
the ten seeded category names were always PLACEHOLDERS pending a tax
advisor's input, and that confirmation never came. Review status
(`needs_review`/`approved`) stays; it tracks a human workflow decision, not
a tax classification, and is unaffected by this change.

## Decision

Remove every piece of the category feature from the application code:
the `Category` domain model, `DEFAULT_CATEGORIES`, the
`list_categories`/`get_category`/`set_receipt_category` repository methods,
`category_id`/`category_name` from every receipt-shaped response
(`SavedReceipt`, `ReceiptSummary`, `LineItemRow`), `GET /categories`,
`PUT /receipts/{id}/category`, the `category_id` filter on `GET /receipts`
and `GET /items`, and the matching frontend (`useCategories`,
`getCategories.ts`, `updateReceiptCategory.ts`, the category `<select>` on
a saved receipt, and the history view's Category filter and badge).
`ReceiptClassification.tsx` is renamed to `ReceiptReviewStatus.tsx` --
mechanical only -- since it now holds just the status control.

Approving a receipt (`PUT /receipts/{id}/status` with `"approved"`) now
requires only: `apartment_id` not null, a valid ISO `purchase_date`, and
`total` not null. A receipt already `approved` under the old, four-field
rule stays `approved` -- approval is never re-checked or revoked by this
change, only the rule for *future* approvals changes.

**Existing data is kept, dormant, never migrated.** The `receipts.
category_id` column and the `categories` table (with whatever rows and
values they already hold) are left exactly as they are in any database
that already has them -- no `ALTER TABLE ... DROP COLUMN`, no `DROP TABLE`,
no data rewrite. The application code simply stops reading, writing,
creating, seeding, or migrating them:
- The additive-migration step that used to add `receipts.category_id` to
  an old database is removed -- a database that doesn't have the column
  yet (predating even ADR 0003) simply never gets it, which is fine since
  nothing reads it anymore either way.
- `_create_schema()` no longer creates or seeds the `categories` table at
  all, so a **brand-new** database never has that table or column.
- `save_receipt`'s `INSERT` no longer mentions `category_id` in its column
  list; on a database that still has the column, this leaves it `NULL` on
  a fresh insert (its only path for a previously-unseen `receipt_id`) and
  completely untouched on a re-extract (`ON CONFLICT`), exactly like
  `apartment_id` was already handled by the pre-0004 code before category
  support existed.
- A query parameter the frontend might still send in a stale bookmark or
  cached page (`?category=...` on the history URL, `?category_id=...` on
  `GET /receipts`/`GET /items`) is simply an unrecognized parameter now --
  FastAPI ignores query parameters it wasn't told to expect, so these
  produce no error and have no filtering effect, rather than a `422`.

This was verified directly: a test (`tests/
test_remove_categories_migration.py`) hand-builds a database under the old
schema -- `categories` table with rows, a receipt with `category_id` set
and `status='approved'` -- opens it with the current
`SqliteReceiptRepository`, and exercises list/get/edit/approve/re-extract
through the real API, then re-reads the `categories` table and the
receipt's `category_id` column directly with `sqlite3` to confirm neither
changed at all. A second test confirms a brand-new database has no
`categories` table and no `category_id` column.

## How to reintroduce it later

Nothing here is destroyed. To bring expense categories back:
1. Restore the `Category` model, `DEFAULT_CATEGORIES`, and the three
   repository methods in `adapters/sqlite_repository.py` (git history has
   the exact pre-removal code).
2. Re-add the `categories` table creation/seeding to `_create_schema()` --
   existing databases that still have the table and rows from before this
   ADR need no backfill; a database created after this ADR (with no table)
   gets one seeded fresh, same as any other additive migration.
3. Re-add `category_id` to `SavedReceipt`/`ReceiptSummary`/`LineItemRow`
   and the two endpoints (`GET /categories`, `PUT /receipts/{id}/category`),
   and decide fresh whether approval should require a category again (the
   seeded category names still need a tax advisor's confirmation before
   being relied on for an actual filing -- that was true before this ADR
   and remains true now).
4. Re-add the frontend `useCategories` hook, the category `<select>` on
   `ReceiptReviewStatus.tsx` (or split it back into its own component), and
   the history view's Category filter/badge.
