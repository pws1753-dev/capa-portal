import { Router } from "express";
import { z } from "zod";
import { COMPLAINT_TYPES, FISHBONE_CATEGORIES, QC_TOOLS } from "@shared/constants/domain";
import { objectIdSchema } from "@shared/schemas/common";
import {
  categorySchema,
  escalationConfigSchema,
  numberingConfigSchema,
  prioritySchema,
  simpleListItemSchema,
  tatConfigSchema
} from "@shared/schemas/configuration";
import { connectDB } from "../config/db";
import { requirePermission, requireUser } from "../middleware/auth";
import { Capa } from "../models/Capa";
import { Complaint } from "../models/Complaint";
import { EscalationConfiguration, NumberingConfiguration, TATConfiguration } from "../models/configuration";
import { Category, DelayReason, Priority, RootCauseCategory } from "../models/masters";
import { resolveEscalation, resolveTatConfig } from "../services/config.service";
import { writeAudit } from "../services/audit.service";
import { assertDeletable } from "../services/master-delete.service";
import { asyncHandler } from "../utils/async-handler";
import { httpError, ok } from "../utils/http";

export const configurationRouter = Router();

configurationRouter.use(requireUser);

/** Everything the client needs to render complaint, 8D, CAPA and master configuration screens without hardcoded lists. */
configurationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    await connectDB();
    const company = typeof req.query.company === "string" && req.query.company ? req.query.company : null;
    const basic = req.query.view === "basic";
    const [tat, escalation, delayReasonItems, categories, priorities, rootCauseCategories, numbering] = await Promise.all([
      basic ? Promise.resolve({}) : resolveTatConfig(company),
      basic ? Promise.resolve({ levels: [], reminderPercentages: [] }) : resolveEscalation(company),
      basic ? Promise.resolve([]) : DelayReason.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
      Category.find({ active: true }).sort({ complaintType: 1, order: 1, name: 1 }).lean(),
      Priority.find({ active: true }).sort({ order: 1 }).lean(),
      basic ? Promise.resolve([]) : RootCauseCategory.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
      !basic && company ? NumberingConfiguration.findOne({ company, active: true }).lean() : Promise.resolve(null)
    ]);
    return ok(res, {
      tat,
      escalation,
      numbering,
      delayReasons: delayReasonItems.map((item) => item.name),
      delayReasonItems,
      categories,
      priorities,
      rootCauseCategories,
      fishboneCategories: FISHBONE_CATEGORIES,
      qcTools: QC_TOOLS,
      complaintTypes: COMPLAINT_TYPES
    });
  })
);

configurationRouter.put(
  "/tat",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = tatConfigSchema.parse(req.body);
    await connectDB();
    const company = input.company ?? null;
    const before = await TATConfiguration.findOne({ company }).lean();
    const config = await TATConfiguration.findOneAndUpdate({ company }, { ...input, company }, { new: true, upsert: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "TATConfiguration", entityId: String(config._id), before, after: input });
    return ok(res, { config });
  })
);

configurationRouter.put(
  "/escalation",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = escalationConfigSchema.parse(req.body);
    await connectDB();
    const company = input.company ?? null;
    const before = await EscalationConfiguration.findOne({ company }).lean();
    const config = await EscalationConfiguration.findOneAndUpdate({ company }, { ...input, company }, { new: true, upsert: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "EscalationConfiguration", entityId: String(config._id), before, after: input });
    return ok(res, { config });
  })
);

configurationRouter.put(
  "/numbering",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = numberingConfigSchema.parse(req.body);
    await connectDB();
    const before = await NumberingConfiguration.findOne({ company: input.company }).lean();
    const config = await NumberingConfiguration.findOneAndUpdate({ company: input.company }, input, { new: true, upsert: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "NumberingConfiguration", entityId: String(config._id), before, after: input });
    return ok(res, { config });
  })
);

const listModels = {
  "delay-reasons": DelayReason,
  "root-cause-categories": RootCauseCategory
} as const;

type ListKey = keyof typeof listModels;

configurationRouter.post(
  "/lists/:list",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const key = req.params.list as ListKey;
    const model = listModels[key];
    if (!model) throw httpError(404, "Unknown configuration list");
    const input = simpleListItemSchema.parse(req.body);
    await connectDB();
    const created = await model.findOneAndUpdate({ name: input.name }, input, { new: true, upsert: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: key, entityId: String(created._id), after: input });
    return ok(res, { item: created }, 201);
  })
);

