import { z } from "zod";
import {
  COMPLAINT_STATUSES,
  COMPLAINT_TYPES,
  D6_DOCUMENT_STATUSES,
  D6_DOCUMENT_TYPES,
  D7_LT_RESULTS,
  FISHBONE_CATEGORIES,
  NOTE_KINDS,
  SIGNATURE_ROLES,
  WORKFLOW_STAGES
} from "../constants/domain";
import { listQuerySchema, objectIdSchema } from "./common";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

const baseComplaintSchema = z.object({
  type: z.enum(COMPLAINT_TYPES),
  company: objectIdSchema,
  receivedAt: z.coerce.date(),
  priority: objectIdSchema,
  source: optionalText(80),
  reportedBy: optionalText(160),

  customer: optionalText(160),
  customerContact: optionalText(160),
  customerLocation: optionalText(160),
  project: optionalText(160),
  customerPO: optionalText(80),
  product: optionalText(160),
  batch: optionalText(80),

  internalDept: objectIdSchema.optional(),
  againstDept: objectIdSchema.optional(),
  responsibleDept: objectIdSchema.optional(),

  category: z.string().trim().min(1, "Category is required").max(120),
  subCategory: optionalText(120),
  description: z.string().trim().min(10, "Describe the complaint in at least 10 characters").max(5000),
  owner: objectIdSchema.optional(),
  ownerEmployee: objectIdSchema.optional(),
  attachments: z.array(objectIdSchema).max(20).default([])
});

/**
 * External and internal complaints require different fields, exactly as the legacy
 * new-complaint modal did: a customer for external, and both departments for internal.
 */
export const complaintCreateSchema = baseComplaintSchema.superRefine((value, ctx) => {
  if (value.type === "External") {
    if (!value.customer) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer"], message: "Customer name is required for an external complaint" });
    }
    if (!value.responsibleDept) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["responsibleDept"], message: "Responsible department is required" });
    }
  } else {
    if (!value.internalDept) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalDept"],
        message: "Raising department is required for an internal complaint"
      });
    }
    if (!value.againstDept) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["againstDept"],
        message: "Against department is required for an internal complaint"
      });
    }
  }
});

export const complaintUpdateSchema = baseComplaintSchema
  .partial()
  .omit({ type: true, company: true })
  .extend({ status: z.enum(COMPLAINT_STATUSES).optional() });

export const complaintListQuerySchema = listQuerySchema.extend({
  company: objectIdSchema.optional(),
  type: z.enum(COMPLAINT_TYPES).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  priority: objectIdSchema.optional(),
  category: z.string().trim().max(120).optional(),
  responsibleDept: objectIdSchema.optional(),
  owner: objectIdSchema.optional(),
  isRepeat: z.coerce.boolean().optional(),
  tat: z.enum(["on-time", "due-soon", "overdue"]).optional(),
  receivedFrom: z.coerce.date().optional(),
  receivedTo: z.coerce.date().optional()
});

export const delayInputSchema = z.object({
  category: z.string().trim().min(1).max(160).optional(),
  explanation: z.string().trim().max(2000).optional(),
  recovery: z.string().trim().max(2000).optional()
});

export const stageCompleteSchema = z.object({
  stage: z.enum(WORKFLOW_STAGES),
  notes: optionalText(2000),
  containmentNotes: optionalText(2000),
  /** Immediate response (D0); lets the acknowledgement dialog record it without leaving the page. */
  d0: optionalText(4000),
  delay: delayInputSchema.optional()
});

const actionRowSchema = z.object({
  action: z.string().trim().max(2000).optional().default(""),
  resp: z.string().trim().max(1000).optional().default(""),
  target: z.string().trim().max(40).optional().default(""),
  status: z.string().trim().max(40).optional().default("Open"),
  remarks: z.string().trim().max(2000).optional().default(""),
  ctqImpact: z.string().trim().max(500).optional().default(""),
  customerApproval: z.string().trim().max(200).optional().default("")
});

const fishboneSchema = z.object(
  FISHBONE_CATEGORIES.reduce<Record<string, z.ZodTypeAny>>((acc, category) => {
    acc[category] = z.array(z.string().trim().max(500)).max(20).optional();
    return acc;
  }, {})
);

