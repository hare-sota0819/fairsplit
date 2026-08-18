import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// One client per process; cached on globalThis so Next dev hot-reload doesn't
// open a new connection pool per reload. Prisma 7 requires a driver adapter.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const createClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
  })

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
