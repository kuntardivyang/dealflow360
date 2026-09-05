// Owner: B. Tiny table-driven state machine helper shared by every lifecycle.
import { ConflictError } from "@/lib/contract";

/** For each action, the states it may be performed from. */
export type TransitionTable<S extends string, A extends string> = Record<A, readonly S[]>;

export const humanize = (s: string): string => s.toLowerCase().replaceAll("_", " ");

export function isAllowed<S extends string, A extends string>(table: TransitionTable<S, A>, from: S, action: A): boolean {
  return table[action].includes(from);
}

/** Throws ConflictError (rendered as 409) for a disallowed (state, action) pair. */
export function assertAllowed<S extends string, A extends string>(entity: string, table: TransitionTable<S, A>, from: S, action: A): void {
  if (!isAllowed(table, from, action)) {
    throw new ConflictError(`Illegal transition: cannot ${humanize(action)} a${/^[aeiou]/i.test(entity) ? "n" : ""} ${entity} that is ${humanize(from)}`);
  }
}

/** Direct state-to-state tables (approval request, step, invoice, plan, subscription). */
export function assertMove<S extends string>(entity: string, table: Record<S, readonly S[]>, from: S, to: S): void {
  if (!table[from].includes(to)) {
    throw new ConflictError(`Illegal transition: ${entity} cannot go from ${humanize(from)} to ${humanize(to)}`);
  }
}
