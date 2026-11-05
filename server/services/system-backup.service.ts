import { Types } from "mongoose";
import { z } from "zod";
import type { ApiUser } from "@shared/types/api";
import { isMasterAdmin } from "../domain/rbac";
import { Attachment } from "../models/Attachment";
import { Capa } from "../models/Capa";
import { Company } from "../models/Company";
import { Complaint } from "../models/Complaint";
import { Department } from "../models/Department";
import { EmailRouting } from "../models/EmailRouting";
import { EmailTemplate } from "../models/EmailTemplate";
import { Employee } from "../models/Employee";
import { EscalationConfiguration, NumberingConfiguration, TATConfiguration } from "../models/configuration";
import { Category, DelayReason, Priority, RootCauseCategory } from "../models/masters";
import { writeAudit } from "./audit.service";
import { requireActor } from "./complaint.service";
import { businessRuleError, httpError } from "../utils/http";

const recordSchema = z.record(z.unknown());

export const systemBackupSchema = z.object({
  format: z.literal("ONEPWS_COMPLAINT_CAPA_BACKUP"),
  version: z.literal(2),
  generatedAt: z.string(),
  data: z.object({
    companies: z.array(recordSchema),
    departments: z.array(recordSchema),
    employees: z.array(recordSchema),
    categories: z.array(recordSchema),
    priorities: z.array(recordSchema),
    delayReasons: z.array(recordSchema),
    rootCauseCategories: z.array(recordSchema),
    tatConfigurations: z.array(recordSchema),
    escalationConfigurations: z.array(recordSchema),
    numberingConfigurations: z.array(recordSchema),
    emailTemplates: z.array(recordSchema),
    emailRouting: z.array(recordSchema).default([]),
    complaints: z.array(recordSchema),
    capas: z.array(recordSchema),
    attachments: z.array(recordSchema)
  })
});

export type SystemBackup = z.infer<typeof systemBackupSchema>;

type CollectionKey = keyof SystemBackup["data"];

export type RestorePreview = {
  dryRun: boolean;
  mode: "merge-only";
  inserted: Record<CollectionKey, number>;
  skippedExisting: Record<CollectionKey, number>;
  conflicts: { collection: CollectionKey; identifier: string; reason: string }[];
};

const COLLECTION_KEYS: CollectionKey[] = [
  "companies",
  "departments",
  "employees",
  "categories",
  "priorities",
  "delayReasons",
  "rootCauseCategories",
  "tatConfigurations",
  "escalationConfigurations",
  "numberingConfigurations",
  "emailTemplates",
  "emailRouting",
  "complaints",
  "capas",
  "attachments"
];

function emptyCounts(): Record<CollectionKey, number> {
  return Object.fromEntries(COLLECTION_KEYS.map((key) => [key, 0])) as Record<CollectionKey, number>;
}

