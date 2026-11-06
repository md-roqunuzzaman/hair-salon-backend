import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "./app-error.js";

export const appointmentTimezone = async (client: Prisma.TransactionClient, id: string): Promise<string> => {
  const row = await client.appointment.findUnique({ where: { id }, select: { timezone: true } });
  if (!row) throw new AppError("Appointment not found", 404);
  if (row.timezone) return row.timezone;
  // Legacy records have no snapshot. Brand timezone changes remain blocked while
  // any such record exists; never backfill a historical zone by guessing.
  const brand = await client.brand.findFirst({ select: { timezone: true } });
  if (!brand) throw new AppError("Brand not found", 404);
  return brand.timezone;
};
