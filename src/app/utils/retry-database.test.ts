import assert from "node:assert/strict";
import test from "node:test";
import { retryIdempotentDatabaseOperation } from "./retry-database.js";

test("expiry operation recovers from the reported pg connection timeout", async () => {
  let attempts = 0;
  const result = await retryIdempotentDatabaseOperation(async () => {
    if (++attempts === 1) {
      throw new Error("Connection terminated due to connection timeout", {
        cause: new Error("Connection terminated unexpectedly"),
      });
    }
    return { expiredCount: 2 };
  }, 0);
  assert.equal(attempts, 2);
  assert.deepEqual(result, { expiredCount: 2 });
});

test("persistent network failure stops after three attempts", async () => {
  let attempts = 0;
  const error = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  await assert.rejects(retryIdempotentDatabaseOperation(async () => {
    attempts++;
    throw error;
  }, 0), (caught) => caught === error);
  assert.equal(attempts, 3);
});

test("database constraint and validation errors are not retried", async () => {
  for (const code of ["P2002", "P2003", "P2025"]) {
    let attempts = 0;
    const error = Object.assign(new Error("Invalid operation"), { code });
    await assert.rejects(retryIdempotentDatabaseOperation(async () => {
      attempts++;
      throw error;
    }, 0), (caught) => caught === error);
    assert.equal(attempts, 1);
  }
});

test("connection errors wrapped in a cause are retried", async () => {
  let attempts = 0;
  await retryIdempotentDatabaseOperation(async () => {
    if (++attempts === 1) {
      throw new Error("Adapter error", {
        cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
      });
    }
  }, 0);
  assert.equal(attempts, 2);
});
