import { z } from "zod";
import { EMAIL_TRIGGER_EVENTS } from "../constants/domain";

const emailListSchema = z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).max(50).default([]);

export const emailTemplateSchema = z.object({
  templateKey: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Template key must contain only lowercase letters, numbers, and hyphens"),
  templateName: z.string().min(2).max(120),
  triggerEvent: z.enum(EMAIL_TRIGGER_EVENTS),
  subject: z.string().min(1).max(250),
  htmlBody: z.string().min(1),
  textBody: z.string().min(1),
  supportedVariables: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  allowedRolesToReceive: z.array(z.string()).default([]),
  /** Extra fixed To addresses for this email. */
  toEmails: emailListSchema,
  /** Extra fixed CC addresses for this email. */
  ccRules: emailListSchema,
  bccRules: emailListSchema,
  /** Addresses removed from this email wherever they would otherwise come from. */
  excludeEmails: emailListSchema
});

export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

export const emailRoutingSchema = z.object({
  commonCc: emailListSchema,
  excludeEmails: emailListSchema
});
export type EmailRoutingInput = z.infer<typeof emailRoutingSchema>;

export const emailTemplateUpdateSchema = emailTemplateSchema.partial().omit({ templateKey: true });
export type EmailTemplateUpdateInput = z.infer<typeof emailTemplateUpdateSchema>;

export const sendTestEmailSchema = z.object({
  to: z.string().email("Please provide a valid recipient email address"),
  subject: z.string().optional(),
  message: z.string().optional()
});
export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema>;

export const templateTestSendSchema = z.object({
  to: z.string().email("Please provide a valid recipient email address"),
  sampleData: z.record(z.union([z.string(), z.number()])).optional()
});
export type TemplateTestSendInput = z.infer<typeof templateTestSendSchema>;

export const templatePreviewSchema = z.object({
  htmlBody: z.string().optional(),
  textBody: z.string().optional(),
  subject: z.string().optional(),
  sampleData: z.record(z.union([z.string(), z.number()])).optional()
});
export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>;

export const emailLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["sent", "failed", "skipped", "all"]).optional().default("all"),
  triggerEvent: z.string().optional(),
  templateKey: z.string().optional(),
  recipient: z.string().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});
export type EmailLogQueryInput = z.infer<typeof emailLogQuerySchema>;

export const retryEmailSchema = z.object({
  logId: z.string().min(1, "Log ID is required")
});
export type RetryEmailInput = z.infer<typeof retryEmailSchema>;

export const shareReportSchema = z.object({
  complaintId: z.string().min(1, "Complaint ID is required"),
  recipientEmail: z.string().email("Valid recipient email is required"),
  recipientName: z.string().min(1, "Recipient name is required"),
  notes: z.string().optional()
});
export type ShareReportInput = z.infer<typeof shareReportSchema>;
