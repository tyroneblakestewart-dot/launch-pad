import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { POST as challenge } from "@/app/api/admin/challenge/route";
import { GET as health } from "@/app/api/admin/health/route";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
} from "@/lib/server/admin-auth";
import { resetAdminRateLimitsForTests } from "@/lib/server/api-protection";
import * as adminSessionStore from "@/lib/server/admin-session-store";
import {
  createMemoryAdminSessionState,
  createMemoryAdminSessionStore,
  isAdminSessionValid,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
  type MemoryAdminSessionState,
} from "@/lib/server/admin-session-store";

const ADMIN_ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);
const ADMIN_PASSWORD = "correct horse battery staple";

let sharedAdminState: MemoryAdminSessionState;

function installFreshServerlessInstance(): void {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore(sharedAdminState));
}

function postRequest(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function getRequest(
  path: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Request(`http://localhost:3000${path}`, {
    method: "GET",
    headers: { ...extraHeaders },
  });
}

function sessionTokenFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  if (!match) {
    throw new Error(`No ${ADMIN_SESSION_COOKIE} cookie in response`);
  }
  return match[1];
}

function sessionCookieFrom(response: Response): string {
  return `${ADMIN_SESSION_COOKIE}=${sessionTokenFrom(response)}`;
}

async function loginWithWallet(signer = ADMIN_ACCOUNT) {
  const challengeResponse = await challenge(
    postRequest("/api/admin/challenge", { walletAddress: signer.address }),
  );
  if (challengeResponse.status !== 201) return challengeResponse;

  const body = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
    message: string;
  };
  const signature = await signer.signMessage({ message: body.message });

  // Challenge and login may execute in different Vercel functions.
  installFreshServerlessInstance();
  return login(
    postRequest("/api/admin/login", {
      method: "wallet",
      challengeId: body.challengeId,
      nonce: body.nonce,
      signature,
    }),
  );
}

async function loginWithPassword(password: string) {
  installFreshServerlessInstance();
  return login(postRequest("/api/admin/login", { method: "password", password }));
}

async function expectWorkingSessionAndHealth(loginResponse: Response): Promise<void> {
  expect(loginResponse.status).toBe(200);
  await expect(loginResponse.json()).resolves.toEqual({ authenticated: true });

  const sessionToken = sessionTokenFrom(loginResponse);
  const cookie = `${ADMIN_SESSION_COOKIE}=${sessionToken}`;

  // Page/session validation and health may each run in another cold instance.
  installFreshServerlessInstance();
  await expect(isAdminSessionValid(hashAdminSessionToken(sessionToken))).resolves.toBe(true);

  installFreshServerlessInstance();
  const healthResponse = await health(getRequest("/api/admin/health", { Cookie: cookie }));
  expect(healthResponse.status).toBe(200);
  const payload = (await healthResponse.json()) as {
    checks: Array<{ id: string }>;
  };
  expect(payload.checks.map((check) => check.id).sort()).toEqual(
    ["contracts", "database", "deployment", "hoodchat", "outreach", "subscribers", "token-chat", "website-generation"].sort(),
  );
}

beforeEach(() => {
  process.env.ADMIN_WALLET_ADDRESS = ADMIN_ACCOUNT.address;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.PUBLISH_ALLOWED_ORIGIN = "http://localhost:3000";
  sharedAdminState = createMemoryAdminSessionState();
  installFreshServerlessInstance();
  resetAdminRateLimitsForTests();
});

afterEach(() => {
  delete process.env.ADMIN_WALLET_ADDRESS;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.PUBLISH_ALLOWED_ORIGIN;
  resetAdminRateLimitsForTests();
  resetAdminStoresForTests();
});

describe("admin wallet login", () => {
  it("persists the wallet login and loads System Health across serverless instances", async () => {
    await expectWorkingSessionAndHealth(await loginWithWallet());
  });

  it("rejects a wallet that is not the configured admin wallet before signing", async () => {
    const challengeResponse = await challenge(
      postRequest("/api/admin/challenge", { walletAddress: OTHER_ACCOUNT.address }),
    );
    expect(challengeResponse.status).toBe(403);
    await expect(challengeResponse.json()).resolves.toEqual({
      error: "This wallet is not authorised for admin access.",
    });
  });

  it("rejects a login signed by a different wallet", async () => {
    const challengeResponse = await challenge(
      postRequest("/api/admin/challenge", { walletAddress: ADMIN_ACCOUNT.address }),
    );
    expect(challengeResponse.status).toBe(201);
    const body = (await challengeResponse.json()) as {
      challengeId: string;
      nonce: string;
      message: string;
    };
    const signature = await OTHER_ACCOUNT.signMessage({ message: body.message });

    installFreshServerlessInstance();
    const loginResponse = await login(
      postRequest("/api/admin/login", {
        method: "wallet",
        challengeId: body.challengeId,
        nonce: body.nonce,
        signature,
      }),
    );
    expect(loginResponse.status).toBe(401);
  });

  it("returns 503 when no admin wallet is configured", async () => {
    delete process.env.ADMIN_WALLET_ADDRESS;
    const response = await challenge(
      postRequest("/api/admin/challenge", { walletAddress: ADMIN_ACCOUNT.address }),
    );
    expect(response.status).toBe(503);
  });
});

