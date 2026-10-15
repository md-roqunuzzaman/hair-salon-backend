import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need session continuity; application traffic can stay pooled.
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});
