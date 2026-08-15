import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import type { AdminPipelineStage } from "@/lib/admin-operations";
import { getAdminOperationsStore } from "@/lib/server/admin-operations-store";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  HEALTH_CHECK_TIMEOUT_MS,
  withTimeout,
} from "@/lib/server/system-health";

export const TEST_ACCESS_LABEL_MAX_LENGTH = 120;

export type TestAccessWallet = {
  id: string;
  walletAddress: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  active: boolean;
};

export type TestAccessWalletRow = {
  id: string;
  wallet_address: string;
  label: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
};

type TestAccessActiveRow = {
  active: boolean | string | number | null;
};

export type TestAccessQuery = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[]; rowCount?: number | null }>;

export type TestAccessDeps = {
  databaseUrl?: string;
  query?: TestAccessQuery;
  now?: Date;
};

export interface TestAccessStore {
  isActive(walletAddress: string): Promise<boolean>;
  list(): Promise<TestAccessWallet[]>;
  add(input: {
    walletAddress: string;
    label: string;
    createdAt: Date;
  }): Promise<TestAccessWallet>;
  revoke(input: {
    id: string;
    revokedAt: Date;
  }): Promise<TestAccessWallet>;
}

export class TestAccessStoreUnavailableError extends Error {
  constructor(message = "Test access storage is unavailable. Apply migration 015_test_access_allowlist.sql.") {
    super(message);
    this.name = "TestAccessStoreUnavailableError";
  }
}

export class TestAccessWalletAlreadyExistsError extends Error {
  readonly wallet: TestAccessWallet;

  constructor(wallet: TestAccessWallet) {
    super(
      wallet.active
        ? "That wallet already has active test access."
        : "That wallet was previously revoked and is retained for the audit trail.",
    );
    this.name = "TestAccessWalletAlreadyExistsError";
    this.wallet = wallet;
  }
}

export class TestAccessWalletNotFoundError extends Error {
  constructor() {
    super("The test-access wallet could not be found.");
    this.name = "TestAccessWalletNotFoundError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The test-access timestamp is invalid.");
  }
  return date.toISOString();
}

function rowToWallet(row: TestAccessWalletRow): TestAccessWallet {
  const revokedAt = row.revoked_at ? asIso(row.revoked_at) : null;
  return {
    id: row.id,
    walletAddress: row.wallet_address.toLowerCase(),
    label: row.label,
    createdAt: asIso(row.created_at),
    revokedAt,
    active: revokedAt === null,
  };
}

function isTrue(value: TestAccessActiveRow["active"]): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export function normaliseTestAccessWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    return null;
  }
}

export function normaliseTestAccessLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/g, " ");
  if (
    !label ||
    label.length > TEST_ACCESS_LABEL_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(label)
  ) {
    return null;
  }
  return label;
}

function databaseQuery(deps: TestAccessDeps): TestAccessQuery | null {
  if (deps.query) return deps.query;
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) return null;
  return ((text: string, params?: unknown[]) =>
    getPostgresPool(databaseUrl).query(text, params)) as TestAccessQuery;
}

function requiredQuery(deps: TestAccessDeps): TestAccessQuery {
  const query = databaseQuery(deps);
  if (!query) throw new TestAccessStoreUnavailableError("DATABASE_URL is not configured for test access.");
  return query;
}

async function selectWalletByAddress(
  query: TestAccessQuery,
  walletAddress: string,
): Promise<TestAccessWallet | null> {
  const result = await query<TestAccessWalletRow>(
    `SELECT id::text, wallet_address, label, created_at, revoked_at
       FROM test_access_wallets
      WHERE wallet_address = $1
      LIMIT 1`,
    [walletAddress],
  );
  return result.rows[0] ? rowToWallet(result.rows[0]) : null;
}

let testStore: TestAccessStore | null = null;

export function setTestAccessStoreForTests(store: TestAccessStore): void {
  testStore = store;
}

export function resetTestAccessStoreForTests(): void {
  testStore = null;
}

function testStoreForCurrentProcess(): TestAccessStore | null {
  return process.env.NODE_ENV === "test" ? testStore : null;
}

export type TestAccessKillSwitchState = {
  /** Server-only env hard-off. Overrides the admin switch and the database entirely. */
  hardDisabled: boolean;
  /** The persisted admin_service_controls row: true unless an administrator paused it. */
  adminEnabled: boolean;
  /** Whether the admin switch state could actually be read. */
  available: boolean;
  reason: string;
  updatedAt: string | null;
  /** The effective decision: hard-off first, then the admin switch, fails closed on any error. */
  enabled: boolean;
};

/**
 * Defence-in-depth server-only hard-off. Set exactly to "true" to force
 * every test-access grant off regardless of the admin switch or allowlist
 * rows. Not togglable from /admin — changing it requires Vercel access.
 */
export function isTestAccessHardDisabled(): boolean {
  return (process.env.TEST_ACCESS_HARD_DISABLED || "").trim() === "true";
}

