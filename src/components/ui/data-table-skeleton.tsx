import { Skeleton } from "@/components/ui/skeleton";

type DataTableSkeletonProps = {
  rows?: number;
  columns?: number;
};

export function DataTableSkeleton({ rows = 6, columns = 5 }: DataTableSkeletonProps) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 pb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
