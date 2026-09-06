import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sign in with Google, phase 1 (6 Sep 2026): the account overlay's Google row,
// the GoogleAccountPanel's non-custodial contract, and the /admin Sign-ins
// section. Source-pattern pins, since the Vitest suite runs in plain Node.

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Account overlay — Google live, GitHub gone, X still coming next", () => {
  it("renders the GoogleAccountPanel in place of the static Google row and drops GitHub entirely", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    expect(overlay).toContain('import { GoogleAccountPanel } from "./google-account-panel"');
    expect(overlay).toContain('<GoogleAccountPanel note={content.google_note} logo={PROVIDER_LOGOS.Google} mark="google" />');
    expect(overlay).toContain('const webAccounts: { name: ProviderName; note: string }[] = [{ name: "X", note: content.x_note }];');
    expect(overlay).not.toContain('"GitHub"');
    expect(overlay).not.toContain("github.svg");
    expect(overlay).not.toContain("github_note");

    const content = await source("lib", "account-overlay-content.ts");
    expect(content).toContain("google_note");
    expect(content).not.toContain("github_note");
    const registry = await source("lib", "page-content-registry.ts");
    expect(registry).toContain('id: "google_note"');
    expect(registry).not.toContain('id: "github_note"');
  });
});

describe("GoogleAccountPanel", () => {
  it("starts sign-in through the server redirect and reads the session with a plain fetch — no client-side Google SDK or client id", async () => {
    const panel = await source("components", "google-account-panel.tsx");
    expect(panel).toContain('window.location.assign(`/api/account/google/start?returnTo=${encodeURIComponent(returnTo)}`)');
    expect(panel).toContain('fetch("/api/account/session", { cache: "no-store", credentials: "same-origin" })');
    expect(panel).not.toContain("NEXT_PUBLIC_GOOGLE");
    expect(panel).not.toContain("accounts.google.com");
  });

  it("keeps the row honest: disabled 'Coming next' while unconfigured, 'Sign in' once configured", async () => {
    const panel = await source("components", "google-account-panel.tsx");
    expect(panel).toContain("disabled={configured !== true}");
    expect(panel).toContain('{configured === null ? "Checking…" : configured ? "Sign in" : "Coming next"}');
  });

  it("links a wallet with one signature over a server-issued challenge and refuses a wallet that is not the confirmed one", async () => {
    const panel = await source("components", "google-account-panel.tsx");
    expect(panel).toContain('purpose: "account:link-wallet"');
    expect(panel).toContain("walletClient.signMessage({ account: activeAccount, message: challenge.message })");
    expect(panel).toContain("if (activeAccount.toLowerCase() !== wallet.account.toLowerCase())");
    expect(panel).toContain('fetch("/api/account/link-wallet"');
    // Never asks for a key or seed phrase; never calls eth_requestAccounts itself (the wallet dock does that).
    expect(panel).not.toMatch(/private ?key|seed phrase|mnemonic/i);
    expect(panel).not.toContain("eth_requestAccounts");
  });

  it("makes Delete a two-tap action and clears the ?google= outcome from the URL after reading it", async () => {
    const panel = await source("components", "google-account-panel.tsx");
    expect(panel).toContain("if (!deleteArmed) {");
    expect(panel).toContain('{deleteArmed ? "Delete — are you sure?" : "Delete account"}');
    expect(panel).toContain('url.searchParams.delete("google")');
    expect(panel).toContain('url.searchParams.delete("reason")');
    expect(panel).toContain("window.history.replaceState");
  });

  it("gives the action buttons 44px touch targets under a coarse pointer (rule 7)", async () => {
    const css = await source("components", "account-overlay.module.css");
    expect(css).toContain(".googlePanel");
    expect(css).toContain(".googleActions button");
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.googleActions button[\s\S]*min-height: 44px/);
  });
});

describe("/admin Sign-ins section (rule 10)", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { AdminGoogleAccountsSection } from "@/components/admin-google-accounts-section"');
    expect(dashboard).toContain('{ id: "google-accounts", label: "Sign-ins" }');
    expect(dashboard).toContain('activeSection === "google-accounts" ? <AdminGoogleAccountsSection /> : null');
  });

  it("reads from the admin-only endpoint and shows email, link state and sign-in times", async () => {
    const section = await source("components", "admin-google-accounts-section.tsx");
    expect(section).toContain('"/api/admin/google-accounts"');
    expect(section).toContain("account.email");
    expect(section).toContain("account.linkedWalletAddress");
    expect(section).toContain("account.lastSignInAt");
    expect(section).toContain("counts.signedIn7d");
  });
});
