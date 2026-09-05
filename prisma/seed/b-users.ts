// Owner: B. Internal users. Every demo password is demo1234.
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { log } from "./util";

export async function seedUsers(db: PrismaClient) {
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const admin = await db.user.create({ data: { email: "admin@test.com", name: "Admin", role: "ADMIN", passwordHash } });
  const meera = await db.user.create({ data: { email: "meera@test.com", name: "Meera Shah", role: "SALES_MANAGER", passwordHash } });
  const farhan = await db.user.create({ data: { email: "farhan@test.com", name: "Farhan Iyer", role: "FINANCE", passwordHash } });
  const riya = await db.user.create({
    data: { email: "riya@test.com", name: "Riya Rao", role: "SALES_REP", managerId: meera.id, passwordHash },
  });
  const arjun = await db.user.create({
    data: { email: "arjun@test.com", name: "Arjun Mehta", role: "SALES_REP", managerId: meera.id, passwordHash },
  });
  log("users", "admin, meera (manager), farhan (finance), riya + arjun (reps)");
  return { admin, meera, farhan, riya, arjun };
}
