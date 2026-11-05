import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { httpError, ok } from "../utils/http";
import { requireUser } from "../middleware/auth";
import { getSmtpStatus, verifySmtpConnection } from "../lib/mailer";
import {
  emailLogQuerySchema,
  emailRoutingSchema,
  emailTemplateSchema,
  emailTemplateUpdateSchema,
  retryEmailSchema,
  sendTestEmailSchema,
  shareReportSchema,
  templatePreviewSchema,
  templateTestSendSchema
} from "@shared/schemas/email";
import {
  createEmailTemplate,
  getEmailTemplateById,
  listEmailTemplates,
  previewEmailTemplate,
  updateEmailTemplate
} from "../services/email-template.service";
import { getEmailRouting, updateEmailRouting } from "../services/email-routing.service";
import { queryEmailLogs, getEmailLogById } from "../services/email-log.service";
import { retryEmail, sendRawTestEmail, sendTemplatedEmail } from "../services/email.service";
import { processEscalations } from "../services/escalation.service";
import { loadComplaintContext } from "../services/complaint.service";
import { getAppUrl } from "../lib/app-url";
import { EXTERNAL_ADDRESS_MESSAGE, isInternalAddress } from "../lib/email-policy";

export const emailRouter = Router();

function isMasterAdmin(req: { user?: { role?: { name?: string } } }) {
  return req.user?.role?.name === "Master Admin";
}

function assertMasterAdmin(req: { user?: { role?: { name?: string } } }) {
  if (!isMasterAdmin(req)) throw httpError(403, "Only Master Admin can access email administration");
}

emailRouter.get(
  "/settings",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, getSmtpStatus());
  })
);

emailRouter.get(
  "/routing",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, await getEmailRouting());
  })
);

emailRouter.put(
  "/routing",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = emailRoutingSchema.parse(req.body);
    return ok(res, await updateEmailRouting(input, req.user));
  })
);

emailRouter.post(
  "/settings/verify",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, await verifySmtpConnection());
  })
);

emailRouter.post(
  "/settings/test",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = sendTestEmailSchema.parse(req.body);
    return ok(res, await sendRawTestEmail(input));
  })
);

emailRouter.get(
  "/templates",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const triggerEvent = typeof req.query.triggerEvent === "string" ? req.query.triggerEvent : undefined;
    const activeOnly = req.query.activeOnly === "true";
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    return ok(res, await listEmailTemplates({ triggerEvent, activeOnly, search }));
  })
);

emailRouter.get(
  "/templates/:id",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, await getEmailTemplateById(req.params.id));
  })
);

emailRouter.post(
  "/templates",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = emailTemplateSchema.parse(req.body);
    return ok(res, await createEmailTemplate(input, req.user?.id), 201);
  })
);

emailRouter.patch(
  "/templates/:id",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = emailTemplateUpdateSchema.parse(req.body);
    return ok(res, await updateEmailTemplate(req.params.id, input, req.user?.id));
  })
);

emailRouter.post(
  "/templates/:id/preview",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = templatePreviewSchema.parse(req.body);
    return ok(res, await previewEmailTemplate(req.params.id, input));
  })
);

emailRouter.post(
  "/templates/:id/test-send",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = templateTestSendSchema.parse(req.body);
    const template = await getEmailTemplateById(req.params.id);
    return ok(
      res,
      await sendTemplatedEmail({
        triggerEvent: template.triggerEvent,
        recipients: [input.to],
        data: (input.sampleData || {}) as Record<string, string | number>,
        sentBySystem: false
      })
    );
  })
);

emailRouter.get(
  "/logs",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const query = emailLogQuerySchema.parse(req.query);
    return ok(res, await queryEmailLogs(query));
  })
);

emailRouter.get(
  "/logs/:id",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, await getEmailLogById(req.params.id));
  })
);

emailRouter.post(
  "/logs/retry",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    const input = retryEmailSchema.parse(req.body);
    return ok(res, await retryEmail(input.logId));
  })
);

emailRouter.post(
  "/escalation/run",
  requireUser,
  asyncHandler(async (req, res) => {
    assertMasterAdmin(req);
    return ok(res, await processEscalations());
  })
);

emailRouter.post(
  "/share-report",
  requireUser,
  asyncHandler(async (req, res) => {
    const input = shareReportSchema.parse(req.body);
    const permissions = req.user?.role?.permissions || [];
    const allowedToShare =
      permissions.includes("*") ||
      permissions.includes("report.all") ||
      permissions.includes("8d.approve") ||
      permissions.includes("complaint.assign");
    if (!allowedToShare) throw httpError(403, "You do not have permission to share complaint reports");
    // Reports carry customer and defect details, so they are shared with company addresses only.
    if (!isInternalAddress(input.recipientEmail)) throw httpError(400, EXTERNAL_ADDRESS_MESSAGE());

    const context = await loadComplaintContext(input.complaintId, req.user);
    const complaint = context.doc;
    const appUrl = getAppUrl();
    const reportUrl = `${appUrl}/complaints/${complaint._id}`;

    const result = await sendTemplatedEmail({
      triggerEvent: "COMPLAINT_REPORT_SHARED",
      recipients: [input.recipientEmail],
      relatedComplaintId: complaint._id,
      sentBySystem: false,
      data: {
        sharedBy: req.user?.name || "Quality Team",
        recipientName: input.recipientName,
        complaintNumber: complaint.number,
        customerName: complaint.customer || "Customer",
        partName: complaint.product || "Component",
        status: complaint.status,
        notes: input.notes || "Please find the formal Quality 8D report linked below.",
        reportUrl
      }
    });

    return ok(res, result);
  })
);
