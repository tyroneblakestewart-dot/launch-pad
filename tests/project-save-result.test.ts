import { describe, expect, it } from "vitest";
import { shouldCloseWorkspaceAfterSave } from "@/lib/project-save-result";

describe("Save & close result handling", () => {
  it("keeps the workspace open after a rejected save", () => {
    expect(shouldCloseWorkspaceAfterSave({ success: false })).toBe(false);
    expect(shouldCloseWorkspaceAfterSave(undefined)).toBe(false);
  });

  it("closes only after a confirmed successful save", () => {
    expect(shouldCloseWorkspaceAfterSave({ success: true })).toBe(true);
  });
});
