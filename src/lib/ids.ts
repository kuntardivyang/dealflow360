import { randomBytes } from "node:crypto";

// 64 URL-safe symbols. 12 symbols = 72 bits of randomness, far beyond guessing.
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** Random public identifier used in URLs instead of the integer primary key. */
export function publicId(size = 12): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] & 63];
  return out;
}

/** Opaque session token (43 URL-safe characters from 32 random bytes). */
export function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Zero padded document number such as Q-2026-0001 or INV-2026-0042. */
export function formatNumber(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}
