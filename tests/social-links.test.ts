import { describe, expect, it } from "vitest";
import { extractTelegramHandle, extractTwitterHandle, telegramProfileUrl, xProfileUrl } from "@/lib/social-links";

describe("extractTwitterHandle", () => {
  it("extracts the same handle from URL, @ and bare forms", () => {
    expect(extractTwitterHandle("https://x.com/doggocreator")).toBe("doggocreator");
    expect(extractTwitterHandle("@doggocreator")).toBe("doggocreator");
    expect(extractTwitterHandle("doggocreator")).toBe("doggocreator");
  });

  it("maps a twitter.com URL to the same handle as x.com", () => {
    expect(extractTwitterHandle("https://twitter.com/doggocreator")).toBe("doggocreator");
    expect(extractTwitterHandle("https://x.com/doggocreator")).toBe("doggocreator");
  });

  it("fails closed on an unrecognised host", () => {
    expect(extractTwitterHandle("https://example.com/doggocreator")).toBeNull();
  });

  it("fails closed on a javascript: value", () => {
    expect(extractTwitterHandle("javascript:alert(1)")).toBeNull();
  });

  it("fails closed on an empty string", () => {
    expect(extractTwitterHandle("")).toBeNull();
    expect(extractTwitterHandle("   ")).toBeNull();
  });

  it("fails closed on an over-long handle", () => {
    expect(extractTwitterHandle("a".repeat(16))).toBeNull();
    expect(extractTwitterHandle("https://x.com/" + "a".repeat(16))).toBeNull();
  });

  it("fails closed on non-string input", () => {
    expect(extractTwitterHandle(null)).toBeNull();
    expect(extractTwitterHandle(undefined)).toBeNull();
    expect(extractTwitterHandle(42)).toBeNull();
  });

  it("rejects reserved X platform paths in URL form, deliberately over a real handle with the same name", () => {
    const reserved = [
      "i",
      "home",
      "search",
      "explore",
      "notifications",
      "messages",
      "settings",
      "intent",
      "share",
      "compose",
      "login",
      "signup",
      "privacy",
      "tos",
    ];
    for (const path of reserved) {
      expect(extractTwitterHandle(`https://x.com/${path}`)).toBeNull();
      expect(extractTwitterHandle(`https://x.com/${path.toUpperCase()}`)).toBeNull();
    }
    // The specific case that motivated this: x.com/i/flow/login should not
    // extract "i" as if it were a real handle.
    expect(extractTwitterHandle("https://x.com/i/flow/login")).toBeNull();
  });

  it("still accepts real handles that are not reserved words", () => {
    expect(extractTwitterHandle("https://x.com/doggocreator")).toBe("doggocreator");
    expect(extractTwitterHandle("https://x.com/hoodlums_dev")).toBe("hoodlums_dev");
  });
});

describe("extractTelegramHandle", () => {
  it("extracts the same handle from t.me URL, telegram.me URL, schemeless, @ and bare forms", () => {
    expect(extractTelegramHandle("https://t.me/doggocreator")).toBe("doggocreator");
    expect(extractTelegramHandle("https://telegram.me/doggocreator")).toBe("doggocreator");
    expect(extractTelegramHandle("t.me/doggocreator")).toBe("doggocreator");
    expect(extractTelegramHandle("@doggocreator")).toBe("doggocreator");
    expect(extractTelegramHandle("doggocreator")).toBe("doggocreator");
  });

  it("fails closed on an unrecognised host", () => {
    expect(extractTelegramHandle("https://example.com/doggocreator")).toBeNull();
  });

  it("fails closed on a javascript: value", () => {
    expect(extractTelegramHandle("javascript:alert(1)")).toBeNull();
  });

  it("fails closed on an empty string", () => {
    expect(extractTelegramHandle("")).toBeNull();
  });

  it("fails closed on an over-long or too-short handle", () => {
    expect(extractTelegramHandle("abcd")).toBeNull(); // under Telegram's 5-char minimum
    expect(extractTelegramHandle("a".repeat(33))).toBeNull();
    expect(extractTelegramHandle("1abcd")).toBeNull(); // must start with a letter
  });

  it("fails closed on non-string input", () => {
    expect(extractTelegramHandle(null)).toBeNull();
    expect(extractTelegramHandle(undefined)).toBeNull();
    expect(extractTelegramHandle(42)).toBeNull();
  });

  it("rejects the legacy joinchat invite-link format instead of extracting 'joinchat' as a handle", () => {
    expect(extractTelegramHandle("t.me/joinchat/AAAAAEabcdef")).toBeNull();
    expect(extractTelegramHandle("https://t.me/joinchat/AAAAAEabcdef")).toBeNull();
  });

  it("rejects reserved Telegram platform paths in URL form", () => {
    const reserved = [
      "joinchat",
      "s",
      "c",
      "addstickers",
      "addemoji",
      "proxy",
      "socks",
      "share",
      "iv",
      "setlanguage",
      "confirmphone",
      "login",
      "bg",
    ];
    for (const path of reserved) {
      expect(extractTelegramHandle(`https://t.me/${path}`)).toBeNull();
      expect(extractTelegramHandle(`https://t.me/${path.toUpperCase()}`)).toBeNull();
    }
  });

  it("fails closed on the public web-preview URL format (t.me/s/<channel>)", () => {
    // Telegram's web-preview links share the reserved "s" segment; a
    // creator pasting one gets plain text rather than a wrong/misleading
    // link. Deliberately not specially supported (see PR discussion).
    expect(extractTelegramHandle("https://t.me/s/mychannel")).toBeNull();
  });

  it("still accepts real handles that are not reserved words", () => {
    expect(extractTelegramHandle("https://t.me/doggocreator")).toBe("doggocreator");
    expect(extractTelegramHandle("t.me/hoodlums_dev")).toBe("hoodlums_dev");
  });
});

describe("profile URL builders", () => {
  it("builds the canonical x.com and t.me URLs from a handle", () => {
    expect(xProfileUrl("doggocreator")).toBe("https://x.com/doggocreator");
    expect(telegramProfileUrl("doggocreator")).toBe("https://t.me/doggocreator");
  });
});
