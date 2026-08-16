import { describe, expect, it } from "vitest";
import { claimClientErrorSendSlot, MAX_CLIENT_ERROR_REPORTS_PER_SESSION } from "@/lib/client-error-throttle";

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("claimClientErrorSendSlot", () => {
  it("claims a slot the first time a key is seen", () => {
    const storage = new MemoryStorage();
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(true);
  });

  it("never claims the same message+route key twice in one session", () => {
    const storage = new MemoryStorage();
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(true);
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(false);
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(false);
  });

  it("treats different routes for the same message as distinct keys", () => {
    const storage = new MemoryStorage();
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(true);
    expect(claimClientErrorSendSlot("/hoodchat::boom", storage)).toBe(true);
  });

  it("caps total claims per session even for distinct keys — a crash loop can't flood the endpoint", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < MAX_CLIENT_ERROR_REPORTS_PER_SESSION; index += 1) {
      expect(claimClientErrorSendSlot(`/social::boom-${index}`, storage)).toBe(true);
    }
    expect(claimClientErrorSendSlot("/social::one-too-many", storage)).toBe(false);
  });

  it("fails closed (does not claim) if storage access throws", () => {
    const throwingStorage = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    };
    expect(claimClientErrorSendSlot("/social::boom", throwingStorage)).toBe(false);
  });

  it("recovers from corrupted stored state instead of throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem("hoodlums.client-error-reporter.session", "not valid json");
    expect(claimClientErrorSendSlot("/social::boom", storage)).toBe(true);
  });
});
