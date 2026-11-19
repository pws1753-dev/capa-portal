import { Router } from "express";
import { z } from "zod";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "@shared/constants/permissions";
import {
  companyCreateSchema,
  departmentCreateSchema,
  employeeCreateSchema,
  userCreateSchema,
  userUpdateSchema
} from "@shared/schemas/master-data";
import { connectDB } from "../config/db";
import { requirePermission, requireUser } from "../middleware/auth";
import { Company } from "../models/Company";
import { Department } from "../models/Department";
import { Employee } from "../models/Employee";
import { Permission } from "../models/Permission";
import { Role } from "../models/Role";
import { User } from "../models/User";
import { hashPassword, sanitizeUser } from "../services/auth.service";
import { writeAudit } from "../services/audit.service";
import { sendTemplatedEmail } from "../services/email.service";
import { asyncHandler } from "../utils/async-handler";
import { httpError, ok } from "../utils/http";

export const masterRouter = Router();

masterRouter.use(requireUser);

masterRouter.get(
  "/bootstrap",
  requirePermission("view.company"),
  asyncHandler(async (req, res) => {
    await connectDB();
    const options = z.object({ include: z.enum(["reference", "employees", "full"]).default("reference") }).parse(req.query);
    const includeEmployees = options.include === "employees" || options.include === "full";
    const includeAdminData = options.include === "full";
    const [companies, departments, roles, permissions, employees] = await Promise.all([
      Company.find().select("name code complaintNumberingPrefix active").sort({ name: 1 }).lean(),
      Department.find().select("name code company managementEmails active").sort({ name: 1 }).lean(),
      includeAdminData ? Role.find().sort({ name: 1 }).lean() : Promise.resolve([]),
      includeAdminData ? Permission.find().sort({ key: 1 }).lean() : Promise.resolve([]),
      includeEmployees
        ? Employee.find()
            .select("name employeeCode designation email department company managerName managerEmail hodName hodEmail linkedUser active")
            .sort({ name: 1 })
            .limit(500)
            .lean()
        : Promise.resolve([])
    ]);
    return ok(res, { companies, departments, roles, permissions, employees });
  })
);

masterRouter.post(
  "/seed-permissions",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    await connectDB();
    await Permission.bulkWrite(
      PERMISSIONS.map((key) => ({
        updateOne: {
          filter: { key },
          update: { $setOnInsert: { key, label: key, group: key.split(".")[0], active: true } },
          upsert: true
        }
      }))
    );
    await Role.bulkWrite(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([name, permissions]) => ({
        updateOne: { filter: { name }, update: { $setOnInsert: { name, permissions, active: true } }, upsert: true }
      }))
    );
    await writeAudit({ actor: req.user, action: "UPSERT_DEFAULTS", entity: "Permission" });
    return ok(res, { seeded: true });
  })
);

masterRouter.get(
  "/users",
  requirePermission("view.all"),
  asyncHandler(async (_req, res) => {
    await connectDB();
    const users = await User.find().populate("role").sort({ createdAt: -1 }).lean();
    return ok(res, { users: users.map((user) => sanitizeUser(user)) });
  })
);

masterRouter.post(
  "/users",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = userCreateSchema.parse(req.body);
    await connectDB();
    const passwordHash = await hashPassword(input.password);
    const { password: _password, ...safeInput } = input;
    const user = await User.create({ ...safeInput, passwordHash, passwordChangedAt: new Date() });
    await writeAudit({ actor: req.user, action: "CREATE", entity: "User", entityId: String(user._id), after: { username: user.username } });
    const populated = await user.populate("role");

    if (user.email) {
      await sendTemplatedEmail({
        triggerEvent: "USER_CREATED",
        recipients: [user.email],
        data: {
          recipientName: user.name,
          username: user.username,
          roleName: populated.role && typeof populated.role === "object" && "name" in populated.role ? String(populated.role.name) : "Portal User"
        },
        sentBySystem: false
      });
    }

    return ok(res, { user: sanitizeUser(populated) }, 201);
  })
);

masterRouter.patch(
  "/users/:id",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = userUpdateSchema.parse(req.body);
    await connectDB();
    const before = await User.findById(req.params.id).lean();
    if (!before) throw httpError(404, "User not found");
    const user = await User.findByIdAndUpdate(req.params.id, input, { new: true }).populate("role");
    if (!user) throw httpError(404, "User not found");
    await writeAudit({
      actor: req.user,
      action: "UPDATE",
      entity: "User",
      entityId: req.params.id,
      before,
      after: { username: user.username, active: user.active, role: String(user.role) }
    });
    return ok(res, { user: sanitizeUser(user) });
  })
);

masterRouter.post(
  "/companies",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = companyCreateSchema.parse(req.body);
    await connectDB();
    const company = await Company.create(input);
    await writeAudit({ actor: req.user, action: "CREATE", entity: "Company", entityId: String(company._id), after: input });
    return ok(res, { company }, 201);
  })
);

masterRouter.post(
  "/departments",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = departmentCreateSchema.parse(req.body);
    await connectDB();
    const department = await Department.create(input);
    await writeAudit({ actor: req.user, action: "CREATE", entity: "Department", entityId: String(department._id), after: input });
    return ok(res, { department }, 201);
  })
);

masterRouter.post(
  "/employees",
  requirePermission("*"),
  asyncHandler(async (req, res) => {
    const input = employeeCreateSchema.parse(req.body);
    await connectDB();
    const employee = await Employee.create(input);
    await writeAudit({ actor: req.user, action: "CREATE", entity: "Employee", entityId: String(employee._id), after: input });
    return ok(res, { employee }, 201);
  })
);
