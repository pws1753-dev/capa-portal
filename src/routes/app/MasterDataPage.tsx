import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES } from "@shared/constants/permissions";
import { passwordSchema } from "@shared/schemas/auth";
import {
  Building2,
  CheckCircle2,
  CircleOff,
  Clock3,
  FileKey2,
  KeyRound,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  UserCheck,
  UserPlus,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MasterEditModal, type EditTarget } from "@/components/admin/MasterEditModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionCard } from "@/components/ui/Cards";
import { Field, Select, Spinner } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Toggle } from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/toast-context";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useConfiguration, useMasterBootstrap, usePermissions, useSystemUsers } from "@/services/queries";


/**
 * Column order for the permission matrix, grouped the way the roles grid reads:
 * the blanket grant first, then visibility, reporting, and the workflow permissions.
 */
const PERMISSION_COLUMNS: { group: string; keys: string[] }[] = [
  { group: "Admin", keys: ["*"] },
  { group: "View", keys: ["view.all", "view.company", "dash.all"] },
  { group: "Reports", keys: ["report.all", "export.all"] },
  {
    group: "Complaints",
    keys: [
      "complaint.create",
      "complaint.edit",
      "complaint.edit.own",
      "complaint.edit.dept",
      "complaint.assign",
      "complaint.close",
      "complaint.delete"
    ]
  },
  { group: "CAPA", keys: ["capa.edit.own", "capa.approve.dept", "capa.verify", "capa.evidence.review"] },
  { group: "8D & Audit", keys: ["8d.approve", "audit.view"] }
];

/**
 * Hover copy for each permission code. The seeded Permission rows carry the key as
 * their label, so without this the matrix would only ever explain a code by repeating it.
 */
const PERMISSION_HINTS: Record<string, string> = {
  "*": "Full system access, including user and role management",
  "view.all": "See complaints and CAPAs across every company",
  "view.company": "See records for the companies this user is assigned to",
  "dash.all": "Open the full dashboard rather than only a personal view",
  "report.all": "Run every report",
  "export.all": "Export registers to Excel and PDF",
  "complaint.create": "Register a new complaint",
  "complaint.edit": "Edit any complaint in scope",
  "complaint.edit.own": "Edit only complaints this user owns",
  "complaint.edit.dept": "Edit complaints assigned to this user's department",
  "complaint.assign": "Assign a complaint owner or responsible department",
  "complaint.close": "Close a complaint",
  "complaint.delete": "Delete a complaint",
  "capa.edit.own": "Edit CAPA actions this user owns",
  "capa.approve.dept": "Approve CAPA actions raised against this user's department",
  "capa.verify": "Verify a completed CAPA action",
  "capa.evidence.review": "Review the evidence attached to a CAPA",
  "8d.approve": "Approve an 8D report",
  "audit.view": "Read the audit trail"
};
type MasterTab =
  | "companies"
  | "departments"
  | "employees"
  | "users"
  | "roles"
  | "categories"
  | "priorities"
  | "tat"
  | "delay"
  | "rootCause"
  | "escalation"
  | "numbering";

type EditableConfiguration = {
  tat: Record<string, number>;
  escalation: { levels: { level: number; name: string; triggerHoursOverdue: number }[]; reminderPercentages: number[]; active?: boolean; autoEmailEnabled?: boolean; frequencyDays?: number };
  numbering?: {
    prefix?: string;
    sequencePadding?: number;
    capaSequencePadding?: number;
    resetOnFinancialYear?: boolean;
    active?: boolean;
  } | null;
  delayReasons: string[];
  delayReasonItems?: { _id: string; name: string; order?: number; active?: boolean }[];
  categories: { _id: string; name: string; complaintType: "External" | "Internal"; parent: string | null; order?: number; active?: boolean }[];
  priorities: { _id: string; name: string; color: string; tatMultiplier: number; order?: number; active?: boolean }[];
  rootCauseCategories: { _id: string; name: string; order?: number; active?: boolean }[];
};

type TatForm = {
  ackHours: number;
  containmentDays: number;
  rcaDays: number;
  capaDays: number;
  d3ContainmentDays: number;
  d5CorrectiveActionDays: number;
  d6VerificationDays: number;
  d7ShortTermDays: number;
  d7LongTermDays: number;
  repeatWindowDays: number;
  dueSoonHours: number;
};

const DEFAULT_TAT: TatForm = {
  ackHours: 24,
  containmentDays: 2,
  rcaDays: 7,
  capaDays: 14,
  d3ContainmentDays: 2,
  d5CorrectiveActionDays: 14,
  d6VerificationDays: 7,
  d7ShortTermDays: 60,
  d7LongTermDays: 90,
  repeatWindowDays: 60,
  dueSoonHours: 24
};

const TABS: { key: MasterTab; label: string; icon: typeof Building2 }[] = [
  { key: "companies", label: "Companies", icon: Building2 },
  { key: "departments", label: "Departments", icon: Users },
  { key: "employees", label: "Employees", icon: UserCheck },
  { key: "users", label: "System Users", icon: KeyRound },
  { key: "roles", label: "Roles & RBAC", icon: ShieldCheck },
  { key: "categories", label: "Categories", icon: Tags },
  { key: "priorities", label: "Priorities", icon: SlidersHorizontal },
  { key: "tat", label: "TAT", icon: Clock3 },
  { key: "delay", label: "Delay Reasons", icon: ListChecks },
  { key: "rootCause", label: "Root Cause", icon: Route },
  { key: "escalation", label: "Escalation", icon: ShieldCheck },
  { key: "numbering", label: "Numbering", icon: FileKey2 }
];



