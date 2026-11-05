import { beforeEach, describe, expect, it, vi } from "vitest";

let active: Record<string, unknown> | null = null;
let hasSwitchedOff = false;

vi.mock("../config/db", () => ({ connectDB: async () => undefined }));
vi.mock("../models/EmailTemplate", () => ({
  EmailTemplate: {
    findOne: () => ({ lean: async () => active }),
    exists: async () => (hasSwitchedOff ? { _id: "x" } : null),
    updateOne: async () => undefined
  }
}));

const { getActiveTemplateByTrigger } = await import("./email-template.service");

beforeEach(() => {
  active = null;
  hasSwitchedOff = false;
});

describe("switched-off email templates", () => {
  it("sends nothing for an event whose template was made inactive", async () => {
    hasSwitchedOff = true;
    expect(await getActiveTemplateByTrigger("CAPA_DUE_REMINDER")).toBeNull();
  });

  it("falls back to the built-in default only when no template exists for the event at all", async () => {
    expect(await getActiveTemplateByTrigger("CAPA_DUE_REMINDER")).not.toBeNull();
  });
});
