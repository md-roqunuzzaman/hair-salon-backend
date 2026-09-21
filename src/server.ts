import app from "./app.js";
import config from "./app/config/index.js";
import { prisma } from "./app/lib/prisma.js";
import { connectRedis } from "./app/lib/redis.js";
import { seedInitialData } from "./app/utils/seed.js";

const PORT = config.port;

const main = async () => {
  try {
    await prisma.$connect();
    console.log("Connected to the database successfully.");
    await connectRedis();
    console.log("redis connected successfully");
    await seedInitialData();
    console.log("seed data created successfully");
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();
