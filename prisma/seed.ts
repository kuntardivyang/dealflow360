// Entry point for `prisma db seed` (also run by `pnpm reset`). Order matters:
// governance and users first, then catalogue, customers, stock, plans, quotes.
import { PrismaClient } from "../src/generated/prisma/client";
import { seedCatalogue } from "./seed/a-catalogue";
import { seedCustomers } from "./seed/a-customers";
import { seedPlans } from "./seed/a-plans";
import { seedQuotes } from "./seed/a-quotes";
import { seedStock } from "./seed/a-stock";
import { seedGovernance } from "./seed/b-governance";
import { seedHistory } from "./seed/b-history";
import { seedUsers } from "./seed/b-users";

const db = new PrismaClient();

async function main() {
  const started = Date.now();
  const users = await seedUsers(db);
  const tiers = await seedGovernance(db);
  const catalogue = await seedCatalogue(db, tiers);
  const customers = await seedCustomers(db, tiers);
  await seedStock(db, catalogue);
  const plans = await seedPlans(db);
  await seedQuotes(db, catalogue, customers, plans, users);
  await seedHistory(db, catalogue, customers, users); // B: deal-health histories
  console.log(`Seed complete in ${Date.now() - started} ms. Logins: *@df.local / demo1234, portal buyer@acme.com / demo1234`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
