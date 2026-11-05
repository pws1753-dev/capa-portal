import { Types } from "mongoose";
import { connectDB } from "../config/db";
import { EmailTemplate } from "../models/EmailTemplate";
import { DEFAULT_EMAIL_TEMPLATES, SUPERSEDED_DEFAULT_BODY_MARKERS, SUPERSEDED_DEFAULT_SUBJECTS } from "../lib/email-template-defaults";
import {
  getSampleVariables,
  renderTemplate,
  variablesInTemplate
} from "../lib/email-template-renderer";
import type { EmailTemplateInput, EmailTemplateUpdateInput } from "@shared/schemas/email";
import { httpError } from "../utils/http";

/**
 * Seeds missing default templates into MongoDB.
 * Does NOT overwrite existing templates modified by administrators.
 */
export async function seedDefaultTemplates(): Promise<number> {
  await connectDB();
  let seededCount = 0;

  for (const defaultTmpl of DEFAULT_EMAIL_TEMPLATES) {
    const existing = await EmailTemplate.findOne({ templateKey: defaultTmpl.templateKey });
    if (!existing) {
      const vars =
        defaultTmpl.supportedVariables && defaultTmpl.supportedVariables.length > 0
          ? defaultTmpl.supportedVariables
          : variablesInTemplate(defaultTmpl.subject, defaultTmpl.htmlBody, defaultTmpl.textBody);

      await EmailTemplate.create({
        ...defaultTmpl,
        supportedVariables: vars,
        isActive: true
      });
      seededCount++;
    }
  }

  return seededCount;
}

export async function listEmailTemplates(filter?: { triggerEvent?: string; activeOnly?: boolean; search?: string }) {
  await connectDB();
  await seedDefaultTemplates();

  const query: Record<string, unknown> = {};
  if (filter?.triggerEvent) {
    query.triggerEvent = filter.triggerEvent;
  }
  if (filter?.activeOnly) {
    query.isActive = true;
  }
  if (filter?.search && filter.search.trim().length > 0) {
    const s = filter.search.trim();
    query.$or = [
      { templateName: { $regex: s, $options: "i" } },
      { templateKey: { $regex: s, $options: "i" } },
      { subject: { $regex: s, $options: "i" } }
    ];
  }

  return EmailTemplate.find(query)
    .sort({ triggerEvent: 1, templateName: 1 })
    .populate("updatedBy", "name username")
    .lean();
}

export async function getEmailTemplateById(id: string) {
  if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid template ID");
  await connectDB();
  const template = await EmailTemplate.findById(id).populate("updatedBy", "name username").lean();
  if (!template) throw httpError(404, "Email template not found");
  return template;
}

export async function getActiveTemplateByTrigger(triggerEvent: string): Promise<{
  templateKey: string;
  templateName: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  supportedVariables: string[];
  toEmails?: string[];
  ccRules?: string[];
  bccRules?: string[];
  excludeEmails?: string[];
} | null> {
  await connectDB();
  const doc = await EmailTemplate.findOne({ triggerEvent, isActive: true }).lean();
  if (doc) {
    // Upgrade a never-edited template that still has an old, overly long default subject.
    const current = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateKey === doc.templateKey);
    const marker = SUPERSEDED_DEFAULT_BODY_MARKERS[doc.templateKey];
    if (current && marker && doc.htmlBody.includes(marker)) {
      const upgrade = { subject: current.subject, htmlBody: current.htmlBody, textBody: current.textBody, supportedVariables: current.supportedVariables };
      await EmailTemplate.updateOne({ _id: doc._id }, upgrade);
      return { ...doc, ...upgrade };
    }
    if (current && SUPERSEDED_DEFAULT_SUBJECTS[doc.templateKey]?.includes(doc.subject)) {
      await EmailTemplate.updateOne({ _id: doc._id }, { subject: current.subject });
      return { ...doc, subject: current.subject };
    }
    return doc;
  }

  // A template an administrator switched off must stay off. The built-in default is used only when no
  // template exists in the database for this event at all (a fresh install before seeding).
  const switchedOff = await EmailTemplate.exists({ triggerEvent, isActive: false });
  if (switchedOff) return null;

  const fallback = DEFAULT_EMAIL_TEMPLATES.find((t) => t.triggerEvent === triggerEvent);
  return fallback || null;
}

