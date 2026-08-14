// A tiny Storage-compatible in-memory fake. Vitest's default "node"
// environment has no built-in localStorage, and stubbing a real
// Storage-shaped object (rather than relying on any particular Node
// version's experimental global) keeps quota-exceeded simulation explicit
// and deterministic.
export class FakeLocalStorage implements Storage {
  private data = new Map<string, string>();
  failNextSetItemWith: Error | null = null;

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failNextSetItemWith) {
      const error = this.failNextSetItemWith;
      this.failNextSetItemWith = null;
      throw error;
    }
    this.data.set(key, value);
  }
}

export function createFakeLocalStorage(): FakeLocalStorage {
  return new FakeLocalStorage();
}
