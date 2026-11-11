import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../../generated/prisma/client.js";
import { generateAvailableOrderNumber, retryOrderNumberTransaction } from "./generateOrderNumber.js";

for (const occupiedModel of ["appointment", "groupPurchase", "payment"] as const) {
  test(`order numbers avoid existing ${occupiedModel} numbers`, async () => {
    let occupied: string | undefined;
    const checked: Record<string, string[]> = { appointment: [], groupPurchase: [], payment: [] };
    const tx = Object.fromEntries(Object.keys(checked).map(model => [model, {
      findUnique: async ({ where }: { where: { orderNumber: string } }) => {
        checked[model].push(where.orderNumber);
        if (model === occupiedModel) occupied ??= where.orderNumber;
        return model === occupiedModel && where.orderNumber === occupied ? { id: "existing-order" } : null;
      },
    }])) as unknown as Prisma.TransactionClient;
    const number = await generateAvailableOrderNumber(tx);
    assert.notEqual(number, occupied);
    assert.match(number, /^(?=.*[A-HJ-NP-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/);
    for (const values of Object.values(checked)) assert.equal(values.length, 2);
  });
}

test("order allocation fails closed after bounded collision attempts", async () => {
  let checks = 0;
  const model = { findUnique: async () => { checks++; return { id: "occupied" }; } };
  await assert.rejects(generateAvailableOrderNumber({ appointment: model, groupPurchase: model, payment: model } as unknown as Prisma.TransactionClient), { statusCode: 503 });
  assert.equal(checks, 60);
});

for (const [code, target] of [["P2034", undefined], ["P2002", ["orderNumber"]], ["P2002", "Payment_orderNumber_key"]] as const) {
  test(`allocation retries ${code} ${String(target ?? "serialization")}`, async () => {
    let calls = 0;
    const result = await retryOrderNumberTransaction(async () => {
      if (++calls === 1) throw new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code, clientVersion: "test", meta: { target } });
      return "new-order";
    });
    assert.equal(result, "new-order");
    assert.equal(calls, 2);
  });
}

test("unrelated unique constraints are not retried and serialization retries are bounded", async () => {
  let unrelated = 0;
  await assert.rejects(retryOrderNumberTransaction(async () => {
    unrelated++;
    throw new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2002", clientVersion: "test", meta: { target: ["email"] } });
  }), { code: "P2002" });
  assert.equal(unrelated, 1);
  let attempts = 0;
  await assert.rejects(retryOrderNumberTransaction(async () => {
    attempts++;
    throw new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2034", clientVersion: "test" });
  }), { code: "P2034" });
  assert.equal(attempts, 3);
});
