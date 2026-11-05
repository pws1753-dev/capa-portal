import { Types } from "mongoose";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import { Role } from "../models/Role";
import { Employee } from "../models/Employee";
import { Department } from "../models/Department";
import { Complaint } from "../models/Complaint";
import { Capa } from "../models/Capa";
import { parseEmailList } from "@shared/schemas/master-data";

export type RecipientResolutionOptions = {
  complaintId?: string | Types.ObjectId;
  capaId?: string | Types.ObjectId;
  companyId?: string | Types.ObjectId;
  departmentId?: string | Types.ObjectId;
  ownerId?: string | Types.ObjectId;
  coordinatorId?: string | Types.ObjectId;
  targetRoles?: string[]; // e.g. ["Complaint Owner", "Coordinator", "Department Head", "Quality Head", "Management", "CAPA Owner"]
  explicitEmails?: string[];
  excludeEmails?: string[];
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return EMAIL_REGEX.test(trimmed) ? trimmed : null;
}

/** Employee Manager / HOD fields may hold several addresses separated by commas or semicolons. */
function normalizeEmailList(value: unknown): string[] {
  return parseEmailList(value).filter((email) => EMAIL_REGEX.test(email));
}

/**
 * Manager and HOD addresses of the department a complaint / CAPA belongs to,
 * used to CC them on every department-specific email.
 */
export async function resolveDepartmentCc(ref: {
  complaintId?: string | Types.ObjectId;
  capaId?: string | Types.ObjectId;
  /** Leave the department's Management addresses out (delay reminders add them only after 10 days). */
  excludeManagement?: boolean;
}): Promise<string[]> {
  if (!ref.complaintId && !ref.capaId) return [];
  const { excludeManagement, ...target } = ref;
  return resolveRecipients({
    ...target,
    targetRoles: excludeManagement ? ["Manager", "Department Head"] : ["Manager", "Department Head", "Department Management"]
  });
}

/**
 * The Manager and HOD kept on each recipient's own Employee Directory record, so a person who
 * receives a complaint email always has their reporting line copied, whatever department the
 * complaint belongs to. Matches the recipient's address to the employee's email or login email.
 */
export async function resolveRecipientChainCc(recipients: string[]): Promise<string[]> {
  const addresses = Array.from(new Set(recipients.map((entry) => normalizeEmail(entry)).filter((entry): entry is string => Boolean(entry))));
  if (addresses.length === 0) return [];
  await connectDB();

  const users = await User.find({ email: { $in: addresses }, active: true }).select("_id").lean();
  const employees = await Employee.find({
    active: { $ne: false },
    $or: [{ email: { $in: addresses } }, ...(users.length > 0 ? [{ linkedUser: { $in: users.map((user) => user._id) } }] : [])]
  })
    .select("managerEmail hodEmail")
    .lean();

  const chain = new Set<string>();
  for (const employee of employees) {
    for (const email of [...normalizeEmailList(employee.managerEmail), ...normalizeEmailList(employee.hodEmail)]) chain.add(email);
  }
  return Array.from(chain);
}

/**
 * The department itself plus its "<name> Quality" counterpart or base department, so a complaint
 * raised against "CD Quality" is handled by the CD people and "CCR Quality" by the CCR people.
 */
async function departmentGroupIds(departmentId: string | Types.ObjectId): Promise<Types.ObjectId[]> {
  const id = new Types.ObjectId(String(departmentId));
  const department = await Department.findById(id).select("name").lean();
  const name = department?.name?.trim();
  if (!name) return [id];
  const base = name.replace(/\s+quality$/i, "").trim().toLowerCase();
  const all = await Department.find({}).select("name").lean();
  const ids = all
    .filter((entry) => {
      const entryName = entry.name?.trim().toLowerCase() ?? "";
      return entryName === base || entryName === `${base} quality`;
    })
    .map((entry) => new Types.ObjectId(String(entry._id)));
  return ids.some((entry) => String(entry) === String(id)) ? ids : [id, ...ids];
}

