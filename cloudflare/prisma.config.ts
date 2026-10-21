import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: { path: './migrations' },
  datasource: { url: 'file:./local.sqlite' },
});
