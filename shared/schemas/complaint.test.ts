import { describe, expect, it } from "vitest";
import { complaintCreateSchema, complaintListQuerySchema, eightDSchema } from "./complaint";

const id = "64b000000000000000000001";

describe("complaint related email addresses", () => {
  it("normalizes and de-duplicates addresses at creation", () => {
    const parsed = complaintCreateSchema.parse({
      type: "External",
      company: id,
      receivedAt: "2026-11-19T10:00:00.000Z",
      priority: id,
      customer: "Customer",
      responsibleDept: id,
      category: "Quality",
      description: "A sufficiently detailed complaint description",
      relatedEmails: [" Observer@ONEPWS.com ", "observer@onepws.com"]
    });
    expect(parsed.relatedEmails).toEqual(["observer@onepws.com"]);
  });

  it("rejects an invalid address on an investigation save", () => {
    expect(eightDSchema.safeParse({ relatedEmails: ["not-an-email"] }).success).toBe(false);
  });
});

describe("complaint owner filters", () => {
  it("accepts directory-only owners", () => {
    expect(complaintListQuerySchema.parse({ ownerEmployee: id }).ownerEmployee).toBe(id);
  });
});
