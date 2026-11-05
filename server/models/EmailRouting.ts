import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Portal-wide email recipient rules, kept in one document (key "global") so an administrator can change
 * them without a deployment.
 */
const EmailRoutingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    /** Copied on every complaint and CAPA email. Empty/unset means the built-in common mailboxes. */
    commonCc: { type: [String], default: undefined },
    /** Never emailed (To, CC or BCC) by any portal email, wherever the address would otherwise come from. */
    excludeEmails: { type: [String], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export type EmailRoutingDocument = InferSchemaType<typeof EmailRoutingSchema> & { _id: mongoose.Types.ObjectId };
export const EmailRouting =
  (mongoose.models.EmailRouting as Model<EmailRoutingDocument>) || mongoose.model<EmailRoutingDocument>("EmailRouting", EmailRoutingSchema);
