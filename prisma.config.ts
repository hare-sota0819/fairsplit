import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // CLI-only URL (migrate/validate/studio). In production, migrations must
    // use the direct (session-mode) connection — DIRECT_URL — because the
    // transaction pooler in DATABASE_URL cannot run migrations. Locally
    // DIRECT_URL is unset and DATABASE_URL is already a direct connection.
    // Runtime queries use DATABASE_URL via the adapter in src/lib/prisma.ts.
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'],
  },
})
