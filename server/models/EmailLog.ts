import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const EmailLogSchema = new Schema(
  {
    templateKey: { type: String, index: true },
    triggerEvent: { type: String, required: true, index: true },
    recipients: [{ type: String, index: true }],
    cc: [{ type: String }],
    bcc: [{ type: String }],
    subject: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      required: true,
      index: true
    },
    errorMessage: { type: String },
    relatedComplaintId: { type: Schema.Types.ObjectId, ref: "Complaint", index: true },
    relatedCapaId: { type: Schema.Types.ObjectId, ref: "Capa", index: true },
    sentBySystem: { type: Boolean, default: true },
    payload: { type: Schema.Types.Mixed }, // Safe context for retry, NEVER credentials
    dedupeKey: { type: String, sparse: true, index: true },
    attemptCount: { type: Number, default: 1 },
    /** One thread per complaint (CAPA emails join their complaint's thread). */
    threadKey: { type: String, index: true },
    messageId: { type: String },
    /** True for automated reminder/escalation emails, which are numbered within the thread. */
    automated: { type: Boolean, default: false },
    reminderCount: { type: Number },
    daysDelayed: { type: Number }
  },
  { timestamps: true }
);

EmailLogSchema.index({ createdAt: -1 });

export type EmailLogDocument = InferSchemaType<typeof EmailLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const EmailLog =
  (mongoose.models.EmailLog as Model<EmailLogDocument>) ||
  mongoose.model<EmailLogDocument>("EmailLog", EmailLogSchema);
