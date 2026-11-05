import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { EmptyState, Spinner } from "./Field";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  /** Hidden in the mobile card layout when false; the primary column heads each card. */
  primary?: boolean;
  hideOnMobile?: boolean;
  width?: string;
};

export type SortState = { field: string; order: "asc" | "desc" };

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: Error | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  caption?: string;
  /** Background tint for a row (and its mobile card). */
  rowClassName?: (row: T) => string | undefined;
  /** Left-edge accent for a row, applied to the first cell on desktop and the card on mobile. */
  rowAccentClassName?: (row: T) => string | undefined;
};

/**
 * Horizontal scroll area with a scrollbar above the table as well as below it, so a wide list can be
 * scrolled without first scrolling to the bottom of a long page. The two bars stay in step.
 */
function DualScroll({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setContentWidth(body.scrollWidth);
      setOverflowing(body.scrollWidth > body.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => observer.disconnect();
  }, []);

  function follow(source: HTMLDivElement | null, target: HTMLDivElement | null) {
    if (!source || !target || syncing.current) return;
    syncing.current = true;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }

  return (
    <>
      <div
        ref={topRef}
        onScroll={() => follow(topRef.current, bodyRef.current)}
        className={cn("scroll-visible overflow-x-auto overflow-y-hidden border-b border-slate-200", !overflowing && "hidden")}
        aria-hidden="true"
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      <div ref={bodyRef} onScroll={() => follow(bodyRef.current, topRef.current)} className="scroll-visible overflow-x-auto overscroll-x-contain">
        {children}
      </div>
    </>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  emptyTitle = "Nothing to show",
  emptyDescription,
  onRowClick,
  sort,
  onSortChange,
  caption,
  rowClassName,
  rowAccentClassName
}: DataTableProps<T>) {
  if (isLoading) return <Spinner label="Loading records" />;

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">This list could not be loaded</p>
          <p className="mt-1 text-xs leading-5">{error.message}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  function toggleSort(column: Column<T>) {
    if (!column.sortable || !onSortChange) return;
    const order = sort?.field === column.key && sort.order === "desc" ? "asc" : "desc";
    onSortChange({ field: column.key, order });
  }

  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary && !column.hideOnMobile);

  return (
    <div>
      {/* Desktop and tablet: a real table that scrolls inside its own container. */}
      <div className="hidden max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <DualScroll>
          <table className="w-full min-w-max border-collapse text-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      "px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-500",
                      column.align === "right" && "text-right"
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className="inline-flex items-center gap-1 rounded hover:text-brand-charcoal"
                        aria-label={`Sort by ${column.header}`}
                      >
                        {column.header}
                        {sort?.field === column.key ? (
                          sort.order === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-slate-100 last:border-0",
                    rowClassName?.(row),
                    onRowClick && "cursor-pointer hover:brightness-95"
                  )}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-3 py-2.5 align-top text-slate-700",
                        column.align === "right" && "text-right",
                        columnIndex === 0 && rowAccentClassName?.(row)
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DualScroll>
      </div>

      {/* Mobile: one card per record so nothing is clipped or hidden behind a scrollbar. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            {/*
              A div with a button role rather than a real <button>: several columns
              render their own action buttons, and nesting those inside a button is
              invalid HTML that browsers recover from unpredictably, swallowing the
              inner control's clicks.
            */}
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(
                "w-full rounded-lg border border-slate-200 p-3 text-left shadow-sm",
                rowClassName?.(row) ?? "bg-white",
                rowAccentClassName?.(row),
                onRowClick && "cursor-pointer active:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              )}
            >
              <div className="text-sm font-bold text-brand-charcoal">{primary.render(row)}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {secondary.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{column.header}</dt>
                    <dd className="truncate text-xs text-slate-700">{column.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-xs font-semibold text-slate-500">
        Showing {first} to {last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="h-9 px-3" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-xs font-semibold text-slate-600">
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" className="h-9 px-3" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