describe("admin password login", () => {
  it("persists the password login and loads System Health across serverless instances", async () => {
    await expectWorkingSessionAndHealth(await loginWithPassword(ADMIN_PASSWORD));
  });

  it("rejects an incorrect password", async () => {
    const response = await loginWithPassword("wrong password");
    expect(response.status).toBe(401);
  });

  it("returns 503 when no admin password is configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    const response = await loginWithPassword("anything");
    expect(response.status).toBe(503);
  });
});

describe("admin session gating", () => {
  it("blocks System Health without a session cookie", async () => {
    const response = await health(getRequest("/api/admin/health"));
    expect(response.status).toBe(401);
  });

  it("blocks System Health with a garbage cookie", async () => {
    const response = await health(
      getRequest("/api/admin/health", {
        Cookie: `${ADMIN_SESSION_COOKIE}=garbage`,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("logs out and invalidates the durable session", async () => {
    const loginResponse = await loginWithWallet();
    const cookie = sessionCookieFrom(loginResponse);

    installFreshServerlessInstance();
    const logoutResponse = await logout(
      postRequest("/api/admin/logout", {}, { Cookie: cookie }),
    );
    expect(logoutResponse.status).toBe(200);

    installFreshServerlessInstance();
    const healthResponse = await health(getRequest("/api/admin/health", { Cookie: cookie }));
    expect(healthResponse.status).toBe(401);
  });
});

describe("admin login rate limiting", () => {
  it("blocks further password guesses after the attempt limit for one IP", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await loginWithPassword("wrong password");
      expect(response.status).toBe(401);
    }

    const blocked = await loginWithPassword(ADMIN_PASSWORD);
    expect(blocked.status).toBe(429);
  });
});

describe("admin login always returns a response, never crashes", () => {
  it("returns a well-formed response for a valid wallet login", async () => {
    const response = await loginWithWallet();
    expect(response).toBeInstanceOf(Response);
    expect(typeof response.status).toBe("number");
    expect(response.status).toBe(200);
  });

  it("returns a well-formed response for an invalid wallet login", async () => {
    const response = await loginWithWallet(OTHER_ACCOUNT);
    expect(response).toBeInstanceOf(Response);
    expect(typeof response.status).toBe("number");
    expect(response.status).toBe(403);
  });

  it("returns a well-formed response for a valid password login", async () => {
    const response = await loginWithPassword(ADMIN_PASSWORD);
    expect(response).toBeInstanceOf(Response);
    expect(typeof response.status).toBe("number");
    expect(response.status).toBe(200);
  });

  it("returns a well-formed response for an invalid password login", async () => {
    const response = await loginWithPassword("wrong password");
    expect(response).toBeInstanceOf(Response);
    expect(typeof response.status).toBe("number");
    expect(response.status).toBe(401);
  });

  it("returns 500 instead of throwing when wallet-session persistence fails", async () => {
    const persistenceSpy = vi
      .spyOn(adminSessionStore, "consumeAdminChallengeAndCreateSession")
      .mockRejectedValue(new Error("simulated session store failure"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await loginWithWallet();
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Admin login failed unexpectedly. Try again.",
      });
    } finally {
      persistenceSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 500 instead of throwing when password-session persistence fails", async () => {
    const persistenceSpy = vi
      .spyOn(adminSessionStore, "createAdminSession")
      .mockRejectedValue(new Error("simulated session store failure"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await loginWithPassword(ADMIN_PASSWORD);
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Admin login failed unexpectedly. Try again.",
      });
    } finally {
      persistenceSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("never logs the submitted password when persistence fails", async () => {
    const persistenceSpy = vi
      .spyOn(adminSessionStore, "createAdminSession")
      .mockRejectedValue(new Error("simulated session store failure"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await loginWithPassword(ADMIN_PASSWORD);
      const loggedOutput = consoleErrorSpy.mock.calls.flat().join(" ");
      expect(loggedOutput).not.toContain(ADMIN_PASSWORD);
    } finally {
      persistenceSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
