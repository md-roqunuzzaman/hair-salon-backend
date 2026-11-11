import { randomInt } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "./app-error.js";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const CHARACTERS = LETTERS + NUMBERS;

export const generateOrderNumber = (): string => {
  const characters = [
    LETTERS[randomInt(LETTERS.length)],
    NUMBERS[randomInt(NUMBERS.length)],
  ];

  for (let i = 2; i < 6; i++) {
    characters.push(CHARACTERS[randomInt(CHARACTERS.length)]);
  }

  // Shuffle to randomize positions
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }

  return characters.join("");
};

// The caller must insert the logical order in this same Serializable transaction.
// Checking all three tables makes concurrent cross-table allocations conflict on
// PostgreSQL; Workers serialize the equivalent transaction in Durable Object storage.
export const generateAvailableOrderNumber = async (
  tx: Prisma.TransactionClient,
): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const orderNumber = generateOrderNumber();
    const matches = await Promise.all([
      tx.appointment.findUnique({ where: { orderNumber }, select: { id: true } }),
      tx.groupPurchase.findUnique({ where: { orderNumber }, select: { id: true } }),
      tx.payment.findUnique({ where: { orderNumber }, select: { id: true } }),
    ]);
    if (matches.every((match) => match === null)) return orderNumber;
  }
  throw new AppError("Could not generate a unique order number. Please try again.", 503);
};

export const retryOrderNumberTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2002" &&
          (Array.isArray(target) ? target.includes("orderNumber") : typeof target === "string" && target.includes("orderNumber"))));
      if (!retryable || attempt >= 3) throw error;
    }
  }
};
