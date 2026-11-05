import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, ExternalLink, FilterX, Search } from "lucide-react";
import { CAPA_STATUSES, CAPA_TYPES } from "@shared/constants/domain";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Cards";
import { DataTable, Pagination, type Column } from "@/components/ui/DataTable";
import { Field, Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { downloadSheet } from "@/lib/excel";
import { formatDate, statusTone } from "@/lib/format";
import { capaOwnerName, useCapas, useMasterBootstrap, type CapaItem } from "@/services/queries";

export function CapaMasterPage() {
  const toast = useToast();
  const master = useMasterBootstrap();
  const [params, setParams] = useSearchParams();

  const query = useMemo(() => {
    const entries: Record<string, string | number> = {
      page: Number(params.get("page") ?? 1),
      pageSize: Number(params.get("pageSize") ?? 25),
      sort: params.get("sort") ?? "createdAt",
      order: params.get("order") ?? "desc"
    };
    ["status", "type", "company", "department", "search", "dueFrom", "dueTo"].forEach((k) => {
      const v = params.get(k);
      if (v) entries[k] = v;
    });
    return entries;
  }, [params]);

  const { data, isLoading, error } = useCapas(query);
  const capas = data?.items ?? [];

  const companies = master.data?.companies ?? [];
  const departments = master.data?.departments ?? [];

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.set("page", "1");
    setParams(next);
  }

  function clearFilters() {
    setParams(new URLSearchParams({ page: "1", pageSize: "25" }));
  }

  function handleExportAll() {
    if (capas.length === 0) {
      toast.error("No CAPA records available for export");
      return;
    }
    const rows = capas.map((c) => ({
      "CAPA Number": c.number,
      "Complaint Number": typeof c.complaint === "object" ? c.complaint?.number : c.complaint,
      Company: typeof c.company === "object" ? c.company?.name : c.company ?? "—",
      Type: c.type,
      Action: c.action,
      Owner: capaOwnerName(c),
      Department: typeof c.department === "object" ? c.department?.name : c.department ?? "—",
      "Assigned Date": formatDate(c.assignedAt),
      "Target Due Date": formatDate(c.dueDate),
      "Completed Date": formatDate(c.completedAt),
      Status: c.status,
      "Evidence Status": c.evidenceReview?.status ?? "Pending",
      "Evidence Reviewer": c.evidenceReview?.byName ?? "—",
      "Effectiveness Result": c.effectiveness ?? "Pending",
      "Verification Method": c.verificationMethod ?? "—",
      "Verified Date": formatDate(c.effectivenessVerifiedAt),
      "Delay Reason": c.delayReason ?? "None"
    }));
    downloadSheet("CAPA-Master-Register", "CAPA Master", rows);
    toast.success("CAPA Master Register exported to Excel");
  }

  const columns: Column<CapaItem>[] = [
    {
      key: "number",
      header: "CAPA #",
      primary: true,
      render: (row) => (
        <span className="font-mono font-bold text-xs text-brand-charcoal">{row.number}</span>
      )
    },
    {
      key: "complaint",
      header: "Complaint",
      render: (row) => {
        const cId = typeof row.complaint === "object" ? row.complaint?._id : row.complaint;
        const cNum = typeof row.complaint === "object" ? row.complaint?.number : row.complaint;
        return (
          <Link
            to={`/complaints/${cId}`}
            className="font-mono font-semibold text-xs text-brand-red hover:underline inline-flex items-center gap-1"
          >
            <span>{cNum}</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        );
      }
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <span className="text-xs text-slate-600 font-medium">{row.type}</span>
    },
    {
      key: "action",
      header: "Action Item Description",
      render: (row) => (
        <p className="max-w-xs truncate text-xs text-slate-800 font-medium" title={row.action}>
          {row.action}
        </p>
      )
    },
    {
      key: "owner",
      header: "Owner",
      render: (row) => {
        const ownerName = capaOwnerName(row);
        return <span className="text-xs text-slate-700 font-medium">{ownerName}</span>;
      }
    },
    {
      key: "department",
      header: "Department",
      render: (row) => {
        const deptName = typeof row.department === "object" ? row.department?.name : row.department ?? "—";
        return <span className="text-xs text-slate-500">{deptName}</span>;
      }
    },
    {
      key: "dueDate",
      header: "Target SLA",
      render: (row) => <span className="text-xs text-slate-700">{formatDate(row.dueDate)}</span>
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.completedAt)}</span>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
    },
    {
      key: "effectiveness",
      header: "Effectiveness",
      render: (row) => {
        if (!row.effectiveness) return <span className="text-xs text-slate-400">Pending</span>;
        return (
          <StatusBadge tone={row.effectiveness === "Effective" ? "green" : "red"}>
            {row.effectiveness}
          </StatusBadge>
        );
      }
    }
  ];

  return (
    <main className="space-y-6 pb-12">
      <PageHeader
        title="CAPA Master Register"
        description="Comprehensive master register of all corrective and preventive actions with full lifecycle tracking."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={handleExportAll}
              disabled={capas.length === 0}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export Master Excel
            </Button>
            <Link
              to="/capa/tracker"
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              CAPA Tracker
            </Link>
          </div>
        }
      />

      <div className="space-y-4 px-4 sm:px-6">
        <SectionCard>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <Field label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-8 text-xs"
                  placeholder="CAPA #, description, owner..."
                  value={params.get("search") ?? ""}
                  onChange={(e) => updateFilter("search", e.target.value)}
                />
              </div>
            </Field>

            <Field label="Status">
              <Select
                className="text-xs"
                value={params.get("status") ?? ""}
                onChange={(e) => updateFilter("status", e.target.value)}
              >
                <option value="">All Statuses</option>
                {CAPA_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Action Type">
              <Select
                className="text-xs"
                value={params.get("type") ?? ""}
                onChange={(e) => updateFilter("type", e.target.value)}
              >
                <option value="">All Types</option>
                {CAPA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            {companies.length > 1 && (
              <Field label="Company">
                <Select
                  className="text-xs"
                  value={params.get("company") ?? ""}
                  onChange={(e) => updateFilter("company", e.target.value)}
                >
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Department">
              <Select
                className="text-xs"
                value={params.get("department") ?? ""}
                onChange={(e) => updateFilter("department", e.target.value)}
              >
                <option value="">All Departments</option>
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Start Date">
              <Input
                className="text-xs"
                type="date"
                value={params.get("dueFrom") ?? ""}
                onChange={(e) => updateFilter("dueFrom", e.target.value)}
              />
            </Field>

            <Field label="End Date">
              <Input
                className="text-xs"
                type="date"
                value={params.get("dueTo") ?? ""}
                onChange={(e) => updateFilter("dueTo", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">
              Showing {capas.length} of {data?.total ?? 0} Master CAPA records
            </span>
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-slate-600"
              onClick={clearFilters}
            >
              <FilterX className="mr-1.5 h-3.5 w-3.5" />
              Reset Filters
            </Button>
          </div>
        </SectionCard>

        <SectionCard>
          <DataTable<CapaItem>
            rows={capas}
            rowKey={(item) => item._id}
            columns={columns}
            isLoading={isLoading}
            error={error}
            emptyTitle="No Master CAPA records found"
            emptyDescription="Try clearing search keywords or filter dropdowns."
          />

          {data && data.totalPages > 1 && (
            <div className="pt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                pageSize={data.pageSize}
                onPageChange={(p) => updateFilter("page", String(p))}
              />
            </div>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
export default CapaMasterPage;