/**
 * Role based recipients (Quality Head, Management) are company wide, so on a department complaint
 * keep only the ones whose Employee Directory record belongs to that department. A person with no
 * directory record is kept, because there is nothing to say they belong elsewhere.
 */
async function limitToDepartment<T extends { _id: unknown; email?: string | null }>(users: T[], departmentIds: Types.ObjectId[] | null): Promise<T[]> {
  if (!departmentIds || users.length === 0) return users;
  const emails = users.map((user) => normalizeEmail(user.email)).filter((email): email is string => Boolean(email));
  const employees = await Employee.find({
    active: { $ne: false },
    $or: [{ linkedUser: { $in: users.map((user) => user._id) } }, { email: { $in: emails } }]
  })
    .select("department email linkedUser")
    .lean();
  const wanted = new Set(departmentIds.map(String));
  return users.filter((user) => {
    const email = normalizeEmail(user.email);
    const own = employees.filter((employee) => String(employee.linkedUser ?? "") === String(user._id) || (email && normalizeEmail(employee.email) === email));
    return own.length === 0 || own.some((employee) => wanted.has(String(employee.department)));
  });
}

export async function resolveRecipients(options: RecipientResolutionOptions): Promise<string[]> {
  await connectDB();
  const recipientSet = new Set<string>();

  // 1. Add explicitly provided emails
  if (options.explicitEmails) {
    for (const raw of options.explicitEmails) {
      const email = normalizeEmail(raw);
      if (email) recipientSet.add(email);
    }
  }

  // Hydrate complaint if provided
  let complaintDoc = null;
  if (options.complaintId && Types.ObjectId.isValid(options.complaintId)) {
    complaintDoc = await Complaint.findById(options.complaintId).lean();
  }

  // Hydrate CAPA if provided
  let capaDoc = null;
  if (options.capaId && Types.ObjectId.isValid(options.capaId)) {
    capaDoc = await Capa.findById(options.capaId).lean();
  }

  const effectiveCompanyId =
    options.companyId || complaintDoc?.company || capaDoc?.company;

  const effectiveDepartmentId =
    options.departmentId || complaintDoc?.responsibleDept || capaDoc?.department;

  const effectiveOwnerId =
    options.ownerId || complaintDoc?.owner || capaDoc?.owner;

  const effectiveCoordinatorId =
    options.coordinatorId || (complaintDoc as { coordinator?: Types.ObjectId })?.coordinator;


  const roles = options.targetRoles || [];
  const departmentIds =
    effectiveDepartmentId && Types.ObjectId.isValid(effectiveDepartmentId) ? await departmentGroupIds(effectiveDepartmentId) : null;

  // 2. Resolve Complaint Owner: the accountable portal user, and the directory employee the
  //    complaint is shown against when that owner has no login.
  if (roles.includes("Complaint Owner")) {
    if (effectiveOwnerId) {
      const ownerUser = await User.findOne({ _id: effectiveOwnerId, active: true }).lean();
      const email = normalizeEmail(ownerUser?.email);
      if (email) recipientSet.add(email);
    }
    if (complaintDoc?.ownerEmployee) {
      const ownerEmployee = await Employee.findOne({ _id: complaintDoc.ownerEmployee, active: { $ne: false } }).select("email").lean();
      const email = normalizeEmail(ownerEmployee?.email);
      if (email) recipientSet.add(email);
    }
  }

  // 3. Resolve Complaint Coordinator
  if (roles.includes("Coordinator") && effectiveCoordinatorId) {
    const coordUser = await User.findOne({ _id: effectiveCoordinatorId, active: true }).lean();
    const email = normalizeEmail(coordUser?.email);
    if (email) recipientSet.add(email);
  }

  // 4. Resolve CAPA Owner
  if (roles.includes("CAPA Owner") && capaDoc?.owner) {
    const capaOwner = await User.findOne({ _id: capaDoc.owner, active: true }).lean();
    const email = normalizeEmail(capaOwner?.email);
    if (email) recipientSet.add(email);
  }
  if (roles.includes("CAPA Owner") && capaDoc?.ownerEmployee) {
    const ownerEmployee = await Employee.findOne({ _id: capaDoc.ownerEmployee, active: { $ne: false } }).select("email").lean();
    const email = normalizeEmail(ownerEmployee?.email);
    if (email) recipientSet.add(email);
  }

  // 5. Resolve Department Head & Manager via Employee records
  if ((roles.includes("Department Head") || roles.includes("Manager")) && effectiveDepartmentId) {
    const query: Record<string, unknown> = {
      department: departmentIds ? { $in: departmentIds } : effectiveDepartmentId,
      active: true
    };
    if (effectiveCompanyId) {
      query.company = effectiveCompanyId;
    }
    const employees = await Employee.find(query).lean();
    for (const emp of employees) {
      if (roles.includes("Department Head")) {
        for (const hod of normalizeEmailList(emp.hodEmail)) recipientSet.add(hod);
      }
      if (roles.includes("Manager") || roles.includes("Department Head")) {
        for (const mgr of normalizeEmailList(emp.managerEmail)) recipientSet.add(mgr);
      }
    }
  }

  // 5b. Department-level Management addresses kept in Master Data > Departments
  if (roles.includes("Department Management") && effectiveDepartmentId && Types.ObjectId.isValid(effectiveDepartmentId)) {
    const departments = await Department.find({ _id: { $in: departmentIds ?? [effectiveDepartmentId] } }).select("managementEmails").lean();
    for (const department of departments) for (const email of normalizeEmailList(department.managementEmails)) recipientSet.add(email);
  }

  // 6. Resolve Quality Head
  if (roles.includes("Quality Head")) {
    const qualityRoles = await Role.find({
      $or: [
        { name: /quality/i },
        { permissions: "complaint.approve" },
        { permissions: "capa.review_evidence" }
      ],
      active: true
    }).select("_id").lean();

    const roleIds = qualityRoles.map((r) => r._id);
    if (roleIds.length > 0) {
      const userQuery: Record<string, unknown> = {
        role: { $in: roleIds },
        active: true
      };
      if (effectiveCompanyId) {
        userQuery.$or = [{ companyIds: effectiveCompanyId }, { companyIds: { $size: 0 } }];
      }
      const qualityUsers = await limitToDepartment(await User.find(userQuery).select("email").lean(), departmentIds);
      for (const u of qualityUsers) {
        const email = normalizeEmail(u.email);
        if (email) recipientSet.add(email);
      }
    }
  }

  // 7. Resolve Management
  if (roles.includes("Management")) {
    const mgmtRoles = await Role.find({
      name: { $in: ["Management", "Director", "Managing Director", "Plant Head"] },
      active: true
    }).select("_id").lean();

    const roleIds = mgmtRoles.map((r) => r._id);
    if (roleIds.length > 0) {
      const userQuery: Record<string, unknown> = {
        role: { $in: roleIds },
        active: true
      };
      if (effectiveCompanyId) {
        userQuery.$or = [{ companyIds: effectiveCompanyId }, { companyIds: { $size: 0 } }];
      }
      const mgmtUsers = await limitToDepartment(await User.find(userQuery).select("email").lean(), departmentIds);
      for (const u of mgmtUsers) {
        const email = normalizeEmail(u.email);
        if (email) recipientSet.add(email);
      }
    }
  }

  // 8. Resolve Master Admin
  if (roles.includes("Master Admin")) {
    const adminRole = await Role.findOne({ name: "Master Admin" }).select("_id").lean();
    if (adminRole) {
      const admins = await User.find({ role: adminRole._id, active: true }).select("email").lean();
      for (const admin of admins) {
        const email = normalizeEmail(admin.email);
        if (email) recipientSet.add(email);
      }
    }
  }

  // 9. Exclude requested addresses (e.g. actor themselves if self-notification is discouraged)
  if (options.excludeEmails) {
    for (const raw of options.excludeEmails) {
      const email = normalizeEmail(raw);
      if (email) recipientSet.delete(email);
    }
  }

  return Array.from(recipientSet);
}