/**
 * Reads both kill-switch layers in evaluation order (env hard-off, then the
 * admin service-isolation switch). Any error reading the admin switch fails
 * closed: test access is treated as disabled, never enabled.
 */
export async function getTestAccessKillSwitchState(): Promise<TestAccessKillSwitchState> {
  const hardDisabled = isTestAccessHardDisabled();
  try {
    const control = await getAdminOperationsStore().getServiceControl("test-access");
    const adminEnabled = !control.isolated;
    return {
      hardDisabled,
      adminEnabled,
      available: true,
      reason: control.reason,
      updatedAt: control.updatedAt,
      enabled: !hardDisabled && adminEnabled,
    };
  } catch {
    return {
      hardDisabled,
      adminEnabled: false,
      available: false,
      reason: "",
      updatedAt: null,
      enabled: false,
    };
  }
}

/**
 * Server-only entitlement check. Invalid addresses, missing migration state,
 * a disabled kill switch, and database failures all fail closed and never
 * grant access.
 */
export async function isTestAccessWallet(
  address: unknown,
  deps: TestAccessDeps = {},
): Promise<boolean> {
  const walletAddress = normaliseTestAccessWalletAddress(address);
  if (!walletAddress) return false;

  const killSwitch = await getTestAccessKillSwitchState();
  if (!killSwitch.enabled) return false;

  const adapter = testStoreForCurrentProcess();
  if (adapter) {
    try {
      return await adapter.isActive(walletAddress);
    } catch {
      return false;
    }
  }

  const query = databaseQuery(deps);
  if (!query) return false;
  try {
    const result = await query<TestAccessActiveRow>(
      `SELECT EXISTS (
         SELECT 1
           FROM test_access_wallets
          WHERE wallet_address = $1
            AND revoked_at IS NULL
       ) AS active`,
      [walletAddress],
    );
    return isTrue(result.rows[0]?.active ?? false);
  } catch {
    return false;
  }
}

export async function listTestAccessWallets(
  deps: TestAccessDeps = {},
): Promise<TestAccessWallet[]> {
  const adapter = testStoreForCurrentProcess();
  if (adapter) return adapter.list();

  const query = requiredQuery(deps);
  try {
    const result = await query<TestAccessWalletRow>(
      `SELECT id::text, wallet_address, label, created_at, revoked_at
         FROM test_access_wallets
        ORDER BY (revoked_at IS NULL) DESC, created_at DESC, wallet_address`,
    );
    return result.rows.map(rowToWallet);
  } catch (error) {
    throw new TestAccessStoreUnavailableError(
      error instanceof Error && /test_access_wallets/i.test(error.message)
        ? "Migration 015_test_access_allowlist.sql has not been applied."
        : "Test access wallets could not be loaded.",
    );
  }
}

export async function addTestAccessWallet(
  input: { walletAddress: unknown; label: unknown },
  deps: TestAccessDeps = {},
): Promise<TestAccessWallet> {
  const walletAddress = normaliseTestAccessWalletAddress(input.walletAddress);
  if (!walletAddress) throw new TypeError("A valid EVM wallet address is required.");
  const label = normaliseTestAccessLabel(input.label);
  if (!label) {
    throw new TypeError(
      `A label between 1 and ${TEST_ACCESS_LABEL_MAX_LENGTH} characters is required.`,
    );
  }
  const createdAt = deps.now ?? new Date();

  const adapter = testStoreForCurrentProcess();
  if (adapter) return adapter.add({ walletAddress, label, createdAt });

  const query = requiredQuery(deps);
  try {
    const result = await query<TestAccessWalletRow>(
      `INSERT INTO test_access_wallets (wallet_address, label, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO NOTHING
       RETURNING id::text, wallet_address, label, created_at, revoked_at`,
      [walletAddress, label, createdAt],
    );
    if (result.rows[0]) return rowToWallet(result.rows[0]);

    const existing = await selectWalletByAddress(query, walletAddress);
    if (existing) throw new TestAccessWalletAlreadyExistsError(existing);
    throw new TestAccessStoreUnavailableError("The test-access wallet could not be recorded.");
  } catch (error) {
    if (error instanceof TestAccessWalletAlreadyExistsError) throw error;
    if (error instanceof TestAccessStoreUnavailableError) throw error;
    throw new TestAccessStoreUnavailableError(
      error instanceof Error && /test_access_wallets/i.test(error.message)
        ? "Migration 015_test_access_allowlist.sql has not been applied."
        : "The test-access wallet could not be recorded.",
    );
  }
}

