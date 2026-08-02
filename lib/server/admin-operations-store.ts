import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ADMIN_SERVICE_DEFINITIONS,
  adminServiceDefinition,
  type AdminActivityItem,
  type AdminActivityKind,
  type AdminServiceControl,
  type AdminServiceKey,
} from "@/lib/admin-operations";
import { getPostgresPool } from "@/lib/server/postgres";

export type RecordAdminActivityInput = {
  kind: AdminActivityKind;
  serviceKey?: AdminServiceKey | null;
  message: string;
  createdAt?: Date;
};

export interface AdminOperationsStore {
  listServiceControls(): Promise<AdminServiceControl[]>;
  getServiceControl(key: AdminServiceKey): Promise<AdminServiceControl>;
  setServiceIsolation(input: {
    key: AdminServiceKey;
    isolated: boolean;
    reason: string;
    now?: Date;
  }): Promise<AdminServiceControl>;
  listActivity(limit: number): Promise<AdminActivityItem[]>;
  recordActivity(input: RecordAdminActivityInput): Promise<void>;
}

export class AdminOperationsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is required for durable admin operations.");
    this.name = "AdminOperationsStoreUnavailableError";
  }
}

type ServiceControlRow = {
  service_key: string;
  isolated: boolean;
  reason: string;
  updated_at: Date | string;
};

