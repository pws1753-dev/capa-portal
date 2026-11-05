import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from "mongoose";
import { CAPA_EFFECTIVENESS, CAPA_STATUSES, CAPA_TYPES, EVIDENCE_REVIEW_STATUSES } from "@shared/constants/domain";

const EvidenceFileSchema = new Schema(
  {
    attachment: { type: Schema.Types.ObjectId, ref: "Attachment", required: true },
    description: { type: String, trim: true, default: "" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const EvidenceReviewSchema = new Schema(
  {
    status: { type: String, enum: EVIDENCE_REVIEW_STATUSES, default: "Pending" },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    at: { type: Date, default: null },
    remarks: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

/** Every review decision is appended so a rejection is never lost when evidence is re-uploaded. */
const EvidenceReviewHistorySchema = new Schema(
  {
    status: { type: String, enum: EVIDENCE_REVIEW_STATUSES, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const CapaSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, trim: true, index: true },
    complaint: { type: Schema.Types.ObjectId, ref: "Complaint", required: true, index: true },
    company: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    sequence: { type: Number, required: true },

    type: { type: String, enum: CAPA_TYPES, default: "Corrective" },
    action: { type: String, required: true, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", index: true },
    /** A Master Data employee without a portal login named as the action owner (the accountable portal user stays in `owner`). */
    ownerEmployee: { type: Schema.Types.ObjectId, ref: "Employee", index: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", index: true },
    priority: { type: Schema.Types.ObjectId, ref: "Priority" },

    assignedAt: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
    status: { type: String, enum: CAPA_STATUSES, default: "Open", index: true },

    evidence: { type: String, trim: true, default: "" },
    evidenceFiles: { type: [EvidenceFileSchema], default: [] },
    evidenceReview: { type: EvidenceReviewSchema, default: () => ({ status: "Pending" }) },
    evidenceReviewHistory: { type: [EvidenceReviewHistorySchema], default: [] },

    delayReason: { type: String, trim: true, default: "" },

    effectiveness: { type: String, enum: [...CAPA_EFFECTIVENESS, null], default: null, index: true },
    effectivenessVerifiedAt: { type: Date, default: null },
    effectivenessVerifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    effectivenessEvidence: { type: String, trim: true, default: "" },
    effectivenessEvidenceFiles: { type: [EvidenceFileSchema], default: [] },
    verificationMethod: { type: String, trim: true, default: "" },
    effectivenessRemarks: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

CapaSchema.index({ company: 1, status: 1, dueDate: 1 });
CapaSchema.index({ owner: 1, status: 1 });
CapaSchema.index({ complaint: 1, sequence: 1 });

export type CapaDocument = InferSchemaType<typeof CapaSchema> & { _id: mongoose.Types.ObjectId };
export type CapaHydrated = HydratedDocument<CapaDocument>;
export const Capa = (mongoose.models.Capa as Model<CapaDocument>) || mongoose.model<CapaDocument>("Capa", CapaSchema);
