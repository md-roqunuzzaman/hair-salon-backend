-- Optional coordinates preserve existing branches without inventing a location.
ALTER TABLE "Branch" ADD COLUMN "latitude" REAL;
ALTER TABLE "Branch" ADD COLUMN "longitude" REAL;