type ActivityRow = {
  id: string;
  event_kind: string;
  service_key: string | null;
  message: string;
  created_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function controlFromValues(
  key: AdminServiceKey,
  isolated: boolean,
  reason: string,
  updatedAt: Date,
): AdminServiceControl {
  const definition = adminServiceDefinition(key);
  return {
    key,
    label: definition.label,
    description: definition.description,
    affectedRoutes: definition.affectedRoutes,
    isolated,
    reason,
    updatedAt: updatedAt.toISOString(),
  };
}

function controlFromRow(row: ServiceControlRow): AdminServiceControl {
  return controlFromValues(
    row.service_key as AdminServiceKey,
    Boolean(row.isolated),
    row.reason || "",
    asDate(row.updated_at),
  );
}

function activityFromRow(row: ActivityRow): AdminActivityItem {
  return {
    id: row.id,
    kind: row.event_kind as AdminActivityKind,
    serviceKey: (row.service_key as AdminServiceKey | null) || null,
    message: row.message,
    createdAt: asDate(row.created_at).toISOString(),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

export type MemoryAdminOperationsState = {
  controls: Map<
    AdminServiceKey,
    { isolated: boolean; reason: string; updatedAt: Date }
  >;
  activity: AdminActivityItem[];
};

export function createMemoryAdminOperationsState(
  now = new Date("2026-01-01T00:00:00.000Z"),
): MemoryAdminOperationsState {
  return {
    controls: new Map(
      ADMIN_SERVICE_DEFINITIONS.map((definition) => [
        definition.key,
        { isolated: false, reason: "", updatedAt: now },
      ]),
    ),
    activity: [],
  };
}

/** Test-only store. Shared state models separate serverless functions using one database. */
export function createMemoryAdminOperationsStore(
  state: MemoryAdminOperationsState = createMemoryAdminOperationsState(),
): AdminOperationsStore {
  return {
    async listServiceControls() {
      return ADMIN_SERVICE_DEFINITIONS.map((definition) => {
        const record = state.controls.get(definition.key) || {
          isolated: false,
          reason: "",
          updatedAt: new Date(0),
        };
        return controlFromValues(
          definition.key,
          record.isolated,
          record.reason,
          record.updatedAt,
        );
      });
    },

    async getServiceControl(key) {
      const record = state.controls.get(key) || {
        isolated: false,
        reason: "",
        updatedAt: new Date(0),
      };
      return controlFromValues(key, record.isolated, record.reason, record.updatedAt);
    },

    async setServiceIsolation(input) {
      const now = input.now || new Date();
      state.controls.set(input.key, {
        isolated: input.isolated,
        reason: input.reason,
        updatedAt: now,
      });
      const definition = adminServiceDefinition(input.key);
      state.activity.unshift({
        id: randomUUID(),
        kind: input.isolated ? "service-isolated" : "service-restored",
        serviceKey: input.key,
        message: input.isolated
          ? `${definition.label} isolated: ${input.reason}`
          : `${definition.label} restored: ${input.reason}`,
        createdAt: now.toISOString(),
      });
      return controlFromValues(
        input.key,
        input.isolated,
        input.reason,
        now,
      );
    },

    async listActivity(limit) {
      return state.activity.slice(0, Math.max(1, Math.min(limit, 100)));
    },

    async recordActivity(input) {
      state.activity.unshift({
        id: randomUUID(),
        kind: input.kind,
        serviceKey: input.serviceKey || null,
        message: input.message,
        createdAt: (input.createdAt || new Date()).toISOString(),
      });
    },
  };
}

export function createPostgresAdminOperationsStore(
  databaseUrl: string,
): AdminOperationsStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async listServiceControls() {
      const result = await pool.query<ServiceControlRow>(
        `SELECT service_key, isolated, reason, updated_at
           FROM admin_service_controls`,
      );
      const rows = new Map(
        result.rows.map((row) => [row.service_key, row] as const),
      );
      return ADMIN_SERVICE_DEFINITIONS.map((definition) => {
        const row = rows.get(definition.key);
        return row
          ? controlFromRow(row)
          : controlFromValues(definition.key, false, "", new Date(0));
      });
    },

    async getServiceControl(key) {
      const result = await pool.query<ServiceControlRow>(
        `SELECT service_key, isolated, reason, updated_at
           FROM admin_service_controls
          WHERE service_key = $1
          LIMIT 1`,
        [key],
      );
      return result.rows[0]
        ? controlFromRow(result.rows[0])
        : controlFromValues(key, false, "", new Date(0));
    },

    async setServiceIsolation(input) {
      const client = await pool.connect();
      const now = input.now || new Date();
      try {
        await client.query("BEGIN");
        const updated = await client.query<ServiceControlRow>(
          `INSERT INTO admin_service_controls (
             service_key, isolated, reason, updated_at
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (service_key) DO UPDATE
             SET isolated = EXCLUDED.isolated,
                 reason = EXCLUDED.reason,
                 updated_at = EXCLUDED.updated_at
           RETURNING service_key, isolated, reason, updated_at`,
          [input.key, input.isolated, input.reason, now],
        );
        const definition = adminServiceDefinition(input.key);
        const message = input.isolated
          ? `${definition.label} isolated: ${input.reason}`
          : `${definition.label} restored: ${input.reason}`;
        await client.query(
          `INSERT INTO admin_activity_log (
             event_kind, service_key, message, created_at
           ) VALUES ($1, $2, $3, $4)`,
          [
            input.isolated ? "service-isolated" : "service-restored",
            input.key,
            message,
            now,
          ],
        );
        await client.query("COMMIT");
        return controlFromRow(updated.rows[0]);
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async listActivity(limit) {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const result = await pool.query<ActivityRow>(
        `SELECT id, event_kind, service_key, message, created_at
           FROM admin_activity_log
          ORDER BY created_at DESC
          LIMIT $1`,
        [safeLimit],
      );
      return result.rows.map(activityFromRow);
    },

    async recordActivity(input) {
      await pool.query(
        `INSERT INTO admin_activity_log (
           event_kind, service_key, message, created_at
         ) VALUES ($1, $2, $3, $4)`,
        [
          input.kind,
          input.serviceKey || null,
          input.message,
          input.createdAt || new Date(),
        ],
      );
    },
  };
}

const unconfiguredStore: AdminOperationsStore = {
  async listServiceControls() {
    throw new AdminOperationsStoreUnavailableError();
  },
  async getServiceControl() {
    throw new AdminOperationsStoreUnavailableError();
  },
  async setServiceIsolation() {
    throw new AdminOperationsStoreUnavailableError();
  },
  async listActivity() {
    throw new AdminOperationsStoreUnavailableError();
  },
  async recordActivity() {
    throw new AdminOperationsStoreUnavailableError();
  },
};

let testStore: AdminOperationsStore | null = null;
let productionStore: AdminOperationsStore | null = null;
let productionDatabaseUrl = "";

export function setAdminOperationsStoreForTests(
  store: AdminOperationsStore,
): void {
  testStore = store;
}

export function resetAdminOperationsStoreForTests(): void {
  testStore = null;
}

export function getAdminOperationsStore(): AdminOperationsStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresAdminOperationsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

/** Login/logout activity must never break authentication if the log table is unavailable. */
export async function recordAdminActivityBestEffort(
  input: RecordAdminActivityInput,
): Promise<void> {
  try {
    await getAdminOperationsStore().recordActivity(input);
  } catch (error) {
    console.error(
      "Admin activity could not be recorded.",
      error instanceof Error ? error.message : error,
    );
  }
}
