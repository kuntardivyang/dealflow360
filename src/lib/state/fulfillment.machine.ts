// Owner: B. Fulfillment plan and shipment lifecycles. Accepting a plan is guarded by
// the plan being PROPOSED and the quotation being CONFIRMED (quotation.machine).
import type { FulfillmentPlanStatus } from "@/lib/contract";
import { assertMove } from "./machine";

export type ShipmentStatus = "RESERVED" | "SHIPPED";

export const PLAN_TRANSITIONS: Record<FulfillmentPlanStatus, readonly FulfillmentPlanStatus[]> = {
  PROPOSED: ["ACCEPTED", "SUPERSEDED"],
  ACCEPTED: [],
  SUPERSEDED: [],
};

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  RESERVED: ["SHIPPED"],
  SHIPPED: [],
};

export function assertPlanTransition(from: FulfillmentPlanStatus, to: FulfillmentPlanStatus): void {
  assertMove("fulfillment plan", PLAN_TRANSITIONS, from, to);
}

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  assertMove("shipment", SHIPMENT_TRANSITIONS, from, to);
}
