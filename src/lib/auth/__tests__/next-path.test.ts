import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/internal";
import { signupSchema } from "@/lib/contract";

describe("safeNextPath", () => {
  it("keeps same-site paths and falls back for anything else", () => {
    expect(safeNextPath("/quotes/abc")).toBe("/quotes/abc");
    expect(safeNextPath("/approvals?filter=pending")).toBe("/approvals?filter=pending");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("/login?next=/x")).toBe("/dashboard");
  });
});

describe("signup input", () => {
  it("has no role field, so a client cannot pick its role (database default SALES_REP applies)", () => {
    const parsed = signupSchema.parse({ name: "New Rep", email: "New@Example.com", password: "longenough", role: "ADMIN" });
    expect(parsed).toEqual({ name: "New Rep", email: "new@example.com", password: "longenough" });
    expect("role" in parsed).toBe(false);
  });

  it("rejects short passwords and bad emails with field messages", () => {
    const r = signupSchema.safeParse({ name: "A", email: "nope", password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["name", "email", "password"]));
    }
  });
});
