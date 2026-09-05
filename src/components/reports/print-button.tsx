"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Export PDF = the browser's print dialog on the print stylesheet (navigation and filters hidden). */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer /> Export PDF
    </Button>
  );
}
