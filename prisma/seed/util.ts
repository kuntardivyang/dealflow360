// Helpers shared by every seed file. Deterministic: NOW is captured once.
import { randomBytes } from "node:crypto";

export const NOW = new Date();
export const YEAR = NOW.getUTCFullYear();

/** Calendar date (UTC midnight) for @db.Date columns. */
export const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
export const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
export const today = () => utcDate(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, NOW.getUTCDate());

/** Rupees to integer paise, e.g. rs(60000) = 6_000_000. */
export const rs = (rupees: number) => Math.round(rupees * 100);
/** Percent to basis points, e.g. pct(12.5) = 1250. */
export const pct = (p: number) => Math.round(p * 100);

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
export function publicId(size = 12): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] & 63];
  return out;
}

/** Same integer math the domain layer uses: round half-up once per line. */
export function lineMoney(unitPrice: number, qty: number, discountBp: number, taxBp: number, unitCost: number) {
  const gross = unitPrice * qty;
  const discountAmount = Math.round((gross * discountBp) / 10000);
  const net = gross - discountAmount;
  const tax = Math.round((net * taxBp) / 10000);
  return { gross, discountAmount, net, tax, total: net + tax, cost: unitCost * qty };
}

export function log(section: string, detail: string) {
  console.log(`  seed ${section.padEnd(12)} ${detail}`);
}
