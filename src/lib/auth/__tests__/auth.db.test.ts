// Runs against the seeded development database. Creates one session for a seeded user
// and removes it afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { authenticate, createSession, destroySession, hashPassword } from "@/lib/auth/internal";
import { prisma } from "@/lib/db";

const tokens: string[] = [];

afterAll(async () => {
  await prisma.session.deleteMany({ where: { token: { in: tokens } } });
  await prisma.$disconnect();
});

describe("internal auth against the database", () => {
  it("authenticates a seeded user with demo1234 and reads the role from the row", async () => {
    const meera = await authenticate("Meera@DF.local", "demo1234");
    expect(meera).toMatchObject({ email: "meera@df.local", role: "SALES_MANAGER" });
    const riya = await authenticate("riya@df.local", "demo1234");
    expect(riya).toMatchObject({ role: "SALES_REP", managerId: meera!.id });
  });

  it("returns null for a wrong password and for an unknown email (same answer for both)", async () => {
    expect(await authenticate("riya@df.local", "wrong")).toBeNull();
    expect(await authenticate("nobody@df.local", "demo1234")).toBeNull();
  });

  it("creates a 24 h session row and destroys it", async () => {
    const riya = await authenticate("riya@df.local", "demo1234");
    const { token, expiresAt } = await createSession(riya!.id);
    tokens.push(token);
    expect(token).toHaveLength(43);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    const row = await prisma.session.findUnique({ where: { token } });
    expect(row?.userId).toBe(riya!.id);
    await destroySession(token);
    expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
  });

  it("hashes passwords with bcrypt", async () => {
    const hash = await hashPassword("demo1234");
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash).not.toContain("demo1234");
  });
});
