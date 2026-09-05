import { Skeleton } from "@/components/ui/skeleton";

/** Route skeleton in the shape of a list screen: title, three tiles, a table. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface space-y-3 px-5 py-4">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="surface overflow-hidden">
        <div className="h-9 border-b bg-muted/50" />
        <div className="space-y-0 divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
