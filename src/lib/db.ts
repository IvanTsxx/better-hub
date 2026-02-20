import { PrismaClient } from "../generated/prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

function makePrisma() {
  return new (PrismaClient)({
    accelerateUrl: process.env.DATABASE_URL ?? "",
  }).$extends(withAccelerate());
}

type ExtendedPrismaClient = ReturnType<typeof makePrisma>;

const globalForPrisma = globalThis as typeof globalThis & {
  __prisma?: ExtendedPrismaClient;
};

export const prisma: ExtendedPrismaClient =
  globalForPrisma.__prisma ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}
