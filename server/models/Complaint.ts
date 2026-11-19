import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from "mongoose";
import {
  COMPLAINT_STATUSES,
  COMPLAINT_TYPES,
  D6_DOCUMENT_STATUSES,
  D6_DOCUMENT_TYPES,
  D7_LT_RESULTS,
  FISHBONE_CATEGORIES
} from "@shared/constants/domain";

const DelayReasonSchema = new Schema(
  {
    category: { type: String, required: true, trim: true },
    explanation: { type: String, required: true, trim: true },
    recovery: { type: String, trim: true },
    recordedAt: { type: Date, default: Date.now },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { _id: false }
);

const TeamMemberSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee" },
    name: { type: String, trim: true },
    dept: { type: String, trim: true },
    designation: { type: String, trim: true },
    email: { type: String, trim: true },
    role: { type: String, trim: true }
  },
  { _id: false }
);

const ActionRowSchema = new Schema(
  {
    action: { type: String, trim: true },
    resp: { type: String, trim: true },
    respEmployee: { type: Schema.Types.ObjectId, ref: "Employee" },
    target: { type: String, trim: true },
    targetAuto: { type: Boolean, default: false },
    status: { type: String, trim: true, default: "Open" },
    remarks: { type: String, trim: true },
    ctqImpact: { type: String, trim: true },
    customerApproval: { type: String, trim: true }
  },
  { _id: false }
);

const D6DocumentSchema = new Schema(
  {
    docType: { type: String, enum: D6_DOCUMENT_TYPES, required: true },
    status: { type: String, enum: D6_DOCUMENT_STATUSES, default: "Pending" },
    attachment: { type: Schema.Types.ObjectId, ref: "Attachment", default: null },
    revision: { type: String, trim: true },
    revDate: { type: String, trim: true },
    approver: { type: String, trim: true },
    naJustification: { type: String, trim: true }
  },
  { _id: false }
);

const SignatureSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    designation: { type: String, trim: true },
    department: { type: String, trim: true },
    email: { type: String, trim: true },
    at: { type: Date, required: true },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const WorkflowLogSchema = new Schema(
  {
    stage: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const RepeatLinkSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: "Complaint", required: true },
    number: { type: String, trim: true },
    basis: [{ type: String, trim: true }]
  },
  { _id: false }
);

const fishboneDefaults = () =>
  FISHBONE_CATEGORIES.reduce<Record<string, string[]>>((acc, category) => {
    acc[category] = [];
    return acc;
  }, {});

const d6DefaultList = () => D6_DOCUMENT_TYPES.map((docType) => ({ docType, status: "Pending" as const }));

const ComplaintSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, trim: true, index: true },
    company: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    type: { type: String, enum: COMPLAINT_TYPES, required: true, index: true },
    status: { type: String, enum: COMPLAINT_STATUSES, default: "Open", index: true },

    receivedAt: { type: Date, required: true, index: true },
    source: { type: String, trim: true },
    reportedBy: { type: String, trim: true },
    priority: { type: Schema.Types.ObjectId, ref: "Priority", required: true, index: true },

    customer: { type: String, trim: true, index: true },
    customerContact: { type: String, trim: true },
    customerLocation: { type: String, trim: true },
    project: { type: String, trim: true },
    customerPO: { type: String, trim: true },
    product: { type: String, trim: true, index: true },
    batch: { type: String, trim: true },

    internalDept: { type: Schema.Types.ObjectId, ref: "Department" },
    againstDept: { type: Schema.Types.ObjectId, ref: "Department" },
    responsibleDept: { type: Schema.Types.ObjectId, ref: "Department", index: true },

    category: { type: String, trim: true, index: true },
    subCategory: { type: String, trim: true },
    description: { type: String, required: true, trim: true },

    owner: { type: Schema.Types.ObjectId, ref: "User", index: true },
    /** Directory employee named as owner when they have no portal login; `owner` stays the accountable user. */
    ownerEmployee: { type: Schema.Types.ObjectId, ref: "Employee", index: true },
    /** Company addresses copied on every automated email concerning this complaint or one of its CAPAs. */
    relatedEmails: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },

    acknowledgedAt: { type: Date, default: null },
    ackDelayReason: { type: DelayReasonSchema, default: null },
    containmentAt: { type: Date, default: null },
    containmentNotes: { type: String, trim: true, default: "" },
    contDelayReason: { type: DelayReasonSchema, default: null },
    rcaAt: { type: Date, default: null },
    rcaDelayReason: { type: DelayReasonSchema, default: null },
    capaAssignedAt: { type: Date, default: null },
    capaDelayReason: { type: DelayReasonSchema, default: null },

    closedAt: { type: Date, default: null, index: true },
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    closureRemarks: { type: String, trim: true, default: "" },
    reopenedAt: { type: Date, default: null },
    reopenReason: { type: String, trim: true },

    isRepeat: { type: Boolean, default: false, index: true },
    repeatOf: { type: [RepeatLinkSchema], default: [] },
    repeatBasis: { type: String, trim: true, default: "" },
    repeatReviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    repeatReviewedAt: { type: Date, default: null },
    repeatReviewRemarks: { type: String, trim: true },

    d0: { type: String, trim: true, default: "" },
    d1Team: { type: [TeamMemberSchema], default: [] },
    d2: {
      what: { type: String, trim: true, default: "" },
      where: { type: String, trim: true, default: "" },
      when: { type: String, trim: true, default: "" },
      who: { type: String, trim: true, default: "" },
      involved: { type: String, trim: true, default: "" },
      howMany: { type: String, trim: true, default: "" },
      how: { type: String, trim: true, default: "" }
    },
    d3Actions: { type: [ActionRowSchema], default: [] },
    d4QcTools: { type: [String], default: [] },
    d4Occurrence: { type: String, trim: true, default: "" },
    d4Escape: { type: String, trim: true, default: "" },
    d4Systemic: { type: String, trim: true, default: "" },
    rootCauseCategory: { type: String, trim: true, index: true },
    fiveWhy: {
      occurrence: { type: [String], default: [] },
      escape: { type: [String], default: [] },
      systemic: { type: [String], default: [] },
      singleChain: { type: [String], default: [] }
    },
    fishbone: { type: Schema.Types.Mixed, default: fishboneDefaults },

    d5Occurrence: { type: [ActionRowSchema], default: [] },
    d5Escape: { type: [ActionRowSchema], default: [] },
    d5Systemic: { type: [ActionRowSchema], default: [] },
    d5Safety: { type: String, trim: true, default: "" },

    d6Verify: { type: [ActionRowSchema], default: [] },
    d6DocsList: { type: [D6DocumentSchema], default: d6DefaultList },
    d6Horizontal: { type: String, trim: true, default: "" },

    d7ShortTermDate: { type: String, trim: true, default: "" },
    d7RepeatObserved: { type: Boolean, default: false },
    d7Regulatory: { type: String, trim: true, default: "" },
    d7Actions: { type: [ActionRowSchema], default: [] },
    d7NoRepeatConfirmed: { type: Boolean, default: false },
    d7LongTermDate: { type: String, trim: true, default: "" },
    d7LongTermRepeatObserved: { type: Boolean, default: false },
    d7LongTermResult: { type: String, enum: [...D7_LT_RESULTS, ""], default: "" },
    d7LongTermNotes: { type: String, trim: true, default: "" },

    d8Recognition: { type: String, trim: true, default: "" },
    d8ReviewedBy: { type: String, trim: true, default: "" },
    d8ClosedDate: { type: String, trim: true, default: "" },

    /** Internal complaints use a reduced investigation instead of the full 8D. */
    internalInvestigation: {
      summary: { type: String, trim: true, default: "" },
      findings: { type: String, trim: true, default: "" },
      correctiveAction: { type: String, trim: true, default: "" },
      evidence: { type: String, trim: true, default: "" }
    },

    overallEffectiveness: {
      result: { type: String, trim: true, default: "" },
      at: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User" },
      comments: { type: String, trim: true, default: "" }
    },

    signatures: {
      prepared: { type: SignatureSchema, default: null },
      reviewed: { type: SignatureSchema, default: null },
      approved: { type: SignatureSchema, default: null }
    },

    workflowLog: { type: [WorkflowLogSchema], default: [] }
  },
  { timestamps: true }
);

ComplaintSchema.index({ company: 1, status: 1, receivedAt: -1 });
ComplaintSchema.index({ company: 1, category: 1, customer: 1, receivedAt: -1 });
ComplaintSchema.index({ company: 1, product: 1, receivedAt: -1 });
ComplaintSchema.index({ owner: 1, status: 1 });
ComplaintSchema.index({ responsibleDept: 1, status: 1 });
ComplaintSchema.index({ number: "text", description: "text", customer: "text", product: "text", project: "text" });

export type ComplaintDocument = InferSchemaType<typeof ComplaintSchema> & { _id: mongoose.Types.ObjectId };
export type ComplaintHydrated = HydratedDocument<ComplaintDocument>;
export const Complaint =
  (mongoose.models.Complaint as Model<ComplaintDocument>) || mongoose.model<ComplaintDocument>("Complaint", ComplaintSchema);
