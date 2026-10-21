import app from "./app.js";
import config from "./app/config/index.js";
import { startAppointmentExpiryJob } from "./app/jobs/appointment-expiry.job.js";
import { startGroupPurchaseExpiryJob } from "./app/jobs/group-purchase-expiry.job.js";
import { verifyEmailConnection } from "./app/lib/nodemailer.js";
import { prisma } from "./app/lib/prisma.js";
import { connectRedis } from "./app/lib/redis.js";
import { seedInitialData } from "./app/utils/seed.js";
import { logUnexpectedError } from "./app/utils/normalize-error.js";
import { installFatalErrorHandlers } from "./app/utils/process-errors.js";

// Preserve Node's fail-fast behavior without printing secrets from raw errors.
installFatalErrorHandlers();

const PORT = config.port;

const main = async () => {
  try {
    await prisma.$connect();
    console.log("Connected to the database successfully.");
    await connectRedis();
    console.log("redis connected successfully");
    await verifyEmailConnection();
    await seedInitialData();
    console.log("seed data created successfully");
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      startAppointmentExpiryJob();
      // New Group Purchase expiry job
      startGroupPurchaseExpiryJob();
    });
  } catch (error) {
    logUnexpectedError(error, { source: "src/server.ts:39" });
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();