export async function createEmailTemplate(input: EmailTemplateInput, userId?: string) {
  await connectDB();
  const key = input.templateKey.toLowerCase().trim();
  const existing = await EmailTemplate.findOne({ templateKey: key });
  if (existing) {
    throw httpError(400, `Template key '${key}' is already in use`);
  }

  const vars =
    input.supportedVariables.length > 0
      ? input.supportedVariables
      : variablesInTemplate(input.subject, input.htmlBody, input.textBody);

  return EmailTemplate.create({
    ...input,
    templateKey: key,
    supportedVariables: vars,
    createdBy: userId,
    updatedBy: userId
  });
}

export async function updateEmailTemplate(id: string, input: EmailTemplateUpdateInput, userId?: string) {
  if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid template ID");
  await connectDB();

  const existing = await EmailTemplate.findById(id);
  if (!existing) throw httpError(404, "Email template not found");

  if (input.subject !== undefined) existing.subject = input.subject;
  if (input.htmlBody !== undefined) existing.htmlBody = input.htmlBody;
  if (input.textBody !== undefined) existing.textBody = input.textBody;
  if (input.templateName !== undefined) existing.templateName = input.templateName;
  if (input.triggerEvent !== undefined) existing.triggerEvent = input.triggerEvent;
  if (input.isActive !== undefined) existing.isActive = input.isActive;
  if (input.allowedRolesToReceive !== undefined) existing.allowedRolesToReceive = input.allowedRolesToReceive;
  if (input.toEmails !== undefined) existing.toEmails = input.toEmails;
  if (input.excludeEmails !== undefined) existing.excludeEmails = input.excludeEmails;
  if (input.ccRules !== undefined) existing.ccRules = input.ccRules;
  if (input.bccRules !== undefined) existing.bccRules = input.bccRules;

  existing.supportedVariables = variablesInTemplate(existing.subject, existing.htmlBody, existing.textBody);
  if (userId) existing.updatedBy = new Types.ObjectId(userId);

  await existing.save();
  return existing.toObject();
}

export async function previewEmailTemplate(
  templateIdOrTrigger: string,
  overrides?: { htmlBody?: string; textBody?: string; subject?: string; sampleData?: Record<string, string | number> }
) {
  await connectDB();
  let html = overrides?.htmlBody;
  let text = overrides?.textBody;
  let subject = overrides?.subject;
  let triggerEvent = "COMPLAINT_CREATED";

  if (!html || !subject) {
    if (Types.ObjectId.isValid(templateIdOrTrigger)) {
      const doc = await EmailTemplate.findById(templateIdOrTrigger).lean();
      if (doc) {
        html = html || doc.htmlBody;
        text = text || doc.textBody;
        subject = subject || doc.subject;
        triggerEvent = doc.triggerEvent;
      }
    } else {
      const doc = await EmailTemplate.findOne({ triggerEvent: templateIdOrTrigger, isActive: true }).lean();
      if (doc) {
        html = html || doc.htmlBody;
        text = text || doc.textBody;
        subject = subject || doc.subject;
        triggerEvent = doc.triggerEvent;
      } else {
        const fallback = DEFAULT_EMAIL_TEMPLATES.find((t) => t.triggerEvent === templateIdOrTrigger);
        if (fallback) {
          html = html || fallback.htmlBody;
          text = text || fallback.textBody;
          subject = subject || fallback.subject;
          triggerEvent = fallback.triggerEvent;
        }
      }
    }
  }

  const sample = {
    ...getSampleVariables(triggerEvent),
    ...(overrides?.sampleData || {})
  };

  const renderedSubject = renderTemplate(subject || "", sample);
  const renderedHtml = renderTemplate(html || "", sample);
  const renderedText = renderTemplate(text || "", sample);

  return {
    subject: renderedSubject.rendered,
    html: renderedHtml.rendered,
    text: renderedText.rendered,
    missingVariables: [
      ...new Set([
        ...renderedSubject.missingVariables,
        ...renderedHtml.missingVariables,
        ...renderedText.missingVariables
      ])
    ],
    sampleDataUsed: sample
  };
}
