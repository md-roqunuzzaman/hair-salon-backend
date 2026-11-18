import "dotenv/config";

import { seedSaasPricing } from "../src/app/utils/seed.js";
import { prisma } from "../src/app/lib/prisma.js";

const main = async () => {
  await seedSaasPricing();
  console.log("SaaS pricing initialization completed");
};

main()
  .catch((error) => {
    console.error("SaaS pricing initialization failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
