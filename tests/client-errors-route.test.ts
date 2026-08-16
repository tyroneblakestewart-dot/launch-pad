import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postClientError } from "@/app/api/client-errors/route";
import { CLIENT_ERROR_MESSAGE_MAX_LENGTH } from "@/lib/client-error-sanitizer";
import { CLIENT_ERRORS_LIMIT, resetClientErrorsRateLimitForTests } from "@/lib/server/api-protection";
import { resetClientErrorStoreForTests, setClientErrorStoreForTests } from "@/lib/server/client-errors-store";
import { MemoryClientErrorStore, UnavailableClientErrorStore } from "./client-errors-test-helpers";

const WALLET = "0x1111111111111111111111111111111111111111";

function postRequest(body: unknown, ip = "203.0.113.30", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.CLIENT_ERRORS_ALLOWED_ORIGIN = "http://localhost:3000";
  resetClientErrorsRateLimitForTests();
});

afterEach(() => {
  delete process.env.CLIENT_ERRORS_ALLOWED_ORIGIN;
  resetClientErrorStoreForTests();
});

describe("POST /api/client-errors", () => {
  it("records a well-formed error report", async () => {
    const store = new MemoryClientErrorStore();
    setClientErrorStoreForTests(store);

    const response = await postClientError(
      postRequest({
        message: "Cannot read properties of undefined (reading 'filter')",
        stack: "TypeError: ...\n  at Component (app.js:1:1)",
        routePath: "/social",
        walletAddress: WALLET,
        userAgent: "Mozilla/5.0",
        viewportWidth: 390,
        buildId: "abc1234",
      }),
    );
    expect(response.status).toBe(202);
    expect(store.occurrences).toHaveLength(1);
    expect(store.occurrences[0]).toMatchObject({
      message: "Cannot read properties of undefined (reading 'filter')",
      routePath: "/social",
      walletAddress: WALLET.toLowerCase(),
      viewportWidth: 390,
      buildId: "abc1234",
    });
  });

  it("never echoes the submitted message or stack back in the response body", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());

    const response = await postClientError(
      postRequest({ message: "some very specific crash message", routePath: "/social" }),
    );
    const text = await response.text();
    expect(text).not.toContain("some very specific crash message");
  });

  it("allows an anonymous report with no wallet connected", async () => {
    const store = new MemoryClientErrorStore();
    setClientErrorStoreForTests(store);

    const response = await postClientError(postRequest({ message: "boom", routePath: "/" }));
    expect(response.status).toBe(202);
    expect(store.occurrences[0].walletAddress).toBeNull();
  });

  it("re-sanitises and truncates the message server-side, independent of what the client sent", async () => {
    const store = new MemoryClientErrorStore();
    setClientErrorStoreForTests(store);

    const blob = "A".repeat(60);
    const longMessage = `${"x".repeat(CLIENT_ERROR_MESSAGE_MAX_LENGTH + 100)} ${blob}`;
    await postClientError(postRequest({ message: longMessage, routePath: "/social" }));

    const stored = store.occurrences[0].message;
    expect(stored.length).toBeLessThanOrEqual(CLIENT_ERROR_MESSAGE_MAX_LENGTH + 1);
    expect(stored).not.toContain(blob);
  });

  it("rejects a request with no message or a routePath that isn't a path", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());

    const noMessage = await postClientError(postRequest({ routePath: "/social" }));
    expect(noMessage.status).toBe(400);

    const badRoute = await postClientError(postRequest({ message: "boom", routePath: "not-a-path" }));
    expect(badRoute.status).toBe(400);
  });

  it("rejects a malformed wallet address", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());

    const response = await postClientError(
      postRequest({ message: "boom", routePath: "/social", walletAddress: "not-a-wallet" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request from an unauthorised origin", async () => {
    const store = new MemoryClientErrorStore();
    setClientErrorStoreForTests(store);

    const response = await postClientError(
      postRequest({ message: "boom", routePath: "/social" }, "203.0.113.30", "https://evil.example"),
    );
    expect(response.status).toBe(403);
    expect(store.occurrences).toHaveLength(0);
  });

  it("rate-limits repeated requests from the same IP", async () => {
    const store = new MemoryClientErrorStore();
    setClientErrorStoreForTests(store);

    for (let index = 0; index < CLIENT_ERRORS_LIMIT; index += 1) {
      const response = await postClientError(postRequest({ message: `boom ${index}`, routePath: "/social" }));
      expect(response.status).toBe(202);
    }

    const overLimit = await postClientError(postRequest({ message: "one too many", routePath: "/social" }));
    expect(overLimit.status).toBe(429);
  });

  it("fails closed with a 503 when no database is configured", async () => {
    setClientErrorStoreForTests(new UnavailableClientErrorStore());

    const response = await postClientError(postRequest({ message: "boom", routePath: "/social" }));
    expect(response.status).toBe(503);
  });
});
