import { prisma } from "../lib/prisma.js";
import { AppError } from "./app-error.js";
import { Prisma } from "../../../generated/prisma/client.js";

export const getBrandInternationalSettings = async (client: Prisma.TransactionClient = prisma) => {
  const brand = await client.brand.findFirst({
    select: {
      countryCode: true,
      currency: true,
      timezone: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  return brand;
};