export async function revokeTestAccessWallet(
  id: unknown,
  deps: TestAccessDeps = {},
): Promise<TestAccessWallet> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id.trim())) {
    throw new TypeError("A valid test-access record id is required.");
  }
  const recordId = id.trim().toLowerCase();
  const revokedAt = deps.now ?? new Date();

  const adapter = testStoreForCurrentProcess();
  if (adapter) return adapter.revoke({ id: recordId, revokedAt });

  const query = requiredQuery(deps);
  try {
    const result = await query<TestAccessWalletRow>(
      `UPDATE test_access_wallets
          SET revoked_at = COALESCE(revoked_at, $2)
        WHERE id = $1::uuid
        RETURNING id::text, wallet_address, label, created_at, revoked_at`,
      [recordId, revokedAt],
    );
    if (!result.rows[0]) throw new TestAccessWalletNotFoundError();
    return rowToWallet(result.rows[0]);
  } catch (error) {
    if (error instanceof TestAccessWalletNotFoundError) throw error;
    throw new TestAccessStoreUnavailableError(
      error instanceof Error && /test_access_wallets/i.test(error.message)
        ? "Migration 015_test_access_allowlist.sql has not been applied."
        : "The test-access wallet could not be revoked.",
    );
  }
}

export function createMemoryTestAccessStore(
  seed: TestAccessWallet[] = [],
): TestAccessStore {
  const records = new Map(
    seed.map((wallet) => [wallet.walletAddress.toLowerCase(), { ...wallet }]),
  );

  return {
    async isActive(walletAddress) {
      return records.get(walletAddress.toLowerCase())?.active === true;
    },
    async list() {
      return [...records.values()]
        .map((wallet) => ({ ...wallet }))
        .sort((left, right) => {
          if (left.active !== right.active) return left.active ? -1 : 1;
          return right.createdAt.localeCompare(left.createdAt);
        });
    },
    async add({ walletAddress, label, createdAt }) {
      const key = walletAddress.toLowerCase();
      const existing = records.get(key);
      if (existing) throw new TestAccessWalletAlreadyExistsError({ ...existing });
      const wallet: TestAccessWallet = {
        id: randomUUID(),
        walletAddress: key,
        label,
        createdAt: createdAt.toISOString(),
        revokedAt: null,
        active: true,
      };
      records.set(key, wallet);
      return { ...wallet };
    },
    async revoke({ id, revokedAt }) {
      const found = [...records.values()].find((wallet) => wallet.id === id);
      if (!found) throw new TestAccessWalletNotFoundError();
      if (found.active) {
        found.active = false;
        found.revokedAt = revokedAt.toISOString();
      }
      return { ...found };
    },
  };
}

/**
 * Reports the two kill-switch layers as one of three distinct states:
 * enabled, admin-disabled, or hard-disabled via environment. Any error
 * reading the admin switch is reported as its own failed-closed state
 * rather than silently claiming the switch is enabled.
 */
export async function buildTestAccessKillSwitchStage(): Promise<AdminPipelineStage> {
  const id = "test-access-kill-switch";
  const label = "Test-access kill switch";
  const state = await getTestAccessKillSwitchState();

  if (state.hardDisabled) {
    return {
      id,
      label,
      status: "amber",
      message:
        "Hard-disabled via TEST_ACCESS_HARD_DISABLED=true. This overrides the admin switch and every allowlist row. Change it in Vercel environment variables, not /admin.",
      observedAt: null,
    };
  }

  if (!state.available) {
    return {
      id,
      label,
      status: "red",
      message:
        "The admin switch state could not be read; test access fails closed and is treated as disabled.",
      observedAt: null,
    };
  }

  if (!state.adminEnabled) {
    return {
      id,
      label,
      status: "amber",
      message: `Disabled by an administrator: ${state.reason || "no reason given"}. Allowlist grants are paused; add/revoke still work.`,
      observedAt: state.updatedAt,
    };
  }

  return {
    id,
    label,
    status: "green",
    message: "Enabled. Allowlisted wallets receive test access on the next entitlement check.",
    observedAt: state.updatedAt,
  };
}

export async function buildTestAccessHealthStage(
  deps: TestAccessDeps = {},
): Promise<AdminPipelineStage> {
  const adapter = testStoreForCurrentProcess();
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!adapter && !deps.query && !databaseUrl) {
    return {
      id: "test-access-allowlist",
      label: "Wallet test-access allowlist",
      status: "amber",
      message: "DATABASE_URL is not configured.",
      observedAt: null,
    };
  }

  try {
    const wallets = await withTimeout(
      listTestAccessWallets(deps),
      HEALTH_CHECK_TIMEOUT_MS,
      "Test-access allowlist lookup timed out.",
    );
    const active = wallets.filter((wallet) => wallet.active).length;
    const revoked = wallets.length - active;
    return {
      id: "test-access-allowlist",
      label: "Wallet test-access allowlist",
      status: "green",
      message: `Migration 015 is ready. ${active} active test wallet(s), ${revoked} revoked audit row(s). No payment or revenue event is created by this feature.`,
      observedAt: null,
    };
  } catch {
    return {
      id: "test-access-allowlist",
      label: "Wallet test-access allowlist",
      status: "red",
      message:
        "The test-access allowlist could not be read. Apply migration 015_test_access_allowlist.sql deliberately, then retry.",
      observedAt: null,
    };
  }
}
