// Owner: A. Customers with their portal contacts. Portal password is demo1234.
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { seedGovernance } from "./b-governance";
import { log, publicId } from "./util";

type Tiers = Awaited<ReturnType<typeof seedGovernance>>;

export async function seedCustomers(db: PrismaClient, tiers: Tiers) {
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const make = (name: string, city: string, tierId: number, email: string, contact: string) =>
    db.customer.create({
      data: {
        publicId: publicId(),
        name,
        city,
        tierId,
        email,
        contacts: { create: { email, name: contact, passwordHash } },
      },
      include: { contacts: true },
    });

  const acme = await make("Acme Corp", "Ahmedabad", tiers.gold.id, "acme@test.com", "Nisha Acme");
  const beta = await make("Beta Industries", "Kolkata", tiers.silver.id, "beta@test.com", "Rahul Beta");
  const gamma = await make("Gamma Retail", "Pune", tiers.bronze.id, "gamma@test.com", "Sana Gamma");
  log("customers", "Acme (Gold), Beta (Silver), Gamma (Bronze) with portal contacts");
  return { acme, beta, gamma };
}
