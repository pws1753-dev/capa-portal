import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const EmailTemplateSchema = new Schema(
  {
    templateKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    templateName: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    htmlBody: { type: String, required: true },
    textBody: { type: String, required: true },
    supportedVariables: [{ type: String }],
    isActive: { type: Boolean, default: true, index: true },
    triggerEvent: { type: String, required: true, index: true },
    allowedRolesToReceive: [{ type: String }],
    /** Extra fixed To addresses. */
    toEmails: [{ type: String }],
    /** Extra fixed CC addresses. */
    ccRules: [{ type: String }],
    bccRules: [{ type: String }],
    /** Addresses never sent this email, wherever they would otherwise come from. */
    excludeEmails: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export type EmailTemplateDocument = InferSchemaType<typeof EmailTemplateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const EmailTemplate =
  (mongoose.models.EmailTemplate as Model<EmailTemplateDocument>) ||
  mongoose.model<EmailTemplateDocument>("EmailTemplate", EmailTemplateSchema);
