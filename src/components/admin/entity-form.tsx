"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * One generic form for every configuration row. Values are kept as strings while
 * editing and converted on submit: `percent` -> basis points (x100), `rupees` -> paise
 * (x100), `number` -> Number, `checkbox` -> boolean, `roles` -> string[]. Empty optional
 * fields become null. Field errors come back from the Zod schema in the server action.
 */
export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "percent" | "rupees" | "select" | "checkbox" | "roles";
  options?: { value: string; label: string }[];
  placeholder?: string;
  step?: number;
  min?: number;
  nullable?: boolean;
  hint?: string;
  width?: string;
};

type Raw = Record<string, string | boolean | string[] | undefined>;

const ROLE_OPTIONS = [
  { value: "SALES_MANAGER", label: "Sales manager" },
  { value: "FINANCE", label: "Finance" },
];

function toRaw(initial: Record<string, unknown>, fields: FieldDef[]): Raw {
  const raw: Raw = {};
  for (const f of fields) {
    const v = initial[f.name];
    if (f.type === "checkbox") raw[f.name] = Boolean(v);
    else if (f.type === "roles") raw[f.name] = Array.isArray(v) ? (v as string[]) : [];
    else if (v === null || v === undefined) raw[f.name] = "";
    else if (f.type === "percent" || f.type === "rupees") raw[f.name] = String(Number(v) / 100);
    else raw[f.name] = String(v);
  }
  return raw;
}

function toInput(raw: Raw, fields: FieldDef[], hidden: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...hidden };
  for (const f of fields) {
    const v = raw[f.name];
    if (f.type === "checkbox") out[f.name] = Boolean(v);
    else if (f.type === "roles") out[f.name] = v ?? [];
    else if (v === "" || v === undefined) out[f.name] = f.nullable ? null : undefined;
    else if (f.type === "percent" || f.type === "rupees") out[f.name] = Math.round(Number(v) * 100);
    else if (f.type === "number") out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

export function EntityForm({
  fields,
  initial = {},
  hidden = {},
  action,
  submitLabel = "Save",
  successMessage = "Saved",
  layout = "stack",
  resetOnSuccess = false,
  redirectTo,
  className,
}: {
  fields: FieldDef[];
  initial?: Record<string, unknown>;
  hidden?: Record<string, unknown>;
  action: (input: unknown) => Promise<ActionResult<{ id: number }>>;
  submitLabel?: string;
  successMessage?: string;
  layout?: "stack" | "inline";
  resetOnSuccess?: boolean;
  /** After a successful save, navigate here; `:id` is replaced with the saved id (e.g. "/admin/products/:id"). */
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState<Raw>(() => toRaw(initial, fields));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = (name: string, value: Raw[string]) => setRaw((r) => ({ ...r, [name]: value }));

  const submit = () =>
    start(async () => {
      setErrors({});
      const result = await action(toInput(raw, fields, hidden));
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { _: [result.message] });
        if (!result.fieldErrors) toast.error(result.message);
        return;
      }
      toast.success(successMessage);
      if (redirectTo) {
        router.push(redirectTo.replace(":id", String(result.data.id)));
        return;
      }
      if (resetOnSuccess) setRaw(toRaw({}, fields));
      router.refresh();
    });

  const inline = layout === "inline";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(inline ? "flex flex-wrap items-end gap-2" : "grid gap-4 sm:grid-cols-2", className)}
      noValidate
    >
      {fields.map((f) => {
        const err = errors[f.name]?.[0];
        const id = `${f.name}-${hidden.id ?? initial.id ?? "new"}`;
        return (
          <div key={f.name} className={cn("space-y-1", f.width ?? (inline ? "w-36" : ""))}>
            {f.type === "textarea" ? (
              <>
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {f.label}
                </Label>
                <textarea
                  id={id}
                  name={f.name}
                  value={String(raw[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholder}
                  className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </>
            ) : f.type === "checkbox" ? (
              <label className="flex h-8 items-center gap-2 text-sm">
                <input type="checkbox" name={f.name} checked={Boolean(raw[f.name])} onChange={(e) => set(f.name, e.target.checked)} className="size-4 accent-primary" />
                {f.label}
              </label>
            ) : f.type === "roles" ? (
              <>
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                <div className="flex h-8 items-center gap-3 text-sm">
                  {ROLE_OPTIONS.map((o) => {
                    const arr = (raw[f.name] as string[]) ?? [];
                    return (
                      <label key={o.value} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={arr.includes(o.value)}
                          onChange={(e) => set(f.name, e.target.checked ? [...ROLE_OPTIONS.map((r) => r.value).filter((v) => v === o.value || arr.includes(v))] : arr.filter((v) => v !== o.value))}
                          className="size-4 accent-primary"
                        />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              </>
            ) : f.type === "select" ? (
              <>
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {f.label}
                </Label>
                <select
                  id={id}
                  name={f.name}
                  aria-label={f.label}
                  value={String(raw[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                  aria-invalid={!!err}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                >
                  {f.nullable ? <option value="">–</option> : null}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <Label htmlFor={id} className="text-xs text-muted-foreground">
                  {f.label}
                  {f.type === "percent" ? " (%)" : f.type === "rupees" ? " (₹)" : ""}
                </Label>
                <Input
                  id={id}
                  name={f.name}
                  aria-label={f.label}
                  type={f.type === "text" ? "text" : "number"}
                  inputMode={f.type === "text" ? undefined : "decimal"}
                  step={f.step ?? (f.type === "text" ? undefined : f.type === "number" ? 1 : 0.5)}
                  min={f.min}
                  value={String(raw[f.name] ?? "")}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.name, e.target.value)}
                  aria-invalid={!!err}
                />
              </>
            )}
            {err ? <p className="text-xs text-destructive">{err}</p> : f.hint && !inline ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
          </div>
        );
      })}
      <div className={cn(inline ? "" : "sm:col-span-2 flex items-center gap-3")}>
        <Button type="submit" size={inline ? "sm" : "default"} variant={inline ? "outline" : "default"} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {submitLabel}
        </Button>
        {errors._ ? <span className="text-xs text-destructive">{errors._[0]}</span> : null}
      </div>
    </form>
  );
}