/** Edit / activate / delete, rendered the same way beside every master record. */
function RecordActions({
  active,
  busy,
  onEdit,
  onToggle,
  onDelete,
  className
}: {
  active?: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle?: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <Button type="button" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
      {onToggle ? (
        <Button type="button" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onToggle}>
          {active ? <CircleOff className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {active ? "Deactivate" : "Activate"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="h-7 text-xs text-brand-red hover:bg-red-50 hover:text-brand-redDark"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
    </div>
  );
}

type SimpleListItem = { _id: string; name: string; order?: number; active?: boolean };

/** Delay reasons and root cause categories are the same shape, so they share one row. */
function SimpleListRow({
  item,
  list,
  busy,
  onEdit,
  onToggle,
  onDelete,
  refresh
}: {
  item: SimpleListItem;
  list: "delay-reasons" | "root-cause-categories";
  busy: boolean;
  onEdit: (target: EditTarget) => void;
  onToggle: (path: string, active: boolean) => void;
  onDelete: (target: { name: string; endpoint: string; warning: string; refresh: () => void }) => void;
  refresh: () => void;
}) {
  const endpoint = `/api/configuration/lists/${list}/${item._id}`;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{item.name}</span>
        <StatusBadge tone={item.active ? "green" : "neutral"}>{item.active ? "Active" : "Inactive"}</StatusBadge>
      </div>
      <RecordActions
        className="mt-2"
        active={item.active}
        busy={busy}
        onEdit={() =>
          onEdit({
            title: `Edit ${item.name}`,
            endpoint,
            refresh,
            values: { name: item.name, order: item.order ?? 0 },
            fields: [
              { key: "name", label: "Name", required: true },
              { key: "order", label: "Display Order", type: "number" }
            ]
          })
        }
        onToggle={() => onToggle(endpoint, !item.active)}
        onDelete={() =>
          onDelete({
            name: item.name,
            endpoint,
            warning: "Records that already used this reason keep it as text, so they stay readable.",
            refresh
          })
        }
      />
    </div>
  );
}
export function MasterDataPage() {
  const toast = useToast();
  const permissions = usePermissions();
  const master = useMasterBootstrap("full");
  const usersQuery = useSystemUsers(permissions.isMasterAdmin);
  const [activeTab, setActiveTab] = useState<MasterTab>("companies");
  const [selectedCompany, setSelectedCompany] = useState("");
  const configurationQuery = useConfiguration(selectedCompany || undefined);
  const configuration = configurationQuery.data as EditableConfiguration | undefined;

  const [companyModal, setCompanyModal] = useState(false);
  const [departmentModal, setDepartmentModal] = useState(false);
  const [employeeModal, setEmployeeModal] = useState(false);
  const [userModal, setUserModal] = useState(false);

  const [companyForm, setCompanyForm] = useState({ name: "", code: "", complaintNumberingPrefix: "" });
  const [departmentForm, setDepartmentForm] = useState({ name: "", code: "", company: "", managementEmails: "" });
  const [employeeForm, setEmployeeForm] = useState({
    employeeCode: "",
    name: "",
    email: "",
    designation: "",
    department: "",
    company: "",
    managerName: "",
    managerEmail: "",
    hodName: "",
    hodEmail: ""
  });
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    role: "",
    companyIds: [] as string[],
    department: "",
    forcePasswordChange: true
  });
  const [categoryForm, setCategoryForm] = useState({ name: "", complaintType: "External" as "External" | "Internal", order: 0 });
  const [priorityForm, setPriorityForm] = useState({ name: "", color: "#64748B", tatMultiplier: 1, order: 0 });
  const [delayReasonName, setDelayReasonName] = useState("");
  const [rootCauseName, setRootCauseName] = useState("");
  const [tatForm, setTatForm] = useState<TatForm>(DEFAULT_TAT);
  const [reminderPercentages, setReminderPercentages] = useState("50,75,90");
  const [escalationLevels, setEscalationLevels] = useState([
    { level: 1, name: "Owner", triggerHoursOverdue: 0 },
    { level: 2, name: "Department Head", triggerHoursOverdue: 24 },
    { level: 3, name: "Quality Head", triggerHoursOverdue: 72 },
    { level: 4, name: "Management", triggerHoursOverdue: 168 }
  ]);
  const [numberingForm, setNumberingForm] = useState({ prefix: "CMP", sequencePadding: 5, capaSequencePadding: 2, resetOnFinancialYear: true });
  const [saving, setSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; endpoint: string; warning: string; refresh: () => void } | null>(null);
  const [resetRolesOpen, setResetRolesOpen] = useState(false);
  const [grantAllTo, setGrantAllTo] = useState<{ id: string; name: string; permissions: string[] } | null>(null);

  const companies = useMemo(() => master.data?.companies ?? [], [master.data?.companies]);
  const departments = useMemo(() => master.data?.departments ?? [], [master.data?.departments]);

  // The server sorts roles alphabetically, which puts Auditor above Master Admin. The
  // matrix reads as a privilege ladder, so it follows the declared role order instead.
  const roles = useMemo(() => {
    const rank = (name: string) => {
      const index = (ROLE_NAMES as readonly string[]).indexOf(name);
      return index === -1 ? ROLE_NAMES.length : index;
    };
    return [...(master.data?.roles ?? [])].sort((left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name));
  }, [master.data?.roles]);
  const employees = useMemo(() => master.data?.employees ?? [], [master.data?.employees]);
  const permissionsList = useMemo(() => master.data?.permissions ?? [], [master.data?.permissions]);
  const systemUsers = usersQuery.data?.users ?? [];

  useEffect(() => {
    if (!selectedCompany && companies.length) setSelectedCompany(companies[0]._id);
  }, [companies, selectedCompany]);

  useEffect(() => {
    if (!configuration) return;
    const tat = configuration.tat || {};
    setTatForm({
      ackHours: Number(tat.ackHours ?? DEFAULT_TAT.ackHours),
      containmentDays: Number(tat.containmentDays ?? DEFAULT_TAT.containmentDays),
      rcaDays: Number(tat.rcaDays ?? DEFAULT_TAT.rcaDays),
      capaDays: Number(tat.capaDays ?? DEFAULT_TAT.capaDays),
      d3ContainmentDays: Number(tat.d3ContainmentDays ?? DEFAULT_TAT.d3ContainmentDays),
      d5CorrectiveActionDays: Number(tat.d5CorrectiveActionDays ?? DEFAULT_TAT.d5CorrectiveActionDays),
      d6VerificationDays: Number(tat.d6VerificationDays ?? DEFAULT_TAT.d6VerificationDays),
      d7ShortTermDays: Number(tat.d7ShortTermDays ?? DEFAULT_TAT.d7ShortTermDays),
      d7LongTermDays: Number(tat.d7LongTermDays ?? DEFAULT_TAT.d7LongTermDays),
      repeatWindowDays: Number(tat.repeatWindowDays ?? DEFAULT_TAT.repeatWindowDays),
      dueSoonHours: Number(tat.dueSoonHours ?? DEFAULT_TAT.dueSoonHours)
    });
    if (configuration.escalation?.levels?.length) setEscalationLevels(configuration.escalation.levels);
    if (configuration.escalation?.reminderPercentages?.length) setReminderPercentages(configuration.escalation.reminderPercentages.join(","));
    if (configuration.numbering) {
      setNumberingForm({
        prefix: configuration.numbering.prefix || "CMP",
        sequencePadding: Number(configuration.numbering.sequencePadding ?? 5),
        capaSequencePadding: Number(configuration.numbering.capaSequencePadding ?? 2),
        resetOnFinancialYear: configuration.numbering.resetOnFinancialYear !== false
      });
    } else {
      const company = companies.find((item) => item._id === selectedCompany);
      setNumberingForm({ prefix: company?.complaintNumberingPrefix || "CMP", sequencePadding: 5, capaSequencePadding: 2, resetOnFinancialYear: true });
    }
  }, [configuration, companies, selectedCompany]);

  // Column order for the permission matrix. Anything the server knows about but this
  // list does not is appended under "Other", so a newly added permission is never
  // silently missing from the grid.
  const columnGroups = useMemo(() => {
    const declared = PERMISSION_COLUMNS.map((entry) => ({
      group: entry.group,
      keys: entry.keys.filter((key) => key === "*" || (PERMISSIONS as readonly string[]).includes(key))
    })).filter((entry) => entry.keys.length > 0);
    const covered = new Set(declared.flatMap((entry) => entry.keys));
    const extra = (PERMISSIONS as readonly string[]).filter((key) => !covered.has(key));
    return extra.length > 0 ? [...declared, { group: "Other", keys: extra }] : declared;
  }, []);

  const permissionLabels = useMemo(
    () => new Map(permissionsList.map((item) => [item.key, item.label || item.key])),
    [permissionsList]
  );

  async function run<T>(work: () => Promise<T>, success: string, after?: () => void) {
    setSaving(true);
    try {
      await work();
      toast.success(success);
      after?.();
    } catch (error) {
      toast.failure(error, "The requested change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshMaster() {
    await Promise.all([master.refetch(), usersQuery.refetch()]);
  }

  async function handleCompanySubmit() {
    if (!companyForm.name || !companyForm.code || companyForm.complaintNumberingPrefix.length < 2) {
      toast.error("Company name, code and a numbering prefix are required.");
      return;
    }
    await run(
      () => api("/api/master/companies", { method: "POST", body: JSON.stringify({ ...companyForm, active: true }) }),
      "Company created",
      () => {
        setCompanyModal(false);
        setCompanyForm({ name: "", code: "", complaintNumberingPrefix: "" });
        void refreshMaster();
      }
    );
  }

  async function handleDepartmentSubmit() {
    if (!departmentForm.name) return toast.error("Department name is required.");
    const body = { name: departmentForm.name, code: departmentForm.code, managementEmails: departmentForm.managementEmails, active: true, ...(departmentForm.company ? { company: departmentForm.company } : {}) };
    await run(() => api("/api/master/departments", { method: "POST", body: JSON.stringify(body) }), "Department created", () => {
      setDepartmentModal(false);
      setDepartmentForm({ name: "", code: "", company: "", managementEmails: "" });
      void refreshMaster();
    });
  }

  async function handleEmployeeSubmit() {
    if (!employeeForm.employeeCode || !employeeForm.name || !employeeForm.department || !employeeForm.company) {
      return toast.error("Employee code, name, company and department are required.");
    }
    await run(() => api("/api/master/employees", { method: "POST", body: JSON.stringify({ ...employeeForm, active: true }) }), "Employee created", () => {
      setEmployeeModal(false);
      setEmployeeForm({ employeeCode: "", name: "", email: "", designation: "", department: "", company: "", managerName: "", managerEmail: "", hodName: "", hodEmail: "" });
      void refreshMaster();
    });
  }

  async function handleUserSubmit() {
    if (!userForm.name || !userForm.username || !userForm.password || !userForm.role) {
      return toast.error("Name, username, temporary password and role are required.");
    }
    // Mirror the server's password rule so the reason is immediate rather than a round trip.
    const password = passwordSchema.safeParse(userForm.password);
    if (!password.success) return toast.error("Temporary password is not strong enough", password.error.issues[0]?.message);

    // department is an optional ObjectId server-side, and "" fails that check. Spreading
    // userForm put the empty string in the body regardless, so creating a user with no
    // department always came back as a bare "Validation failed".
    const { department, ...rest } = userForm;
    const body = {
      ...rest,
      active: true,
      forcePasswordChange: true,
      ...(department ? { department } : {})
    };
    await run(() => api("/api/master/users", { method: "POST", body: JSON.stringify(body) }), "User account created", () => {
      setUserModal(false);
      setUserForm({ name: "", email: "", username: "", password: "", role: "", companyIds: [], department: "", forcePasswordChange: true });
      void refreshMaster();
    });
  }

  async function handleResetAccess(userId: string, userName: string) {
    await run(
      () => api<{ reset: boolean; emailed: boolean }>(`/api/master/users/${userId}/reset-access`, { method: "POST" }),
      `Secure reset initiated for ${userName}`,
      () => void usersQuery.refetch()
    );
  }


  /**
   * Master records are edited and deleted through one pair of handlers; each caller only
   * describes the record. Deletion is refused server-side while anything still references
   * the row, so the dialog says what that means rather than promising it will work.
   */
  async function saveMasterEdit(target: EditTarget, body: Record<string, string | number>) {
    const payload = { ...body };
    if (target.endpoint.includes("/api/master/users/") && payload.department === "") {
      delete payload.department;
    }
    await run(() => api(target.endpoint, { method: "PATCH", body: JSON.stringify(payload) }), "Record updated", () => {
      target.refresh();
      setEditTarget(null);
    });
  }

  async function deleteMasterRecord() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await run(() => api(target.endpoint, { method: "DELETE" }), `${target.name} deleted`, () => {
      target.refresh();
      setDeleteTarget(null);
    });
  }
  async function toggleMasterRecord(kind: "companies" | "departments" | "employees", id: string, active: boolean) {
    await run(() => api(`/api/master/${kind}/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }), active ? "Record activated" : "Record deactivated", () => void refreshMaster());
  }

  async function toggleUser(userId: string, active: boolean) {
    await run(() => api(`/api/master/users/${userId}`, { method: "PATCH", body: JSON.stringify({ active }) }), active ? "User activated" : "User deactivated", () => void usersQuery.refetch());
  }

  async function toggleRolePermission(roleId: string, current: string[], permission: string) {
    const next = current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission];
    if (!next.length) return toast.error("A role must retain at least one permission.");
    await run(() => api(`/api/master/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({ permissions: next }) }), "Role permissions updated", () => void master.refetch());
  }

  /**
   * Granting "*" hands a role every permission there is, including the ones that manage
   * this matrix, so it asks first. Every other switch applies straight away.
   */
  function requestPermissionToggle(roleId: string, roleName: string, current: string[], permission: string) {
    if (permission === "*" && !current.includes("*")) {
      setGrantAllTo({ id: roleId, name: roleName, permissions: current });
      return;
    }
    void toggleRolePermission(roleId, current, permission);
  }

  /**
   * Puts every role back to the shipped permission set. The seed endpoint only fills in
   * roles that do not exist yet, so each role is patched directly.
   */
  async function resetRolesToDefaults() {
    const known = roles.filter((role) => role.name in DEFAULT_ROLE_PERMISSIONS);
    if (known.length === 0) return toast.error("No standard role was found to reset.");
    await run(
      async () => {
        for (const role of known) {
          const defaults = DEFAULT_ROLE_PERMISSIONS[role.name as keyof typeof DEFAULT_ROLE_PERMISSIONS];
          await api(`/api/master/roles/${role._id}`, { method: "PATCH", body: JSON.stringify({ permissions: defaults }) });
        }
      },
      `Reset ${known.length} roles to their default permissions`,
      () => void master.refetch()
    );
  }

  async function saveTat() {
    await run(() => api("/api/configuration/tat", { method: "PUT", body: JSON.stringify({ company: selectedCompany || null, ...tatForm }) }), "TAT configuration saved", () => void configurationQuery.refetch());
  }

  async function saveEscalation() {
    const percentages = reminderPercentages.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0 && item <= 100);
    if (!percentages.length) return toast.error("Enter at least one valid reminder percentage from 1 to 100.");
    await run(() => api("/api/configuration/escalation", { method: "PUT", body: JSON.stringify({ company: selectedCompany || null, levels: escalationLevels, reminderPercentages: percentages, active: true, autoEmailEnabled: configurationQuery.data?.escalation?.autoEmailEnabled ?? true, frequencyDays: configurationQuery.data?.escalation?.frequencyDays ?? 7 }) }), "Escalation configuration saved", () => void configurationQuery.refetch());
  }

  async function saveNumbering() {
    if (!selectedCompany) return toast.error("Select a company first.");
    await run(() => api("/api/configuration/numbering", { method: "PUT", body: JSON.stringify({ company: selectedCompany, ...numberingForm, active: true }) }), "Numbering configuration saved", () => void configurationQuery.refetch());
  }

  async function addCategory() {
    if (!categoryForm.name.trim()) return toast.error("Category name is required.");
    await run(() => api("/api/configuration/categories", { method: "POST", body: JSON.stringify({ ...categoryForm, parent: null, active: true }) }), "Category added", () => {
      setCategoryForm({ name: "", complaintType: "External", order: 0 });
      void configurationQuery.refetch();
    });
  }

  async function addPriority() {
    if (!priorityForm.name.trim()) return toast.error("Priority name is required.");
    await run(() => api("/api/configuration/priorities", { method: "POST", body: JSON.stringify({ ...priorityForm, active: true }) }), "Priority added", () => {
      setPriorityForm({ name: "", color: "#64748B", tatMultiplier: 1, order: 0 });
      void configurationQuery.refetch();
    });
  }

  async function addSimpleList(list: "delay-reasons" | "root-cause-categories", name: string, clear: () => void) {
    if (!name.trim()) return toast.error("A name is required.");
    await run(() => api(`/api/configuration/lists/${list}`, { method: "POST", body: JSON.stringify({ name: name.trim(), order: 0, active: true }) }), "Configuration item added", () => {
      clear();
      void configurationQuery.refetch();
    });
  }

  /** Configuration list items can be brought back, not only retired. */
  async function toggleConfigRecord(path: string, active: boolean) {
    await run(
      () => api(path, { method: "PATCH", body: JSON.stringify({ active }) }),
      active ? "Item activated" : "Item deactivated",
      () => void configurationQuery.refetch()
    );
  }

  if (!permissions.isMasterAdmin) {
    return (
      <main className="space-y-6 pb-12">
        <PageHeader title="Master Data & Governance" description="Administration access is restricted to Master Admin." />
        <div className="px-4 sm:px-6"><div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to modify master data.</div></div>
      </main>
    );
  }

  return (
    <main className="space-y-6 pb-12">
      <PageHeader title="Master Data & Governance" description="Database-backed administration for organization, users, workflow masters, SLA targets, escalation and numbering." />
      <div className="space-y-6 px-4 sm:px-6">
        <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} type="button" className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${activeTab === tab.key ? "bg-brand-red text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} onClick={() => setActiveTab(tab.key)}>
                <Icon className="h-4 w-4" /><span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {(master.isLoading || (selectedCompany && configurationQuery.isLoading)) && <Spinner label="Loading governance data..." />}

        {activeTab === "companies" && (
          <SectionCard title="Operating Companies" description="Company scope, document ownership and complaint-number prefix." actions={<Button type="button" onClick={() => setCompanyModal(true)}><Plus className="h-4 w-4" />Add Company</Button>}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {companies.map((co) => (
                <div key={co._id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-bold text-slate-500">{co.code}</p>
                      <h3 className="mt-1 font-bold text-slate-900">{co.name}</h3>
                      <p className="mt-2 text-xs text-slate-500">Complaint prefix: {co.complaintNumberingPrefix || "Not configured"}</p>
                    </div>
                    <StatusBadge tone={co.active ? "green" : "neutral"}>{co.active ? "Active" : "Inactive"}</StatusBadge>
                  </div>
                  <RecordActions
                    className="mt-3"
                    active={co.active}
                    busy={saving}
                    onEdit={() =>
                      setEditTarget({
                        title: `Edit ${co.name}`,
                        endpoint: `/api/master/companies/${co._id}`,
                        refresh: refreshMaster,
                        values: { name: co.name, code: co.code, complaintNumberingPrefix: co.complaintNumberingPrefix ?? "" },
                        fields: [
                          { key: "name", label: "Company Legal Name", required: true },
                          { key: "code", label: "Company Code", required: true, uppercase: true },
                          { key: "complaintNumberingPrefix", label: "Complaint Number Prefix", required: true, uppercase: true }
                        ]
                      })
                    }
                    onToggle={() => toggleMasterRecord("companies", co._id, !co.active)}
                    onDelete={() =>
                      setDeleteTarget({
                        name: co.name,
                        endpoint: `/api/master/companies/${co._id}`,
                        warning: "Its complaints, CAPAs, employees and user assignments would lose the company they belong to.",
                        refresh: refreshMaster
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "departments" && (
          <SectionCard title="Departments" description="Organizational ownership used by complaints, CAPAs and escalation." actions={<Button type="button" onClick={() => setDepartmentModal(true)}><Plus className="h-4 w-4" />Add Department</Button>}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {departments.map((dept) => (
                <div key={dept._id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex justify-between gap-2">
                    <p className="font-semibold text-slate-900">{dept.name}</p>
                    <StatusBadge tone={dept.active ? "green" : "neutral"}>{dept.active ? "Active" : "Inactive"}</StatusBadge>
                  </div>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    <span className="font-semibold">Mgmt CC:</span> {dept.managementEmails || "—"}
                  </p>
                  <RecordActions
                    className="mt-2"
                    active={dept.active}
                    busy={saving}
                    onEdit={() =>
                      setEditTarget({
                        title: `Edit ${dept.name}`,
                        endpoint: `/api/master/departments/${dept._id}`,
                        refresh: refreshMaster,
                        values: { name: dept.name, code: dept.code ?? "", managementEmails: dept.managementEmails ?? "" },
                        fields: [
                          { key: "name", label: "Department Name", required: true },
                          { key: "code", label: "Department Code", uppercase: true },
                          { key: "managementEmails", label: "Management emails (always CC)", placeholder: "name@onepws.com, name2@onepws.com" }
                        ]
                      })
                    }
                    onToggle={() => toggleMasterRecord("departments", dept._id, !dept.active)}
                    onDelete={() =>
                      setDeleteTarget({
                        name: dept.name,
                        endpoint: `/api/master/departments/${dept._id}`,
                        warning: "Complaints, CAPAs and employees pointing at it would lose their department.",
                        refresh: refreshMaster
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "employees" && (
          <SectionCard title="Employee Directory" description="Source directory for 8D teams, ownership, sign-off snapshots, Manager and HOD routing." actions={<Button type="button" onClick={() => setEmployeeModal(true)}><Plus className="h-4 w-4" />Add Employee</Button>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="p-3">Employee</th>
                    <th>Code</th>
                    <th>Designation</th>
                    <th>Email</th>
                    <th>Department</th>
                    <th>Manager Email</th>
                    <th>HOD Email</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr key={employee._id} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-900">{employee.name}</td>
                      <td className="font-mono">{employee.employeeCode}</td>
                      <td>{employee.designation || "—"}</td>
                      <td>{employee.email || "—"}</td>
                      <td>{departments.find((d) => d._id === employee.department)?.name || "—"}</td>
                      <td className="max-w-[220px] break-words">{employee.managerEmail ? employee.managerEmail.split(/[,;]\s*/).map((mail) => <div key={mail}>{mail}</div>) : "—"}</td>
                      <td className="max-w-[220px] break-words">{employee.hodEmail ? employee.hodEmail.split(/[,;]\s*/).map((mail) => <div key={mail}>{mail}</div>) : "—"}</td>
                      <td>
                        <StatusBadge tone={employee.active ? "green" : "neutral"}>{employee.active ? "Active" : "Inactive"}</StatusBadge>
                      </td>
                      <td className="text-right">
                        <RecordActions
                          className="justify-end"
                          active={employee.active}
                          busy={saving}
                          onEdit={() =>
                            setEditTarget({
                              title: `Edit ${employee.name}`,
                              endpoint: `/api/master/employees/${employee._id}`,
                              refresh: refreshMaster,
                              values: {
                                name: employee.name,
                                employeeCode: employee.employeeCode,
                                email: employee.email ?? "",
                                designation: employee.designation ?? "",
                                department: employee.department ?? "",
                                managerName: employee.managerName ?? "",
                                managerEmail: employee.managerEmail ?? "",
                                hodName: employee.hodName ?? "",
                                hodEmail: employee.hodEmail ?? ""
                              },
                              fields: [
                                { key: "name", label: "Full Name", required: true },
                                { key: "employeeCode", label: "Employee Code", required: true },
                                { key: "email", label: "Email", type: "email" },
                                { key: "designation", label: "Designation" },
                                {
                                  key: "department",
                                  label: "Department",
                                  type: "select",
                                  required: true,
                                  options: departments.filter((d) => d.active).map((d) => ({ value: d._id, label: d.name }))
                                },
                                { key: "managerName", label: "Manager Name" },
                                { key: "managerEmail", label: "Manager Email", placeholder: "a@onepws.com, b@onepws.com" },
                                { key: "hodName", label: "HOD Name" },
                                { key: "hodEmail", label: "HOD Email", placeholder: "a@onepws.com; b@onepws.com" }
                              ]
                            })
                          }
                          // Activating was previously impossible here: the button always sent active:false.
                          onToggle={() => toggleMasterRecord("employees", employee._id, !employee.active)}
                          onDelete={() =>
                            setDeleteTarget({
                              name: employee.name,
                              endpoint: `/api/master/employees/${employee._id}`,
                              warning: "Any portal user linked to this employee record would lose that link.",
                              refresh: refreshMaster
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {activeTab === "users" && (
          <SectionCard title="System Users" description="Authenticated portal accounts. Existing passwords are never displayed." actions={<Button type="button" onClick={() => setUserModal(true)}><UserPlus className="h-4 w-4" />New User</Button>}>
            {usersQuery.isLoading ? (
              <Spinner label="Loading users..." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="p-3">User</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Department Name</th>
                      <th>Status</th>
                      <th>Password</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemUsers.map((user) => (
                      <tr key={user.id} className="border-b border-slate-100">
                        <td className="p-3">
                          <p className="font-semibold text-slate-900">{user.name}</p>
                          <p className="text-slate-500">{user.email || "No email"}</p>
                        </td>
                        <td className="font-mono">{user.username}</td>
                        <td>{user.role?.name || "—"}</td>
                        <td>{departments.find((department) => department._id === user.department)?.name || "—"}</td>
                        <td>
                          <StatusBadge tone={user.active ? "green" : "neutral"}>{user.active ? "Active" : "Inactive"}</StatusBadge>
                        </td>
                        <td>
                          {user.forcePasswordChange ? (
                            <span className="font-semibold text-amber-700">Change required</span>
                          ) : (
                            <span className="text-slate-500">Protected</span>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={saving}
                              onClick={() => handleResetAccess(user.id, user.name)}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Reset access
                            </Button>
                            <RecordActions
                              active={user.active}
                              busy={saving}
                              onEdit={() =>
                                setEditTarget({
                                  title: `Edit ${user.name}`,
                                  endpoint: `/api/master/users/${user.id}`,
                                  refresh: () => void usersQuery.refetch(),
                                  values: { name: user.name, email: user.email ?? "", role: user.role?.id ?? "", department: user.department ?? "" },
                                  fields: [
                                    { key: "name", label: "Full Name", required: true },
                                    { key: "email", label: "Email", type: "email" },
                                    {
                                      key: "role",
                                      label: "Role",
                                      type: "select",
                                      required: true,
                                      options: roles.filter((r) => r.active).map((r) => ({ value: r._id, label: r.name }))
                                    },
                                    {
                                      key: "department",
                                      label: "Department Name",
                                      type: "select",
                                      options: [
                                        { value: "", label: "No department" },
                                        ...departments.filter((d) => d.active).map((d) => ({ value: d._id, label: d.name }))
                                      ]
                                    }
                                  ]
                                })
                              }
                              onToggle={() => toggleUser(user.id, !user.active)}
                              onDelete={() =>
                                setDeleteTarget({
                                  name: user.name,
                                  endpoint: `/api/master/users/${user.id}`,
                                  warning:
                                    "A user who has signed anything is kept for the audit trail and cannot be deleted - deactivate them instead.",
                                  refresh: () => void usersQuery.refetch()
                                })
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}

        {activeTab === "roles" && (
          <SectionCard
            title="Roles & Permissions"
            description="Server-enforced permission matrix. Changes are written to MongoDB and audited."
            actions={
              <Button type="button" variant="secondary" className="text-xs" disabled={saving} onClick={() => setResetRolesOpen(true)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Reset to defaults
              </Button>
            }
          >
            <div className="rounded-lg border-l-4 border-brand-red bg-red-50/60 px-3 py-2 text-xs text-slate-700">
              <span className="font-bold">How it works:</span> each row is a role, each column is a permission. Turn a switch on to
              grant it, off to revoke it. Hover a permission code for its meaning.
            </div>

            <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200">
              <table className="w-full min-w-max border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 w-48 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600"
                    >
                      Role
                    </th>
                    {columnGroups.map((group) => (
                      <th
                        key={group.group}
                        colSpan={group.keys.length}
                        className="border-b border-l border-slate-200 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
                      >
                        {group.group}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    {columnGroups.flatMap((group) =>
                      group.keys.map((key, position) => (
                        <th
                          key={key}
                          title={PERMISSION_HINTS[key] ?? permissionLabels.get(key) ?? key}
                          className={cn(
                            "border-b border-slate-200 px-3 pb-2 text-center font-mono text-[10px] font-semibold uppercase text-slate-500",
                            position === 0 && "border-l"
                          )}
                        >
                          {key}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role, rowIndex) => {
                    // A role holding "*" already implies every permission, so the row is shown
                    // fully granted and locked - the matrix must not be a way to strip the only
                    // account that can put it back.
                    const isProtected = role.permissions.includes("*");
                    return (
                      <tr key={role._id} className={cn("border-t border-slate-100", rowIndex % 2 === 1 && "bg-slate-50/50")}>
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 border-r border-slate-200 px-3 py-2.5 text-left align-middle",
                            rowIndex % 2 === 1 ? "bg-slate-50" : "bg-white"
                          )}
                        >
                          <span className="block text-sm font-bold text-slate-900">{role.name}</span>
                          <span className="block text-[11px] font-semibold text-slate-400">
                            {isProtected ? "Protected" : `${role.permissions.length} permissions`}
                          </span>
                        </th>
                        {columnGroups.flatMap((group) =>
                          group.keys.map((key, position) => (
                            <td
                              key={key}
                              className={cn("px-3 py-2.5 text-center align-middle", position === 0 && "border-l border-slate-200")}
                            >
                              <Toggle
                                checked={isProtected || role.permissions.includes(key)}
                                disabled={isProtected || saving}
                                label={`${key} for ${role.name}`}
                                title={PERMISSION_HINTS[key] ?? permissionLabels.get(key) ?? key}
                                onChange={() => void requestPermissionToggle(role._id, role.name, role.permissions, key)}
                              />
                            </td>
                          ))
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Changes save immediately. Affected users need to sign in again, or refresh, before an updated permission takes effect.
            </p>
          </SectionCard>
        )}

        {activeTab === "categories" && (
          <SectionCard title="Complaint Categories" description="Database-driven External and Internal complaint categories.">
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_180px_100px_auto]">
              <Input placeholder="Category name" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}/>
              <Select value={categoryForm.complaintType} onChange={(e) => setCategoryForm({ ...categoryForm, complaintType: e.target.value as "External" | "Internal" })}>
                <option>External</option>
                <option>Internal</option>
              </Select>
              <Input type="number" value={categoryForm.order} onChange={(e) => setCategoryForm({ ...categoryForm, order: Number(e.target.value) })}/>
              <Button type="button" onClick={addCategory}><Plus className="h-4 w-4" />Add</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {configuration?.categories.map((item) => (
                <div key={item._id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.complaintType}</p>
                    </div>
                    <StatusBadge tone={item.active ? "green" : "neutral"}>{item.active ? "Active" : "Inactive"}</StatusBadge>
                  </div>
                  <RecordActions
                    className="mt-2"
                    active={item.active}
                    busy={saving}
                    onEdit={() =>
                      setEditTarget({
                        title: `Edit ${item.name}`,
                        endpoint: `/api/configuration/categories/${item._id}`,
                        refresh: () => void configurationQuery.refetch(),
                        values: { name: item.name, complaintType: item.complaintType, order: item.order ?? 0 },
                        fields: [
                          { key: "name", label: "Category Name", required: true },
                          {
                            key: "complaintType",
                            label: "Complaint Type",
                            type: "select",
                            required: true,
                            options: [
                              { value: "External", label: "External" },
                              { value: "Internal", label: "Internal" }
                            ]
                          },
                          { key: "order", label: "Display Order", type: "number" }
                        ]
                      })
                    }
                    onToggle={() => toggleConfigRecord(`/api/configuration/categories/${item._id}`, !item.active)}
                    onDelete={() =>
                      setDeleteTarget({
                        name: item.name,
                        endpoint: `/api/configuration/categories/${item._id}`,
                        warning:
                          "Complaints keep their category as text, so existing records stay readable - this only retires the option.",
                        refresh: () => void configurationQuery.refetch()
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "priorities" && (
          <SectionCard title="Priorities" description="Priority labels, visual indicator and TAT multiplier.">
            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_120px_130px_90px_auto]">
              <Input placeholder="Priority name" value={priorityForm.name} onChange={(e) => setPriorityForm({ ...priorityForm, name: e.target.value })}/>
              <Input type="color" value={priorityForm.color} onChange={(e) => setPriorityForm({ ...priorityForm, color: e.target.value })}/>
              <Input type="number" step="0.05" value={priorityForm.tatMultiplier} onChange={(e) => setPriorityForm({ ...priorityForm, tatMultiplier: Number(e.target.value) })}/>
              <Input type="number" value={priorityForm.order} onChange={(e) => setPriorityForm({ ...priorityForm, order: Number(e.target.value) })}/>
              <Button type="button" onClick={addPriority}><Plus className="h-4 w-4" />Add</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {configuration?.priorities.map((item) => (
                <div key={item._id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{item.name}</span>
                    <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: item.color }}/>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">TAT multiplier: {item.tatMultiplier}x</p>
                  <StatusBadge tone={item.active ? "green" : "neutral"}>{item.active ? "Active" : "Inactive"}</StatusBadge>
                  <RecordActions
                    className="mt-2"
                    active={item.active}
                    busy={saving}
                    onEdit={() =>
                      setEditTarget({
                        title: `Edit ${item.name}`,
                        endpoint: `/api/configuration/priorities/${item._id}`,
                        refresh: () => void configurationQuery.refetch(),
                        values: { name: item.name, color: item.color, tatMultiplier: item.tatMultiplier, order: item.order ?? 0 },
                        fields: [
                          { key: "name", label: "Priority Name", required: true },
                          { key: "color", label: "Colour", type: "color" },
                          { key: "tatMultiplier", label: "TAT Multiplier", type: "number", step: "0.05" },
                          { key: "order", label: "Display Order", type: "number" }
                        ]
                      })
                    }
                    onToggle={() => toggleConfigRecord(`/api/configuration/priorities/${item._id}`, !item.active)}
                    onDelete={() =>
                      setDeleteTarget({
                        name: item.name,
                        endpoint: `/api/configuration/priorities/${item._id}`,
                        warning: "Complaints and CAPAs store their priority as a reference, so one still in use cannot be deleted.",
                        refresh: () => void configurationQuery.refetch()
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "tat" && (
          <SectionCard title="TAT & Workflow Targets" description="All workflow and effectiveness windows are persisted in TATConfiguration."><CompanySelector companies={companies} selected={selectedCompany} onChange={setSelectedCompany}/><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([
            ["Acknowledgement (hours)", "ackHours"], ["Containment (days)", "containmentDays"], ["RCA (days)", "rcaDays"], ["CAPA Assignment (days)", "capaDays"], ["D3 Containment (days)", "d3ContainmentDays"], ["D5 Corrective Action (days)", "d5CorrectiveActionDays"], ["D6 Verification (days)", "d6VerificationDays"], ["D7 Short Term (days)", "d7ShortTermDays"], ["D7 Long Term (days)", "d7LongTermDays"], ["Repeat Window (days)", "repeatWindowDays"], ["Due Soon (hours)", "dueSoonHours"]
          ] as [string, keyof TatForm][]).map(([label, key]) => <Field key={key} label={label}><Input type="number" min={1} value={tatForm[key]} onChange={(e) => setTatForm({ ...tatForm, [key]: Number(e.target.value) })}/></Field>)}</div><Button type="button" className="mt-5" onClick={saveTat} disabled={saving}><CheckCircle2 className="h-4 w-4" />Save TAT Configuration</Button></SectionCard>
        )}

        {activeTab === "delay" && (
          <SectionCard title="Delay Reasons" description="Controlled reasons required when overdue stages are completed.">
            <div className="mb-4 flex max-w-xl gap-2">
              <Input placeholder="New delay reason" value={delayReasonName} onChange={(e) => setDelayReasonName(e.target.value)}/>
              <Button type="button" onClick={() => addSimpleList("delay-reasons", delayReasonName, () => setDelayReasonName(""))}>
                <Plus className="h-4 w-4" />Add
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {configuration?.delayReasonItems?.map((item) => (
                <SimpleListRow
                  key={item._id}
                  item={item}
                  list="delay-reasons"
                  busy={saving}
                  onEdit={setEditTarget}
                  onToggle={toggleConfigRecord}
                  onDelete={setDeleteTarget}
                  refresh={() => void configurationQuery.refetch()}
                />
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "rootCause" && (
          <SectionCard title="Root Cause Categories" description="Standard 6M+2 and additional governance classifications used in RCA analytics.">
            <div className="mb-4 flex max-w-xl gap-2">
              <Input placeholder="New root cause category" value={rootCauseName} onChange={(e) => setRootCauseName(e.target.value)}/>
              <Button type="button" onClick={() => addSimpleList("root-cause-categories", rootCauseName, () => setRootCauseName(""))}>
                <Plus className="h-4 w-4" />Add
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {configuration?.rootCauseCategories.map((item) => (
                <SimpleListRow
                  key={item._id}
                  item={item}
                  list="root-cause-categories"
                  busy={saving}
                  onEdit={setEditTarget}
                  onToggle={toggleConfigRecord}
                  onDelete={setDeleteTarget}
                  refresh={() => void configurationQuery.refetch()}
                />
              ))}
            </div>
          </SectionCard>
        )}

        {activeTab === "escalation" && (
          <SectionCard title="Reminder & Escalation" description="Single source of truth for pre-due reminders and overdue escalation recipients."><CompanySelector companies={companies} selected={selectedCompany} onChange={setSelectedCompany}/><div className="mt-5 max-w-md"><Field label="Reminder percentages (comma separated)"><Input value={reminderPercentages} onChange={(e) => setReminderPercentages(e.target.value)} placeholder="50,75,90"/></Field></div><div className="mt-4 space-y-3">{escalationLevels.map((level, index) => <div key={level.level} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[90px_1fr_180px]"><Field label="Level"><Input type="number" value={level.level} onChange={(e) => setEscalationLevels((rows) => rows.map((row, i) => i === index ? { ...row, level: Number(e.target.value) } : row))}/></Field><Field label="Recipient / Role"><Input value={level.name} onChange={(e) => setEscalationLevels((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))}/></Field><Field label="Hours overdue"><Input type="number" min={0} value={level.triggerHoursOverdue} onChange={(e) => setEscalationLevels((rows) => rows.map((row, i) => i === index ? { ...row, triggerHoursOverdue: Number(e.target.value) } : row))}/></Field></div>)}</div><Button type="button" className="mt-5" onClick={saveEscalation} disabled={saving}><CheckCircle2 className="h-4 w-4" />Save Escalation</Button></SectionCard>
        )}

        {activeTab === "numbering" && (
          <SectionCard title="Complaint & CAPA Numbering" description="Company-specific prefix and concurrency-safe sequence formatting."><CompanySelector companies={companies} selected={selectedCompany} onChange={setSelectedCompany}/><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Complaint Prefix"><Input value={numberingForm.prefix} onChange={(e) => setNumberingForm({ ...numberingForm, prefix: e.target.value.toUpperCase() })}/></Field><Field label="Complaint Padding"><Input type="number" min={3} max={10} value={numberingForm.sequencePadding} onChange={(e) => setNumberingForm({ ...numberingForm, sequencePadding: Number(e.target.value) })}/></Field><Field label="CAPA Padding"><Input type="number" min={2} max={6} value={numberingForm.capaSequencePadding} onChange={(e) => setNumberingForm({ ...numberingForm, capaSequencePadding: Number(e.target.value) })}/></Field><label className="flex items-center gap-2 pt-7 text-sm font-semibold text-slate-700"><input type="checkbox" checked={numberingForm.resetOnFinancialYear} onChange={(e) => setNumberingForm({ ...numberingForm, resetOnFinancialYear: e.target.checked })}/>Reset each financial year</label></div><Button type="button" className="mt-5" onClick={saveNumbering} disabled={saving}><CheckCircle2 className="h-4 w-4" />Save Numbering</Button></SectionCard>
        )}
      </div>

      <MasterEditModal target={editTarget} saving={saving} onClose={() => setEditTarget(null)} onSave={saveMasterEdit} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? ""}?`}
        description={
          <span>
            {deleteTarget?.warning} The portal refuses a delete while anything still points at the record, so if it is in use you
            will be told what is holding it and can deactivate it instead. This cannot be undone.
          </span>
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={deleteMasterRecord}
      />

      <ConfirmDialog
        open={resetRolesOpen}
        onOpenChange={setResetRolesOpen}
        title="Reset every role to its defaults?"
        description="Each standard role goes back to the permission set the portal ships with. Any permission granted or revoked by hand is lost, and the change is audited."
        confirmLabel="Reset roles"
        destructive
        onConfirm={async () => {
          await resetRolesToDefaults();
          setResetRolesOpen(false);
        }}
      />

      <ConfirmDialog
        open={grantAllTo !== null}
        onOpenChange={(open) => !open && setGrantAllTo(null)}
        title={`Grant full system access to ${grantAllTo?.name ?? ""}?`}
        description="The * permission carries every permission there is, including the right to edit this matrix and to manage users. Grant it only to an administrator role."
        confirmLabel="Grant full access"
        destructive
        onConfirm={async () => {
          if (grantAllTo) await toggleRolePermission(grantAllTo.id, grantAllTo.permissions, "*");
          setGrantAllTo(null);
        }}
      />

      <Modal open={companyModal} onOpenChange={setCompanyModal} title="Add Operating Company"><div className="space-y-4"><Field label="Company Legal Name" required><Input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}/></Field><Field label="Company Code" required><Input value={companyForm.code} onChange={(e) => setCompanyForm({ ...companyForm, code: e.target.value.toUpperCase() })}/></Field><Field label="Complaint Number Prefix" required><Input value={companyForm.complaintNumberingPrefix} onChange={(e) => setCompanyForm({ ...companyForm, complaintNumberingPrefix: e.target.value.toUpperCase() })}/></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCompanyModal(false)}>Cancel</Button><Button type="button" onClick={handleCompanySubmit} disabled={saving}>Create Company</Button></div></div></Modal>

      <Modal open={departmentModal} onOpenChange={setDepartmentModal} title="Add Department"><div className="space-y-4"><Field label="Department Name" required><Input value={departmentForm.name} onChange={(e) => setDepartmentForm({ ...departmentForm, name: e.target.value })}/></Field><Field label="Department Code"><Input value={departmentForm.code} onChange={(e) => setDepartmentForm({ ...departmentForm, code: e.target.value.toUpperCase() })}/></Field><Field label="Company"><Select value={departmentForm.company} onChange={(e) => setDepartmentForm({ ...departmentForm, company: e.target.value })}><option value="">Shared / All</option>{companies.filter((c) => c.active).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field><Field label="Management emails (always CC)" hint="Comma-separated. CC'd on every email for this department, with the Manager and HOD from the Employee Directory."><Input value={departmentForm.managementEmails} onChange={(e) => setDepartmentForm({ ...departmentForm, managementEmails: e.target.value })} placeholder="name@onepws.com, name2@onepws.com"/></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDepartmentModal(false)}>Cancel</Button><Button type="button" onClick={handleDepartmentSubmit} disabled={saving}>Create Department</Button></div></div></Modal>

      <Modal open={employeeModal} onOpenChange={setEmployeeModal} title="Add Employee"><div className="grid gap-4 sm:grid-cols-2"><Field label="Employee Code" required><Input value={employeeForm.employeeCode} onChange={(e) => setEmployeeForm({ ...employeeForm, employeeCode: e.target.value })}/></Field><Field label="Full Name" required><Input value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}/></Field><Field label="Email"><Input type="email" value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}/></Field><Field label="Designation"><Input value={employeeForm.designation} onChange={(e) => setEmployeeForm({ ...employeeForm, designation: e.target.value })}/></Field><Field label="Company" required><Select value={employeeForm.company} onChange={(e) => setEmployeeForm({ ...employeeForm, company: e.target.value })}><option value="">Select company</option>{companies.filter((c) => c.active).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field><Field label="Department" required><Select value={employeeForm.department} onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })}><option value="">Select department</option>{departments.filter((d) => d.active).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field><Field label="Manager Name"><Input value={employeeForm.managerName} onChange={(e) => setEmployeeForm({ ...employeeForm, managerName: e.target.value })}/></Field><Field label="Manager Email"><Input placeholder="a@onepws.com, b@onepws.com" value={employeeForm.managerEmail} onChange={(e) => setEmployeeForm({ ...employeeForm, managerEmail: e.target.value })}/></Field><Field label="HOD Name"><Input value={employeeForm.hodName} onChange={(e) => setEmployeeForm({ ...employeeForm, hodName: e.target.value })}/></Field><Field label="HOD Email"><Input placeholder="a@onepws.com; b@onepws.com" value={employeeForm.hodEmail} onChange={(e) => setEmployeeForm({ ...employeeForm, hodEmail: e.target.value })}/></Field></div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEmployeeModal(false)}>Cancel</Button><Button type="button" onClick={handleEmployeeSubmit} disabled={saving}>Create Employee</Button></div></Modal>

      <Modal open={userModal} onOpenChange={setUserModal} title="Create System User"><div className="space-y-4"><Field label="Full Name" required><Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}/></Field><Field label="Email"><Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}/></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Username" required><Input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value.toLowerCase() })}/></Field><Field label="Temporary Password" required><PasswordInput autoComplete="new-password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}/></Field></div><p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">The temporary password is never retrievable after account creation. The user will be forced to change it before accessing the portal.</p><Field label="Role" required><Select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}><option value="">Select role</option>{roles.filter((r) => r.active).map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</Select></Field><Field label="Department Name"><Select value={userForm.department} onChange={(e) => setUserForm({ ...userForm, department: e.target.value })}><option value="">No department</option>{departments.filter((d) => d.active).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field><Field label="Company Access"><div className="grid gap-2 sm:grid-cols-2">{companies.filter((c) => c.active).map((c) => <label key={c._id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs"><input type="checkbox" checked={userForm.companyIds.includes(c._id)} onChange={(e) => setUserForm((current) => ({ ...current, companyIds: e.target.checked ? [...current.companyIds, c._id] : current.companyIds.filter((id) => id !== c._id) }))}/>{c.name}</label>)}</div></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setUserModal(false)}>Cancel</Button><Button type="button" onClick={handleUserSubmit} disabled={saving}>Create User</Button></div></div></Modal>
    </main>
  );
}

function CompanySelector({ companies, selected, onChange }: { companies: { _id: string; name: string; active: boolean }[]; selected: string; onChange: (value: string) => void }) {
  return <div className="max-w-md"><Field label="Company"><Select value={selected} onChange={(e) => onChange(e.target.value)}><option value="">Global defaults</option>{companies.filter((c) => c.active).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field></div>;
}

export default MasterDataPage;
