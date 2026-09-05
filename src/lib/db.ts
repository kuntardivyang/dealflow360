import { Prisma, PrismaClient } from "@/generated/prisma/client";

// One Prisma client per process. Next.js reloads modules in development, so the
// instance is cached on globalThis to avoid exhausting database connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Transaction client type for services that receive `tx` from `prisma.$transaction`. */
export type Tx = Prisma.TransactionClient;
