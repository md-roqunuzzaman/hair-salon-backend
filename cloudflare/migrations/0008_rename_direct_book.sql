-- SQLite stores the enum as text. Historical migration checksums stay unchanged.
UPDATE "GroupPurchase" SET "purchaseFlow" = 'DIRECT_BOOK'
WHERE "purchaseFlow" = 'BUY_NOW_BOOK_NOW';