configurationRouter.patch(
  "/lists/:list/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const key = req.params.list as ListKey;
    const model = listModels[key];
    if (!model) throw httpError(404, "Unknown configuration list");
    const input = simpleListItemSchema.partial().parse(req.body);
    await connectDB();
    const before = await model.findById(req.params.id).lean();
    if (!before) throw httpError(404, "Item not found");
    const updated = await model.findByIdAndUpdate(req.params.id, input, { new: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: key, entityId: req.params.id, before, after: input });
    return ok(res, { item: updated });
  })
);

configurationRouter.post(
  "/categories",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = categorySchema.parse(req.body);
    await connectDB();
    const category = await Category.findOneAndUpdate(
      { name: input.name, complaintType: input.complaintType, parent: input.parent ?? null },
      { ...input, parent: input.parent ?? null },
      { new: true, upsert: true }
    );
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "Category", entityId: String(category._id), after: input });
    return ok(res, { category }, 201);
  })
);

configurationRouter.patch(
  "/categories/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = categorySchema.partial().parse(req.body);
    const params = z.object({ id: objectIdSchema }).parse(req.params);
    await connectDB();
    const before = await Category.findById(params.id).lean();
    if (!before) throw httpError(404, "Category not found");
    const category = await Category.findByIdAndUpdate(params.id, input, { new: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "Category", entityId: params.id, before, after: input });
    return ok(res, { category });
  })
);

configurationRouter.post(
  "/priorities",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = prioritySchema.parse(req.body);
    await connectDB();
    const priority = await Priority.findOneAndUpdate({ name: input.name }, input, { new: true, upsert: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "Priority", entityId: String(priority._id), after: input });
    return ok(res, { priority }, 201);
  })
);

configurationRouter.patch(
  "/priorities/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = prioritySchema.partial().parse(req.body);
    const params = z.object({ id: objectIdSchema }).parse(req.params);
    await connectDB();
    const before = await Priority.findById(params.id).lean();
    if (!before) throw httpError(404, "Priority not found");
    const priority = await Priority.findByIdAndUpdate(params.id, input, { new: true });
    await writeAudit({ actor: req.user, action: "MASTER_DATA_CHANGE", entity: "Priority", entityId: params.id, before, after: input });
    return ok(res, { priority });
  })
);
/* ------------------------------------------------------------------ deletion of list masters */

/**
 * A priority is stored on a complaint as a reference and is required there, so deleting
 * one that is in use would leave those complaints unreadable.
 */
configurationRouter.delete(
  "/priorities/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: objectIdSchema }).parse(req.params);
    await connectDB();
    const priority = await Priority.findById(params.id).lean();
    if (!priority) throw httpError(404, "Priority not found");
    await assertDeletable("This priority", [
      { label: "complaints", count: Complaint.countDocuments({ priority: priority._id }) },
      { label: "CAPA actions", count: Capa.countDocuments({ priority: priority._id }) }
    ]);
    await Priority.deleteOne({ _id: priority._id });
    await writeAudit({ actor: req.user, action: "DELETE", entity: "Priority", entityId: params.id, before: priority });
    return ok(res, { deleted: true });
  })
);

/**
 * Complaints keep their category as text rather than a reference, so removing one leaves
 * existing records readable - it only retires the option. Sub-categories do point back by
 * reference, so a parent still holding children is refused.
 */
configurationRouter.delete(
  "/categories/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: objectIdSchema }).parse(req.params);
    await connectDB();
    const category = await Category.findById(params.id).lean();
    if (!category) throw httpError(404, "Category not found");
    await assertDeletable("This category", [{ label: "sub-categories", count: Category.countDocuments({ parent: category._id }) }]);
    await Category.deleteOne({ _id: category._id });
    await writeAudit({ actor: req.user, action: "DELETE", entity: "Category", entityId: params.id, before: category });
    return ok(res, { deleted: true });
  })
);

/** Delay reasons and root cause categories are recorded as text on the record they explain. */
configurationRouter.delete(
  "/lists/:list/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const key = req.params.list as ListKey;
    const model = listModels[key];
    if (!model) throw httpError(404, "Unknown configuration list");
    const params = z.object({ id: objectIdSchema }).parse(req.params);
    await connectDB();
    const before = await model.findById(params.id).lean();
    if (!before) throw httpError(404, "Item not found");
    await model.deleteOne({ _id: params.id });
    await writeAudit({ actor: req.user, action: "DELETE", entity: key, entityId: params.id, before });
    return ok(res, { deleted: true });
  })
);
