import { z } from "zod";
import { CAPA_EFFECTIVENESS, CAPA_STATUSES, CAPA_TYPES, EVIDENCE_REVIEW_STATUSES } from "../constants/domain";
import { listQuerySchema, objectIdSchema } from "./common";

const capaBaseSchema = z.object({
  type: z.enum(CAPA_TYPES).default("Corrective"),
  action: z.string().trim().min(5, "Describe the action in at least 5 characters").max(4000),
  owner: objectIdSchema.optional(),
  ownerEmployee: objectIdSchema.optional(),
  department: objectIdSchema.optional(),
  priority: objectIdSchema.optional(),
  dueDate: z.coerce.date(),
  status: z.enum(CAPA_STATUSES).default("Open"),
  evidence: z.string().trim().max(4000).optional().default("")
});

export const capaCreateSchema = capaBaseSchema.refine((value) => Boolean(value.owner || value.ownerEmployee), {
  message: "Select an owner",
  path: ["owner"]
});

export const capaUpdateSchema = capaBaseSchema.partial().extend({
  completedAt: z.coerce.date().optional(),
  delayReason: z.string().trim().max(200).optional()
});

export const capaListQuerySchema = listQuerySchema.extend({
  company: objectIdSchema.optional(),
  complaint: objectIdSchema.optional(),
  owner: objectIdSchema.optional(),
  department: objectIdSchema.optional(),
  status: z.enum(CAPA_STATUSES).optional(),
  type: z.enum(CAPA_TYPES).optional(),
  effectiveness: z.enum(CAPA_EFFECTIVENESS).optional(),
  evidenceReview: z.enum(EVIDENCE_REVIEW_STATUSES).optional(),
  overdue: z.coerce.boolean().optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional()
});

export const evidenceReviewSchema = z.object({
  decision: z.enum(["Accepted", "Rejected"]),
  remarks: z.string().trim().max(4000).optional().default("")
});

export const effectivenessSchema = z.object({
  result: z.enum(CAPA_EFFECTIVENESS),
  verificationMethod: z.string().trim().min(2, "Verification method is required").max(400),
  effectivenessEvidence: z.string().trim().min(2, "Evidence reference is required").max(4000),
  remarks: z.string().trim().max(4000).optional().default(""),
  verifiedAt: z.coerce.date().optional()
});

export type CapaCreateInput = z.infer<typeof capaCreateSchema>;
export type CapaListQuery = z.infer<typeof capaListQuerySchema>;
export type EffectivenessInput = z.infer<typeof effectivenessSchema>;
