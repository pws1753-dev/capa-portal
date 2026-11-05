import { v2 as cloudinary } from "cloudinary";
import { Types } from "mongoose";
import type { ApiUser } from "@shared/types/api";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, type AttachmentPurpose } from "@shared/constants/domain";
import { buildAttachmentMetadata, sanitizeFilename, validateUpload } from "../domain/upload-rules";
import { Attachment } from "../models/Attachment";
import { getEnv } from "../config/env";
import { businessRuleError, httpError } from "../utils/http";
import { writeAudit } from "./audit.service";

const SAFE_FOLDER = /^[a-zA-Z0-9_-]{1,64}$/;

function configuredCloudinary() {
  const env = getEnv();
  const missing = (["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const).filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    // Names only: the values are secrets and never leave the server.
    throw httpError(503, `Cloudinary is not configured on this environment (empty or missing: ${missing.join(", ")})`);
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true
  });
  return { cloudinary, env };
}

function folderFor(purpose: AttachmentPurpose) {
  const suffix = purpose.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!SAFE_FOLDER.test(suffix)) throw httpError(400, "Invalid upload folder");
  const env = getEnv();
  return `${env.CLOUDINARY_UPLOAD_FOLDER || "onepws-complaint-capa"}/${suffix}`;
}

/**
 * Signed direct upload. The browser talks to Cloudinary with a short lived signature,
 * so the API secret never reaches the client and no file ever passes through the API.
 */
export function createUploadSignature(purpose: AttachmentPurpose) {
  const { cloudinary: client, env } = configuredCloudinary();
  const timestamp = Math.round(Date.now() / 1000);
  const folder = folderFor(purpose);
  const signature = client.utils.api_sign_request({ timestamp, folder }, env.CLOUDINARY_API_SECRET as string);
  return {
    timestamp,
    folder,
    signature,
    apiKey: env.CLOUDINARY_API_KEY as string,
    cloudName: env.CLOUDINARY_CLOUD_NAME as string,
    maxBytes: MAX_UPLOAD_BYTES,
    allowedMimeTypes: [...ALLOWED_UPLOAD_MIME_TYPES]
  };
}

export type ConfirmUploadInput = {
  publicId: string;
  originalFilename: string;
  mimeType: string;
  entityType: string;
  entityId: string;
  purpose: AttachmentPurpose;
  company?: string;
};

/**
 * The client only reports a public id. Size, type and URL are read back from Cloudinary
 * so a tampered client cannot register an oversized or unsupported asset.
 */
export async function confirmUpload(input: ConfirmUploadInput, user: ApiUser | undefined) {
  if (!user) throw httpError(401, "Unauthorized");
  const { cloudinary: client } = configuredCloudinary();
  const folder = folderFor(input.purpose);
  if (!input.publicId.startsWith(`${folder}/`)) {
    throw businessRuleError("This asset does not belong to the declared upload folder", [
      { field: "publicId", message: "Upload the file with the signature issued for this purpose" }
    ]);
  }

  type CloudinaryResource = { public_id?: string; secure_url?: string; resource_type?: string; bytes?: number; width?: number; height?: number };
  let resource: CloudinaryResource | null = null;
  // "auto" only exists for uploads; the lookup API needs the concrete type the asset was stored under.
  for (const resourceType of ["image", "video", "raw"] as const) {
    try {
      resource = (await client.api.resource(input.publicId, { resource_type: resourceType })) as CloudinaryResource;
      break;
    } catch (error) {
      const failure = error as { http_code?: number; error?: { http_code?: number; message?: string }; message?: string };
      const status = failure.http_code ?? failure.error?.http_code;
      if (status !== undefined && status !== 404) {
        // Not "asset not found" but a rejected request (bad credentials, rate limit): say so.
        const reason = failure.error?.message ?? failure.message ?? "unknown error";
        throw httpError(502, `Cloudinary rejected the verification request (HTTP ${status}: ${reason})`);
      }
    }
  }
  if (!resource) throw httpError(404, "The uploaded asset could not be found on Cloudinary");

  const issues = validateUpload({
    originalname: input.originalFilename,
    mimetype: input.mimeType,
    size: resource.bytes ?? 0
  });
  if (issues.length > 0) {
    await client.uploader.destroy(input.publicId, { resource_type: resource.resource_type ?? "raw" }).catch(() => undefined);
    throw businessRuleError("This file was rejected", issues);
  }

  const metadata = buildAttachmentMetadata(resource, {
    originalname: input.originalFilename,
    mimetype: input.mimeType,
    size: resource.bytes ?? 0
  });

  const attachment = await Attachment.create({
    ...metadata,
    entityType: input.entityType,
    entityId: new Types.ObjectId(input.entityId),
    purpose: input.purpose,
    company: input.company ? new Types.ObjectId(input.company) : undefined,
    uploadedBy: new Types.ObjectId(user.id),
    uploadedAt: new Date()
  });

  await writeAudit({
    actor: user,
    action: "UPLOAD",
    entity: "Attachment",
    entityId: String(attachment._id),
    after: { filename: metadata.originalFilename, bytes: metadata.bytes, purpose: input.purpose }
  });

  return attachment;
}

export async function listAttachments(entityType: string, entityId: string) {
  if (!Types.ObjectId.isValid(entityId)) throw httpError(400, "Invalid entity id");
  return Attachment.find({ entityType, entityId }).populate("uploadedBy", "name").sort({ createdAt: -1 }).lean();
}

/** Deleting the database record also removes the Cloudinary asset so nothing is orphaned. */
export async function deleteAttachment(attachmentId: string, user: ApiUser | undefined, allowed: boolean) {
  if (!user) throw httpError(401, "Unauthorized");
  if (!allowed) throw httpError(403, "You do not have permission to delete this file");
  if (!Types.ObjectId.isValid(attachmentId)) throw httpError(400, "Invalid attachment id");

  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) throw httpError(404, "Attachment not found");

  const { cloudinary: client } = configuredCloudinary();
  await client.uploader.destroy(attachment.publicId, { resource_type: attachment.resourceType }).catch(() => undefined);
  await Attachment.deleteOne({ _id: attachment._id });

  await writeAudit({
    actor: user,
    action: "DELETE_ATTACHMENT",
    entity: "Attachment",
    entityId: attachmentId,
    before: { filename: attachment.originalFilename, publicId: attachment.publicId }
  });

  return { deleted: true, filename: sanitizeFilename(attachment.originalFilename) };
}

/**
 * Removes every attachment of the given records together with its Cloudinary asset. Used when a complaint
 * is deleted, so nothing is orphaned. A Cloudinary failure never blocks the deletion of the database record.
 */
export async function purgeAttachmentsFor(entityType: "Complaint" | "Capa", entityIds: Types.ObjectId[]): Promise<number> {
  if (entityIds.length === 0) return 0;
  const attachments = await Attachment.find({ entityType, entityId: { $in: entityIds } }).lean();
  if (attachments.length === 0) return 0;
  try {
    const { cloudinary: client } = configuredCloudinary();
    for (const attachment of attachments) {
      await client.uploader.destroy(attachment.publicId, { resource_type: attachment.resourceType }).catch(() => undefined);
    }
  } catch {
    // Cloudinary is not configured here: the records are still removed.
  }
  await Attachment.deleteMany({ _id: { $in: attachments.map((attachment) => attachment._id) } });
  return attachments.length;
}
