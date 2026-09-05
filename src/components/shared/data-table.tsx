import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClickableRow } from "./clickable-row";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Server-renderable data table. Cells are computed here, so the page can pass
 * closures; only the finished nodes cross into the client row component.
 * Pass `rowHref` to make every row open its detail screen (mockup: "click a row").
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
  footer,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowHref?: (row: T) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn("overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn("px-4 text-xs font-medium tracking-wide text-muted-foreground uppercase", ALIGN[c.align ?? "left"], c.className)}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                No records
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const cells = columns.map((c) => (
                <TableCell key={c.key} className={cn("px-4 py-2.5", ALIGN[c.align ?? "left"], c.className)}>
                  {c.cell(row)}
                </TableCell>
              ));
              const key = rowKey(row);
              return rowHref ? (
                <ClickableRow key={key} href={rowHref(row)}>
                  {cells}
                </ClickableRow>
              ) : (
                <TableRow key={key}>{cells}</TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {footer ? <div className="border-t bg-muted/30 px-4 py-2 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
