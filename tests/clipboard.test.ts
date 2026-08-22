import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyToClipboard (issue #405)", () => {
  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const result = await copyToClipboard("hello world");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("falls back to the textarea/execCommand path when navigator.clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const select = vi.fn();
    const fakeTextarea = { value: "", setAttribute: vi.fn(), style: {}, select };
    const createElement = vi.fn().mockReturnValue(fakeTextarea);
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("document", { createElement, body: { appendChild, removeChild }, execCommand });

    const result = await copyToClipboard("fallback text");
    expect(result).toBe(true);
    expect(fakeTextarea.value).toBe("fallback text");
    expect(select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appendChild).toHaveBeenCalledWith(fakeTextarea);
    expect(removeChild).toHaveBeenCalledWith(fakeTextarea);
  });

  it("falls back when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue({ value: "", setAttribute: vi.fn(), style: {}, select: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });

    const result = await copyToClipboard("retry text");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalled();
  });

  it("returns false rather than throwing when both the clipboard API and the fallback are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);
    await expect(copyToClipboard("no dom")).resolves.toBe(false);
  });

  it("still removes the hidden textarea from the DOM when execCommand throws (issue #405 review)", async () => {
    vi.stubGlobal("navigator", {});
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const fakeTextarea = { value: "", setAttribute: vi.fn(), style: {}, select: vi.fn() };
    const createElement = vi.fn().mockReturnValue(fakeTextarea);
    const execCommand = vi.fn().mockImplementation(() => {
      throw new Error("execCommand is not supported");
    });
    vi.stubGlobal("document", { createElement, body: { appendChild, removeChild }, execCommand });

    const result = await copyToClipboard("cleanup me");
    expect(result).toBe(false);
    expect(appendChild).toHaveBeenCalledWith(fakeTextarea);
    expect(removeChild).toHaveBeenCalledWith(fakeTextarea);
  });

  it("still removes the hidden textarea from the DOM when select() throws", async () => {
    vi.stubGlobal("navigator", {});
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const select = vi.fn().mockImplementation(() => {
      throw new Error("select is not supported");
    });
    const fakeTextarea = { value: "", setAttribute: vi.fn(), style: {}, select };
    const createElement = vi.fn().mockReturnValue(fakeTextarea);
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("document", { createElement, body: { appendChild, removeChild }, execCommand });

    const result = await copyToClipboard("cleanup me too");
    expect(result).toBe(false);
    expect(appendChild).toHaveBeenCalledWith(fakeTextarea);
    expect(removeChild).toHaveBeenCalledWith(fakeTextarea);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("returns false when execCommand reports failure", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue({ value: "", setAttribute: vi.fn(), style: {}, select: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn().mockReturnValue(false),
    });
    const result = await copyToClipboard("nope");
    expect(result).toBe(false);
  });
});
