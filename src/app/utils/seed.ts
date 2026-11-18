import bcrypt from "bcrypt";

import { Role, UserStatus } from "../../../generated/prisma/client.js";

import config from "../config/index.js";
import { prisma } from "../lib/prisma.js";
import { assertBcryptPasswordLength } from "./password-security.js";

// =====================================================
// 1. SEED SUPER ADMIN
// =====================================================

export const seedSuperAdmin = async () => {
  const name = process.env.SUPER_ADMIN_NAME?.trim();
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const phone = process.env.SUPER_ADMIN_PHONE?.trim() || null;

  if (!name || !email || !password) {
    throw new Error("Super Admin seed credentials are missing");
  }

  if (password.length < 8) {
    throw new Error("Super Admin password must contain at least 8 characters");
  }

  assertBcryptPasswordLength(password);

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
  });

  if (existingByEmail) {
    if (existingByEmail.role === Role.SUPER_ADMIN) {
      console.log("Super Admin already exists");
      return;
    }

    throw new Error(`Email "${email}" is already used by another user`);
  }

  if (phone) {
    const existingByPhone = await prisma.user.findUnique({
      where: { phone },
    });

    if (existingByPhone) {
      throw new Error(`Phone "${phone}" is already used by another user`);
    }
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  const superAdmin = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash: hashedPassword,
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
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

  console.log("Super Admin created:", superAdmin);
};

// =====================================================
// 2. SEED BRAND OWNER — EXISTING LOGIC
// =====================================================

export const seedBrandOwner = async () => {
  const name = config.brand_owner_name?.trim();
  const email = config.brand_owner_email?.trim().toLowerCase();
  const password = config.brand_owner_password;
  const phone = config.brand_owner_phone?.trim() || null;

  if (!name || !email || !password) {
    throw new Error("Brand Owner seed credentials are missing");
  }

  assertBcryptPasswordLength(password);

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
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
      where: { phone },
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

// =====================================================
// 3. SEED BRAND — EXISTING LOGIC
// =====================================================

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

// =====================================================
// 4. INITIAL SEED — EXISTING LOGIC
// =====================================================

export const seedInitialData = async () => {
  await seedBrandOwner();
  await seedBrand();
};

// =====================================================
// 5. SEED SAAS SUBSCRIPTION PRICING
// =====================================================

export const seedSaasPricing = async () => {
  // =====================================================
  // 5.1. STANDARD SUBSCRIPTION PLAN
  // =====================================================

  const plan = await prisma.subscriptionPlan.upsert({
    where: {
      code: "STANDARD",
    },

    // Preserve pricing changed by Super Admin
    update: {},

    create: {
      code: "STANDARD",
      name: "Standard Plan",
      description: "Base monthly subscription for merchants",
      price: 500,
      currency: "HKD",
      isActive: true,
    },
  });

  // =====================================================
  // 5.2. FIVE PREMIUM FEATURE DEFINITIONS
  // =====================================================

  const premiumFeatures = [
    {
      code: "BRANCH_STORE",
      name: "Branch Store",
      description: "Premium branch store functionality",
      price: 100,
    },
    {
      code: "GROUP_BUYING",
      name: "Group Buying",
      description: "Group purchase and group buying functionality",
      price: 150,
    },
    {
      code: "HAIRSTYLIST",
      name: "Hairstylist",
      description: "Premium hairstylist management functionality",
      price: 80,
    },
    {
      code: "WALLET",
      name: "Wallet",
      description: "Customer wallet and top-up functionality",
      price: 120,
    },
    {
      code: "REVIEWS",
      name: "Comment / Review",
      description: "Customer reviews and ratings functionality",
      price: 50,
    },
  ] as const;

  // =====================================================
  // 5.3. REGISTER PREMIUM FEATURES
  // =====================================================

  for (const feature of premiumFeatures) {
    await prisma.addonFeature.upsert({
      where: {
        code: feature.code,
      },

      // Do not overwrite Super Admin pricing changes
      update: {},

      create: {
        code: feature.code,
        name: feature.name,
        description: feature.description,
        price: feature.price,
        currency: "HKD",
        isActive: true,
      },
    });
  }

  // =====================================================
  // 5.4. VERIFY DATABASE PRICING
  // =====================================================

  const savedAddons = await prisma.addonFeature.findMany({
    where: {
      code: {
        in: premiumFeatures.map((feature) => feature.code),
      },
    },

    select: {
      id: true,
      code: true,
      name: true,
      price: true,
      currency: true,
      isActive: true,
    },

    orderBy: {
      code: "asc",
    },
  });

  if (savedAddons.length !== premiumFeatures.length) {
    throw new Error("SaaS pricing initialization incomplete");
  }

  // =====================================================
  // 5.5. LOG RESULT
  // =====================================================

  console.log("SaaS pricing initialized successfully");

  console.log("Standard Plan:", {
    id: plan.id,
    code: plan.code,
    price: plan.price.toString(),
    currency: plan.currency,
    isActive: plan.isActive,
  });

  console.log(
    "Premium Features:",
    savedAddons.map((addon) => ({
      id: addon.id,
      code: addon.code,
      name: addon.name,
      price: addon.price.toString(),
      currency: addon.currency,
      isActive: addon.isActive,
    })),
  );

  return {
    plan,
    addons: savedAddons,
  };
};
