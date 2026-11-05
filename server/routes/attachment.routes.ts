import { Router } from "express";
import { z } from "zod";
import { ALLOWED_UPLOAD_MIME_TYPES, ATTACHMENT_PURPOSES } from "@shared/constants/domain";
import { objectIdSchema } from "@shared/schemas/common";
import { connectDB } from "../config/db";
import { requireUser } from "../middleware/auth";
import { canEditCapa, canEditComplaint, canSeeCompany, hasPermission, isMasterAdmin } from "../domain/rbac";
import { Attachment } from "../models/Attachment";
import { Capa } from "../models/Capa";
import { Company } from "../models/Company";
import { confirmUpload, createUploadSignature, deleteAttachment, listAttachments } from "../services/attachment.service";
import { loadComplaintContext, requireActor } from "../services/complaint.service";
import { toDomainCapa } from "../services/mappers";
import { asyncHandler } from "../utils/async-handler";
import { httpError, ok } from "../utils/http";

export const attachmentRouter = Router();

attachmentRouter.use(requireUser);

const ENTITY_PURPOSES = {
  Complaint: ["complaint.attachment", "complaint.photo", "d6.document"],
  Capa: ["capa.evidence", "capa.effectiveness"],
  Company: ["company.logo"]
} as const;

async function capaContext(capaId: string, user: Parameters<typeof loadComplaintContext>[1]) {
  const capa = await Capa.findById(capaId);
  if (!capa) throw httpError(404, "CAPA not found");
  const complaint = await loadComplaintContext(String(capa.complaint), user);
  return { capa, complaint };
}

attachmentRouter.post(
  "/signature",
  asyncHandler(async (req, res) => {
    const input = z.object({ purpose: z.enum(ATTACHMENT_PURPOSES) }).parse(req.body);
    const actor = await requireActor(req.user);

    const allowed =
      isMasterAdmin(actor) ||
      (input.purpose === "company.logo" && isMasterAdmin(actor)) ||
      ((input.purpose === "capa.evidence" || input.purpose === "capa.effectiveness") &&
        (hasPermission(actor, "capa.edit.own") || hasPermission(actor, "complaint.assign") || hasPermission(actor, "capa.verify"))) ||
      ((input.purpose === "complaint.attachment" || input.purpose === "complaint.photo" || input.purpose === "d6.document") &&
        (hasPermission(actor, "complaint.create") ||
          hasPermission(actor, "complaint.edit") ||
          hasPermission(actor, "complaint.edit.own") ||
          hasPermission(actor, "complaint.edit.dept") ||
          hasPermission(actor, "complaint.assign")));

    if (!allowed) throw httpError(403, "You do not have permission to upload files for this purpose");
    return ok(res, createUploadSignature(input.purpose));
  })
);

attachmentRouter.post(
  "/confirm",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        publicId: z.string().trim().min(1).max(300),
        originalFilename: z.string().trim().min(1).max(255),
        mimeType: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
        entityType: z.enum(["Complaint", "Capa", "Company"]),
        entityId: objectIdSchema,
        purpose: z.enum(ATTACHMENT_PURPOSES),
        company: objectIdSchema.optional()
      })
      .parse(req.body);

    if (!(ENTITY_PURPOSES[input.entityType] as readonly string[]).includes(input.purpose)) {
      throw httpError(400, "Attachment purpose does not match the selected entity type");
    }

    await connectDB();
    if (input.entityType === "Complaint") {
      const context = await loadComplaintContext(input.entityId, req.user);
      if (!canEditComplaint(context.actor, context.domain)) throw httpError(403, "You cannot attach files to this complaint");
    } else if (input.entityType === "Capa") {
      const context = await capaContext(input.entityId, req.user);
      if (!canEditCapa(context.complaint.actor, toDomainCapa(context.capa), context.complaint.domain)) {
        throw httpError(403, "You cannot attach files to this CAPA");
      }
    } else {
      const actor = await requireActor(req.user);
      if (!isMasterAdmin(actor)) throw httpError(403, "Only a Master Admin can replace a company logo");
      const company = await Company.findById(input.entityId).select("_id").lean();
      if (!company) throw httpError(404, "Company not found");
    }

    // A complaint carries one photo: it must be an image, and a new one replaces the previous one.
    if (input.purpose === "complaint.photo" && !input.mimeType.startsWith("image/")) {
      throw httpError(400, "The complaint photo must be an image (JPG, PNG, WebP or similar)");
    }
    const attachment = await confirmUpload(input, req.user);
    if (input.purpose === "complaint.photo") {
      const previous = await Attachment.find({ entityType: "Complaint", entityId: input.entityId, purpose: "complaint.photo", _id: { $ne: attachment._id } })
        .select("_id")
        .lean();
      for (const old of previous) await deleteAttachment(String(old._id), req.user, true);
    }
    return ok(res, { attachment }, 201);
  })
);

attachmentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z.object({ entityType: z.enum(["Complaint", "Capa", "Company"]), entityId: objectIdSchema }).parse(req.query);
    await connectDB();

    if (query.entityType === "Complaint") {
      await loadComplaintContext(query.entityId, req.user);
    } else if (query.entityType === "Capa") {
      await capaContext(query.entityId, req.user);
    } else {
      const actor = await requireActor(req.user);
      if (!canSeeCompany(actor, query.entityId)) throw httpError(403, "You do not have access to this company");
      if (!(await Company.exists({ _id: query.entityId }))) throw httpError(404, "Company not found");
    }

    return ok(res, { attachments: await listAttachments(query.entityType, query.entityId) });
  })
);

attachmentRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await connectDB();
    const attachment = await Attachment.findById(req.params.id).lean();
    if (!attachment) throw httpError(404, "Attachment not found");

    const actor = await requireActor(req.user);
    let allowed = isMasterAdmin(actor);

    if (attachment.entityType === "Complaint") {
      const context = await loadComplaintContext(String(attachment.entityId), req.user);
      allowed = allowed || canEditComplaint(context.actor, context.domain);
    } else if (attachment.entityType === "Capa") {
      const context = await capaContext(String(attachment.entityId), req.user);
      allowed = allowed || canEditCapa(context.complaint.actor, toDomainCapa(context.capa), context.complaint.domain);
    } else if (attachment.entityType === "Company") {
      if (!canSeeCompany(actor, String(attachment.entityId))) throw httpError(403, "You do not have access to this company");
      allowed = isMasterAdmin(actor);
    }

    if (!allowed) throw httpError(403, "You do not have permission to delete this attachment");
    return ok(res, await deleteAttachment(req.params.id, req.user, true));
  })
);
