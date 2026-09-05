// Owner: B. Export XLS of the current report (PDF A7). Same filters and query as the page.
import * as XLSX from "xlsx";
import { requireActionUser } from "@/lib/auth/internal";
import { BACKEND_ROLES, parseInput, reportFilterSchema, type QuotationStatus, QUOTATION_STATUS_LABEL } from "@/lib/contract";
import { runReport } from "@/services/reports.service";

export async function GET(req: Request) {
  try {
    await requireActionUser(BACKEND_ROLES);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = parseInput(reportFilterSchema, sp);
  if (!parsed.ok) return Response.json(parsed, { status: 400 });

  const report = await runReport(parsed.data);
  const sheet = XLSX.utils.json_to_sheet(
    report.rows.map((r) => ({
      Quotation: r.number,
      Customer: r.customer,
      Rep: r.rep,
      Status: QUOTATION_STATUS_LABEL[r.status as QuotationStatus],
      Created: r.createdAt.toISOString().slice(0, 10),
      "Net (INR)": r.netTotal / 100,
      "Discount (INR)": r.discountTotal / 100,
      "Total incl. tax (INR)": r.total / 100,
      "Margin %": r.marginBp === null ? "" : r.marginBp / 100,
      "Risk score": r.riskScore ?? "",
      "Approval rounds": r.approvals,
      "Upsell lines": r.upsellLines,
    })),
  );
  XLSX.utils.sheet_add_aoa(sheet, [["Totals", "", "", "", "", report.totals.netTotal / 100, report.totals.discountTotal / 100, report.totals.total / 100]], { origin: -1 });
  const summary = XLSX.utils.aoa_to_sheet([
    ["Period", `${report.range.from} to ${report.range.to}`],
    ["Quotes created", report.tiles.quotesCreated],
    ["Average approval time (hours)", report.tiles.avgApprovalHours === null ? "" : Number(report.tiles.avgApprovalHours.toFixed(1))],
    ["Top upsold product", report.tiles.topUpsold ?? ""],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Quotations");
  XLSX.utils.book_append_sheet(wb, summary, "Summary");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dealflow360-report-${report.range.from}-to-${report.range.to}.xlsx"`,
    },
  });
}
