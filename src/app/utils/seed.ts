import bcrypt from "bcrypt";

import { Role, UserStatus } from "../../../generated/prisma/client.js";

import config from "../config/index.js";
import { prisma } from "../lib/prisma.js";

export const seedBrandOwner = async () => {
  const name = config.brand_owner_name?.trim();
  const email = config.brand_owner_email?.trim().toLowerCase();
  const password = config.brand_owner_password;
  const phone = config.brand_owner_phone?.trim() || null;

  if (!name || !email || !password) {
    throw new Error("Brand Owner seed credentials are missing");
  }

  const existingByEmail = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingByEmail) {
    if (existingByEmail.role === Role.BRAND_OWNER) {
      console.log("Brand Owner already exists");

      return;
    }

    throw new Error(`Email "${email}" is already used by another user`);
  }

  if (phone) {
    const existingByPhone = await prisma.user.findUnique({
      where: {
        phone,
      },
    });

    if (existingByPhone) {
      throw new Error(`Phone "${phone}" is already used by another user`);
    }
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  const brandOwner = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash: hashedPassword,
      role: Role.BRAND_OWNER,
      status: UserStatus.ACTIVE,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
    },
  });

  console.log("Brand Owner created:", brandOwner);
};

export const seedBrand = async () => {
  const existingBrand = await prisma.brand.findFirst();

  if (existingBrand) {
    console.log("Brand already exists");

    return;
  }

  const brand = await prisma.brand.create({
    data: {
      name: config.brand_name?.trim() || "Hair Salon",

      description:
        config.brand_description?.trim() ||
        "Professional Hair Salon in Hong Kong",

      phone: config.brand_phone?.trim() || null,

      email: config.brand_email?.trim().toLowerCase() || null,

      logoObjectKey: null,
    },
  });

  console.log("Brand created:", brand);
};

export const seedInitialData = async () => {
  await seedBrandOwner();
  await seedBrand();
};
