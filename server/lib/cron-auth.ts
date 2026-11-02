import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getEnv } from "../config/env";
import { httpError } from "../utils/http";

/**
 * Express middleware to protect cron automation endpoints.
 * Requires CRON_SECRET configured and passed via `x-cron-secret` header or `Authorization: Bearer <secret>`.
 */
export function requireCronAuth(req: Request, _res: Response, next: NextFunction) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    throw httpError(500, "CRON_SECRET is not configured on the server");
  }

  const authHeader = req.headers.authorization;
  const headerSecret = req.headers["x-cron-secret"];
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const provided = (typeof headerSecret === "string" ? headerSecret.trim() : null) || bearerSecret;

  const matches = provided !== null && provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!matches) {
    throw httpError(401, "Unauthorized cron execution");
  }

  next();
}
