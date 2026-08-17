import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/server/postgres";

export type FixedOperatingCostCadence = "monthly" | "annual";

export type FixedOperatingCostRecord = {
  id: string;
  name: string;
  amountUsd: number;
  cadence: FixedOperatingCostCadence;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateFixedOperatingCostInput = {
  name: string;
  amountUsd: number;
  cadence: FixedOperatingCostCadence;
  note: string | null;
};

export type UpdateFixedOperatingCostInput = CreateFixedOperatingCostInput & { id: string };

export interface FixedOperatingCostsStore {
  list(): Promise<FixedOperatingCostRecord[]>;
  create(input: CreateFixedOperatingCostInput, now?: Date): Promise<FixedOperatingCostRecord>;
  update(input: UpdateFixedOperatingCostInput, now?: Date): Promise<FixedOperatingCostRecord | null>;
  remove(id: string): Promise<boolean>;
}

export class FixedOperatingCostsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is required for fixed operating costs.");
    this.name = "FixedOperatingCostsStoreUnavailableError";
  }
}

type FixedOperatingCostRow = {
  id: string;
  name: string;
  amount_usd: string | number;
  cadence: FixedOperatingCostCadence;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function fromRow(row: FixedOperatingCostRow): FixedOperatingCostRecord {
  return {
    id: row.id,
    name: row.name,
    amountUsd: Number(row.amount_usd),
    cadence: row.cadence,
    note: row.note,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

const unconfiguredStore: FixedOperatingCostsStore = {
  async list() {
    throw new FixedOperatingCostsStoreUnavailableError();
  },
  async create() {
    throw new FixedOperatingCostsStoreUnavailableError();
  },
  async update() {
    throw new FixedOperatingCostsStoreUnavailableError();
  },
  async remove() {
    throw new FixedOperatingCostsStoreUnavailableError();
  },
};

export function createMemoryFixedOperatingCostsStore(
  seed: FixedOperatingCostRecord[] = [],
): FixedOperatingCostsStore {
  const rows = [...seed];
  return {
    async list() {
      return [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    async create(input, now = new Date()) {
      const record: FixedOperatingCostRecord = {
        id: randomUUID(),
        name: input.name,
        amountUsd: input.amountUsd,
        cadence: input.cadence,
        note: input.note,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      rows.push(record);
      return record;
    },
    async update(input, now = new Date()) {
      const index = rows.findIndex((row) => row.id === input.id);
      if (index === -1) return null;
      const updated: FixedOperatingCostRecord = {
        ...rows[index],
        name: input.name,
        amountUsd: input.amountUsd,
        cadence: input.cadence,
        note: input.note,
        updatedAt: now.toISOString(),
      };
      rows[index] = updated;
      return updated;
    },
    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

export function createPostgresFixedOperatingCostsStore(databaseUrl: string): FixedOperatingCostsStore {
  const pool = getPostgresPool(databaseUrl);
  return {
    async list() {
      const result = await pool.query<FixedOperatingCostRow>(
        `SELECT id, name, amount_usd, cadence, note, created_at, updated_at
           FROM fixed_operating_costs
          ORDER BY created_at DESC`,
      );
      return result.rows.map(fromRow);
    },
    async create(input, now = new Date()) {
      const result = await pool.query<FixedOperatingCostRow>(
        `INSERT INTO fixed_operating_costs (id, name, amount_usd, cadence, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, name, amount_usd, cadence, note, created_at, updated_at`,
        [randomUUID(), input.name, input.amountUsd, input.cadence, input.note, now],
      );
      return fromRow(result.rows[0]);
    },
    async update(input, now = new Date()) {
      const result = await pool.query<FixedOperatingCostRow>(
        `UPDATE fixed_operating_costs
            SET name = $2, amount_usd = $3, cadence = $4, note = $5, updated_at = $6
          WHERE id = $1
          RETURNING id, name, amount_usd, cadence, note, created_at, updated_at`,
        [input.id, input.name, input.amountUsd, input.cadence, input.note, now],
      );
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
    async remove(id) {
      const result = await pool.query(`DELETE FROM fixed_operating_costs WHERE id = $1`, [id]);
      return (result.rowCount ?? 0) > 0;
    },
  };
}

let testStore: FixedOperatingCostsStore | null = null;
let productionStore: FixedOperatingCostsStore | null = null;
let productionDatabaseUrl = "";

export function setFixedOperatingCostsStoreForTests(store: FixedOperatingCostsStore): void {
  testStore = store;
}

export function resetFixedOperatingCostsStoreForTests(): void {
  testStore = null;
}

export function getFixedOperatingCostsStore(): FixedOperatingCostsStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresFixedOperatingCostsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}