function idOf(record: Record<string, unknown>) {
  const raw = record._id;
  return raw && Types.ObjectId.isValid(String(raw)) ? String(raw) : "";
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function safeRecord(record: Record<string, unknown>) {
  const copy = { ...record };
  delete copy.__v;
  return copy;
}

async function assertAdmin(user: ApiUser | undefined) {
  const actor = await requireActor(user);
  if (!isMasterAdmin(actor)) throw httpError(403, "Only a Master Admin can export or restore a system backup");
  return actor;
}

/**
 * Safe operational backup. Password hashes, password reset tokens, SMTP credentials,
 * Cloudinary secrets and JWT/cron secrets are intentionally not part of this payload.
 */
export async function exportSystemBackup(user: ApiUser | undefined): Promise<SystemBackup> {
  await assertAdmin(user);

  const [
    companies,
    departments,
    employees,
    categories,
    priorities,
    delayReasons,
    rootCauseCategories,
    tatConfigurations,
    escalationConfigurations,
    numberingConfigurations,
    emailTemplates,
    emailRouting,
    complaints,
    capas,
    attachments
  ] = await Promise.all([
    Company.find().lean(),
    Department.find().lean(),
    Employee.find().lean(),
    Category.find().lean(),
    Priority.find().lean(),
    DelayReason.find().lean(),
    RootCauseCategory.find().lean(),
    TATConfiguration.find().lean(),
    EscalationConfiguration.find().lean(),
    NumberingConfiguration.find().lean(),
    EmailTemplate.find().select("-createdBy -updatedBy").lean(),
    EmailRouting.find().select("-updatedBy").lean(),
    Complaint.find().lean(),
    Capa.find().lean(),
    Attachment.find().lean()
  ]);

  const backup: SystemBackup = {
    format: "ONEPWS_COMPLAINT_CAPA_BACKUP",
    version: 2,
    generatedAt: new Date().toISOString(),
    data: {
      companies,
      departments,
      employees,
      categories,
      priorities,
      delayReasons,
      rootCauseCategories,
      tatConfigurations,
      escalationConfigurations,
      numberingConfigurations,
      emailTemplates,
      emailRouting,
      complaints,
      capas,
      attachments
    }
  };

  await writeAudit({
    actor: user,
    action: "EXPORT",
    entity: "SystemBackup",
    metadata: Object.fromEntries(COLLECTION_KEYS.map((key) => [key, backup.data[key].length]))
  });

  return backup;
}

async function restoreCompany(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const code = stringField(record, "code");
  if (!id || !code) return "conflict" as const;
  if (await Company.exists({ $or: [{ _id: id }, { code }] })) return "existing" as const;
  if (!dryRun) await Company.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreDepartment(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const name = stringField(record, "name");
  if (!id || !name) return "conflict" as const;
  if (await Department.exists({ _id: id })) return "existing" as const;
  if (!dryRun) await Department.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreEmployee(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const employeeCode = stringField(record, "employeeCode");
  if (!id || !employeeCode) return "conflict" as const;
  if (await Employee.exists({ $or: [{ _id: id }, { employeeCode }] })) return "existing" as const;
  if (!dryRun) await Employee.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreCategory(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const name = stringField(record, "name");
  const complaintType = stringField(record, "complaintType");
  if (!id || !name || !complaintType) return "conflict" as const;
  if (await Category.exists({ _id: id })) return "existing" as const;
  if (!dryRun) await Category.create(safeRecord(record));
  return "inserted" as const;
}

async function restorePriority(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const name = stringField(record, "name");
  if (!id || !name) return "conflict" as const;
  if (await Priority.exists({ $or: [{ _id: id }, { name }] })) return "existing" as const;
  if (!dryRun) await Priority.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreDelayReason(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const name = stringField(record, "name");
  if (!id || !name) return "conflict" as const;
  if (await DelayReason.exists({ $or: [{ _id: id }, { name }] })) return "existing" as const;
  if (!dryRun) await DelayReason.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreRootCause(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const name = stringField(record, "name");
  if (!id || !name) return "conflict" as const;
  if (await RootCauseCategory.exists({ $or: [{ _id: id }, { name }] })) return "existing" as const;
  if (!dryRun) await RootCauseCategory.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreConfiguration(
  key: "tatConfigurations" | "escalationConfigurations" | "numberingConfigurations",
  record: Record<string, unknown>,
  dryRun: boolean
) {
  const id = idOf(record);
  if (!id) return "conflict" as const;
  const company = record.company ?? null;
  if (key === "tatConfigurations") {
    if (await TATConfiguration.exists({ $or: [{ _id: id }, { company }] })) return "existing" as const;
    if (!dryRun) await TATConfiguration.create(safeRecord(record));
  } else if (key === "escalationConfigurations") {
    if (await EscalationConfiguration.exists({ $or: [{ _id: id }, { company }] })) return "existing" as const;
    if (!dryRun) await EscalationConfiguration.create(safeRecord(record));
  } else {
    if (await NumberingConfiguration.exists({ $or: [{ _id: id }, { company }] })) return "existing" as const;
    if (!dryRun) await NumberingConfiguration.create(safeRecord(record));
  }
  return "inserted" as const;
}

async function restoreEmailTemplate(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const templateKey = stringField(record, "templateKey");
  if (!id || !templateKey) return "conflict" as const;
  if (await EmailTemplate.exists({ $or: [{ _id: id }, { templateKey }] })) return "existing" as const;
  if (!dryRun) await EmailTemplate.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreEmailRouting(record: Record<string, unknown>, dryRun: boolean) {
  if (await EmailRouting.exists({ key: "global" })) return "existing" as const;
  if (!dryRun) await EmailRouting.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreComplaint(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const number = stringField(record, "number");
  if (!id || !number) return "conflict" as const;
  if (await Complaint.exists({ $or: [{ _id: id }, { number }] })) return "existing" as const;
  const company = stringField(record, "company");
  if (!company || !(await Company.exists({ _id: company }))) return "conflict" as const;
  if (!dryRun) await Complaint.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreCapa(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const number = stringField(record, "number");
  if (!id || !number) return "conflict" as const;
  if (await Capa.exists({ $or: [{ _id: id }, { number }] })) return "existing" as const;
  const complaint = stringField(record, "complaint");
  if (!complaint || !(await Complaint.exists({ _id: complaint }))) return "conflict" as const;
  if (!dryRun) await Capa.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreAttachment(record: Record<string, unknown>, dryRun: boolean) {
  const id = idOf(record);
  const publicId = stringField(record, "publicId");
  if (!id || !publicId) return "conflict" as const;
  if (await Attachment.exists({ $or: [{ _id: id }, { publicId }] })) return "existing" as const;
  if (!dryRun) await Attachment.create(safeRecord(record));
  return "inserted" as const;
}

async function restoreOne(key: CollectionKey, record: Record<string, unknown>, dryRun: boolean) {
  switch (key) {
    case "companies": return restoreCompany(record, dryRun);
    case "departments": return restoreDepartment(record, dryRun);
    case "employees": return restoreEmployee(record, dryRun);
    case "categories": return restoreCategory(record, dryRun);
    case "priorities": return restorePriority(record, dryRun);
    case "delayReasons": return restoreDelayReason(record, dryRun);
    case "rootCauseCategories": return restoreRootCause(record, dryRun);
    case "tatConfigurations":
    case "escalationConfigurations":
    case "numberingConfigurations": return restoreConfiguration(key, record, dryRun);
    case "emailTemplates": return restoreEmailTemplate(record, dryRun);
    case "emailRouting": return restoreEmailRouting(record, dryRun);
    case "complaints": return restoreComplaint(record, dryRun);
    case "capas": return restoreCapa(record, dryRun);
    case "attachments": return restoreAttachment(record, dryRun);
  }
}

/**
 * Merge-only restore: never updates or deletes existing production records.
 * The exact same payload can first be dry-run and then explicitly confirmed.
 */
export async function restoreSystemBackup(
  payload: unknown,
  options: { dryRun: boolean; confirmation?: string },
  user: ApiUser | undefined
): Promise<RestorePreview> {
  await assertAdmin(user);
  const parsed = systemBackupSchema.safeParse(payload);
  if (!parsed.success) {
    throw businessRuleError("Backup validation failed", parsed.error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.join(".") || "backup",
      message: issue.message
    })));
  }
  if (!options.dryRun && options.confirmation !== "RESTORE_MERGE") {
    throw businessRuleError("Restore confirmation is required", [{ field: "confirmation", message: "Type RESTORE_MERGE to perform a merge-only restore" }]);
  }

  const result: RestorePreview = {
    dryRun: options.dryRun,
    mode: "merge-only",
    inserted: emptyCounts(),
    skippedExisting: emptyCounts(),
    conflicts: []
  };

  for (const key of COLLECTION_KEYS) {
    for (const record of parsed.data.data[key]) {
      try {
        const status = await restoreOne(key, record, options.dryRun);
        if (status === "inserted") result.inserted[key] += 1;
        else if (status === "existing") result.skippedExisting[key] += 1;
        else result.conflicts.push({ collection: key, identifier: idOf(record) || "unknown", reason: "Missing required identifier or referenced parent record" });
      } catch (error) {
        result.conflicts.push({
          collection: key,
          identifier: idOf(record) || "unknown",
          reason: error instanceof Error ? error.message : "Record could not be restored"
        });
      }
    }
  }

  await writeAudit({
    actor: user,
    action: options.dryRun ? "RESTORE_PREVIEW" : "IMPORT",
    entity: "SystemBackup",
    metadata: { mode: result.mode, dryRun: result.dryRun, inserted: result.inserted, skippedExisting: result.skippedExisting, conflicts: result.conflicts.length }
  });

  return result;
}
