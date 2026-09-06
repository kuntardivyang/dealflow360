// Owner: B. Subscription lifecycle. Quantity changes are allowed only while ACTIVE.
import type { SubscriptionStatus } from "@/lib/contract";
import { assertMove } from "./machine";

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  ACTIVE: ["PAUSED", "CANCELLED", "RENEWED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  RENEWED: [], // a successor has taken over; the parent is history
};

export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  assertMove("subscription", SUBSCRIPTION_TRANSITIONS, from, to);
}

export function assertSubscriptionChangeable(status: SubscriptionStatus): void {
  assertMove("subscription", { ...SUBSCRIPTION_TRANSITIONS, ACTIVE: ["ACTIVE", ...SUBSCRIPTION_TRANSITIONS.ACTIVE] }, status, "ACTIVE");
}
