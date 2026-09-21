import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { IUpdateBrandPayload } from "./brand.interface.js";

const getBrand = async () => {
  const brand = await prisma.brand.findFirst();

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  return brand;
};

const updateBrand = async (payload: IUpdateBrandPayload) => {
  const brand = await prisma.brand.findFirst();

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const updatedBrand = await prisma.brand.update({
    where: {
      id: brand.id,
    },
    data: {
      name: payload.name?.trim(),
      description: payload.description?.trim(),
      phone: payload.phone?.trim(),
      email: payload.email?.trim().toLowerCase(),
      logoObjectKey: payload.logoObjectKey,
    },
  });

  return updatedBrand;
};

export const brandService = {
  getBrand,
  updateBrand,
};