export const eightDSchema = z.object({
  d0: z.string().trim().max(4000).optional(),
  d1Team: z
    .array(
      z.object({
        employee: objectIdSchema.optional(),
        name: z.string().trim().max(160).optional().default(""),
        dept: z.string().trim().max(120).optional().default(""),
        designation: z.string().trim().max(120).optional().default(""),
        email: z.string().trim().max(160).optional().default(""),
        role: z.string().trim().max(160).optional().default("")
      })
    )
    .max(30)
    .optional(),
  d2: z
    .object({
      what: z.string().trim().max(2000).optional(),
      where: z.string().trim().max(2000).optional(),
      when: z.string().trim().max(2000).optional(),
      who: z.string().trim().max(2000).optional(),
      involved: z.string().trim().max(2000).optional(),
      howMany: z.string().trim().max(500).optional(),
      how: z.string().trim().max(2000).optional()
    })
    .optional(),
  d3Actions: z.array(actionRowSchema).max(50).optional(),
  d4QcTools: z.array(z.string().trim().max(80)).max(20).optional(),
  d4Occurrence: z.string().trim().max(4000).optional(),
  d4Escape: z.string().trim().max(4000).optional(),
  d4Systemic: z.string().trim().max(4000).optional(),
  rootCauseCategory: z.string().trim().max(120).optional(),
  fiveWhy: z
    .object({
      occurrence: z.array(z.string().trim().max(1000)).max(10).optional(),
      escape: z.array(z.string().trim().max(1000)).max(10).optional(),
      systemic: z.array(z.string().trim().max(1000)).max(10).optional(),
      singleChain: z.array(z.string().trim().max(1000)).max(10).optional()
    })
    .optional(),
  fishbone: fishboneSchema.optional(),
  d5Occurrence: z.array(actionRowSchema).max(50).optional(),
  d5Escape: z.array(actionRowSchema).max(50).optional(),
  d5Systemic: z.array(actionRowSchema).max(50).optional(),
  d5Safety: z.string().trim().max(2000).optional(),
  d6Verify: z.array(actionRowSchema).max(50).optional(),
  d6DocsList: z
    .array(
      z.object({
        docType: z.enum(D6_DOCUMENT_TYPES),
        status: z.enum(D6_DOCUMENT_STATUSES),
        attachment: objectIdSchema.nullable().optional(),
        revision: z.string().trim().max(40).optional().default(""),
        revDate: z.string().trim().max(40).optional().default(""),
        approver: z.string().trim().max(160).optional().default(""),
        naJustification: z.string().trim().max(1000).optional().default("")
      })
    )
    .max(D6_DOCUMENT_TYPES.length)
    .optional(),
  d6Horizontal: z.string().trim().max(4000).optional(),
  d7ShortTermDate: z.string().trim().max(40).optional(),
  d7RepeatObserved: z.boolean().optional(),
  d7Regulatory: z.string().trim().max(2000).optional(),
  d7Actions: z.array(actionRowSchema).max(50).optional(),
  d7LongTermDate: z.string().trim().max(40).optional(),
  d7LongTermRepeatObserved: z.boolean().optional(),
  d7LongTermResult: z.enum(D7_LT_RESULTS).or(z.literal("")).optional(),
  d7LongTermNotes: z.string().trim().max(4000).optional(),
  d8Recognition: z.string().trim().max(4000).optional(),
  d8ReviewedBy: z.string().trim().max(160).optional(),
  d8ClosedDate: z.string().trim().max(40).optional()
});

/** Internal complaints keep a reduced investigation instead of the full 8D interface. */
export const internalInvestigationSchema = z.object({
  /** Immediate response and interim containment: required to acknowledge and to complete containment. */
  d0: z.string().trim().max(4000).optional(),
  d3Actions: z.array(actionRowSchema).max(50).optional(),
  d2: z.object({ what: z.string().trim().max(2000).optional() }).optional(),
  fiveWhy: z.object({ singleChain: z.array(z.string().trim().max(1000)).max(10).optional() }).optional(),
  d4Occurrence: z.string().trim().max(4000).optional(),
  rootCauseCategory: z.string().trim().max(120).optional(),
  internalInvestigation: z
    .object({
      summary: z.string().trim().max(4000).optional(),
      findings: z.string().trim().max(4000).optional(),
      correctiveAction: z.string().trim().max(4000).optional(),
      evidence: z.string().trim().max(4000).optional()
    })
    .optional()
});

export const closeComplaintSchema = z.object({
  closureRemarks: z.string().trim().min(5, "Closure remarks are required").max(4000),
  noRepeatConfirmed: z.boolean().default(false),
  force: z.boolean().default(false),
  /** Master Admin only: close the complaint even when mandatory items are missing or CAPAs are open. */
  forceCloseAll: z.boolean().default(false)
});

export const reopenComplaintSchema = z.object({
  reason: z.string().trim().min(5, "A reopen reason is required").max(2000)
});

export const signComplaintSchema = z.object({
  role: z.enum(SIGNATURE_ROLES),
  notes: z.string().trim().max(1000).optional().default("")
});

export const revokeSignatureSchema = z.object({
  role: z.enum(SIGNATURE_ROLES),
  reason: z.string().trim().min(5, "A revocation reason is required").max(1000)
});

export const repeatReviewSchema = z.object({
  isRepeat: z.boolean(),
  remarks: z.string().trim().max(2000).optional().default("")
});

export const noteCreateSchema = z.object({
  kind: z.enum(NOTE_KINDS).default("Note"),
  referenceDate: z.coerce.date().optional(),
  content: z.string().trim().min(2).max(8000)
});

export const overallEffectivenessSchema = z.object({
  result: z.enum(["Effective", "Not Effective"]),
  at: z.coerce.date().optional(),
  comments: z.string().trim().max(4000).optional().default("")
});

export type ComplaintCreateInput = z.infer<typeof complaintCreateSchema>;
export type ComplaintUpdateInput = z.infer<typeof complaintUpdateSchema>;
export type ComplaintListQuery = z.infer<typeof complaintListQuerySchema>;
export type StageCompleteInput = z.infer<typeof stageCompleteSchema>;
export type EightDInput = z.infer<typeof eightDSchema>;
