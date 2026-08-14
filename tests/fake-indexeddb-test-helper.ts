// Minimal hand-rolled IndexedDB fake covering exactly the surface
// lib/token-project-db.ts uses (open/upgrade, one object store, put/get/
// delete, transaction completion and error/abort). Real IndexedDB fires
// every callback asynchronously and auto-commits a transaction once its
// requests settle with nothing else queued — this fake mirrors that timing
// with queueMicrotask so callers can `await` the wrapped promises exactly
// like they would against a real browser implementation.

type Listener = (() => void) | null;

class FakeIDBRequestBase {
  onsuccess: Listener = null;
  onerror: Listener = null;
  result: unknown;
  error: Error | null = null;
}

class FakeOpenRequest extends FakeIDBRequestBase {
  onupgradeneeded: Listener = null;
  onblocked: Listener = null;
}

class FakeTransaction {
  oncomplete: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  error: Error | null = null;
  private settled = false;

  constructor(private readonly store: FakeObjectStore) {}

  objectStore(): FakeBoundStore {
    return new FakeBoundStore(this.store, this);
  }

  fail(error: Error) {
    if (this.settled) return;
    this.settled = true;
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }

  complete() {
    if (this.settled) return;
    this.settled = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeBoundStore {
  constructor(
    private readonly store: FakeObjectStore,
    private readonly tx: FakeTransaction,
  ) {}

  put(value: unknown, key: string) {
    return this.store.run(this.tx, () => {
      this.store.data.set(key, value);
      return key;
    });
  }

  get(key: string) {
    return this.store.run(this.tx, () => this.store.data.get(key));
  }

  delete(key: string) {
    return this.store.run(this.tx, () => {
      this.store.data.delete(key);
      return undefined;
    });
  }
}

class FakeObjectStore {
  data = new Map<string, unknown>();
  failNextWith: Error | null = null;

  run(tx: FakeTransaction, action: () => unknown): FakeIDBRequestBase {
    const request = new FakeIDBRequestBase();
    queueMicrotask(() => {
      if (this.failNextWith) {
        const error = this.failNextWith;
        this.failNextWith = null;
        request.error = error;
        request.onerror?.();
        tx.fail(error);
        return;
      }
      request.result = action();
      request.onsuccess?.();
      tx.complete();
    });
    return request;
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, FakeObjectStore>();
  objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string) {
    const store = new FakeObjectStore();
    this.stores.set(name, store);
    return store;
  }

  transaction(name: string) {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Fake IndexedDB: object store "${name}" does not exist.`);
    return new FakeTransaction(store);
  }

  close() {}

  getOrCreateStore(name: string) {
    const existing = this.stores.get(name);
    if (existing) return existing;
    return this.createObjectStore(name);
  }
}

export class FakeIndexedDBFactory {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string) {
    const request = new FakeOpenRequest();
    const isNew = !this.databases.has(name);
    if (isNew) this.databases.set(name, new FakeDatabase());
    const database = this.databases.get(name)!;

    queueMicrotask(() => {
      request.result = database;
      if (isNew) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  /** Makes the next put/get/delete against the named store reject with `error`. */
  failNextOperation(dbName: string, storeName: string, error: Error) {
    if (!this.databases.has(dbName)) this.databases.set(dbName, new FakeDatabase());
    const store = this.databases.get(dbName)!.getOrCreateStore(storeName);
    store.failNextWith = error;
  }
}

export function createFakeIndexedDB(): FakeIndexedDBFactory {
  return new FakeIndexedDBFactory();
}
