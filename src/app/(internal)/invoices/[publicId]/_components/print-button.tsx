"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Download Summary: the browser's print dialog with the print stylesheet (PDF export without a PDF library). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} data-print-hide>
      <Printer /> Download Summary
    </Button>
  );
}
