import "dotenv/config";

import { seedSuperAdmin } from "../src/app/utils/seed.js";
import { prisma } from "../src/app/lib/prisma.js";

const main = async () => {
  await seedSuperAdmin();

  console.log("Super Admin bootstrap completed");
};

main()
  .catch((error) => {
    console.error("Super Admin bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
