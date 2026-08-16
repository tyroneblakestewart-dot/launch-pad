import { describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_MESSAGE_MAX_LENGTH,
  CLIENT_ERROR_STACK_MAX_LENGTH,
  sanitiseClientErrorMessage,
  sanitiseClientErrorStack,
} from "@/lib/client-error-sanitizer";

describe("sanitiseClientErrorMessage", () => {
  it("leaves an ordinary error message unchanged", () => {
    expect(sanitiseClientErrorMessage("Cannot read properties of undefined (reading 'filter')")).toBe(
      "Cannot read properties of undefined (reading 'filter')",
    );
  });

  it("strips a data URL", () => {
    const message = "Failed loading data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = sanitiseClientErrorMessage(message);
    expect(result).not.toContain("iVBORw0KGgo");
    expect(result).toContain("[data-url-removed]");
  });

  it("strips a long base64 blob that is not wrapped in a data URL", () => {
    const blob = "A".repeat(60);
    const result = sanitiseClientErrorMessage(`Payload was ${blob}`);
    expect(result).not.toContain(blob);
    expect(result).toContain("[base64-removed]");
  });

  it("strips a JWT-style token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = sanitiseClientErrorMessage(`Auth failed: ${jwt}`);
    expect(result).not.toContain(jwt);
    expect(result).toContain("[token-removed]");
  });

  it("strips a Bearer token", () => {
    const result = sanitiseClientErrorMessage("Request failed: Bearer abcdef1234567890secret");
    expect(result).not.toContain("abcdef1234567890secret");
    expect(result).toContain("Bearer [token-removed]");
  });

  it("truncates a message exceeding the max length", () => {
    const longMessage = "word ".repeat(Math.ceil((CLIENT_ERROR_MESSAGE_MAX_LENGTH + 50) / 5));
    const result = sanitiseClientErrorMessage(longMessage);
    expect(result.length).toBeLessThanOrEqual(CLIENT_ERROR_MESSAGE_MAX_LENGTH + 1);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("sanitiseClientErrorStack", () => {
  it("strips secrets from a stack trace and truncates to the stack length cap", () => {
    const blob = "B".repeat(80);
    const stack = `Error: boom\n    at fn (${blob})\n`.repeat(50);
    const result = sanitiseClientErrorStack(stack);
    expect(result).not.toContain(blob);
    expect(result.length).toBeLessThanOrEqual(CLIENT_ERROR_STACK_MAX_LENGTH + 1);
  });
});
