-- Preserve existing purchases while renaming the PostgreSQL enum value.
ALTER TYPE "GroupPurchaseFlow" RENAME VALUE 'BUY_NOW_BOOK_NOW' TO 'DIRECT_BOOK';
