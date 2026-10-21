// Generate the existing Node client for offline regression tests. No database
// connection or real PostgreSQL credentials are needed to generate a client.
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: '../prisma/schema',
  datasource: { url: 'postgresql://unused:unused@localhost:1/unused' },
});
