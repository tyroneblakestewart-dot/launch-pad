import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import HomePage from "@/app/(app)/page";
import ProvidersPage from "@/app/(app)/providers/page";
import BondingCurvePage from "@/app/(app)/bonding-curve/page";
import AllocationsPage from "@/app/(app)/allocations/page";
import AccountPage from "@/app/(app)/account/page";
import PublicGeneratedSitePage from "@/app/[slug]/page";
import { HoodlumsMarketHome } from "@/components/hoodlums-market-home";
import { ProviderLauncher } from "@/components/provider-launcher";
import { TokenAllocationDesk } from "@/components/token-allocation-desk";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import { resetDexscreenerPairCacheForTests } from "@/lib/server/dexscreener";
import {
  createMemoryPageContentStore,
  resetPageContentStoreForTests,
  setPageContentStoreForTests,
} from "@/lib/server/page-content-store";

let cookieJar = new Map<string, { value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
  }),
}));

type ReactNode = unknown;
type ReactElementLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: ReactNode): node is ReactElementLike {
  return Boolean(node) && typeof node === "object" && "type" in (node as object) && "props" in (node as object);
}

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (isElement(node)) return collectText(node.props.children as ReactNode);
  return "";
}

function findAll(node: ReactNode, predicate: (el: ReactElementLike) => boolean, acc: ReactElementLike[] = []): ReactElementLike[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, acc));
    return acc;
  }
  if (isElement(node)) {
    if (predicate(node)) acc.push(node);
    findAll(node.props.children as ReactNode, predicate, acc);
  }
  return acc;
}

async function publishOverride(pageId: string, elementId: string, elementType: "heading" | "text" | "button_label" | "button_link" | "visibility", value: string) {
  const store = createMemoryPageContentStore();
  setPageContentStoreForTests(store);
  await store.saveDraft({ pageId, elementId, elementType, value, actor: "admin" });
  await store.publish({ pageId, elementId, actor: "admin" });
}

beforeEach(() => {
  cookieJar = new Map();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
});

afterEach(() => {
  resetPageContentStoreForTests();
  resetPublicGeneratedSiteAdapterForTests();
  resetDexscreenerPairCacheForTests();
  resetAdminStoresForTests();
});

async function authenticatePreviewSession(): Promise<void> {
  const token = "a-real-admin-session-token";
  await createAdminSession(hashAdminSessionToken(token));
  cookieJar.set("hoodlums_admin_session", { value: token });
}

describe("bonding-curve page content wiring", () => {
  it("renders the registered defaults when nothing has been published", async () => {
    const tree = await BondingCurvePage({ searchParams: undefined });
    const text = collectText(tree);
    expect(text).toContain("Bonding Curve");
    expect(text).toContain("ROBINHOOD CHAIN TESTNET · STEP 5");
    expect(text).toContain("Connect the curve to real testnet launches");

    const links = findAll(tree, (el) => el.type === Link);
    expect(links.some((link) => link.props.href === "/testnet" && collectText(link.props.children) === "Open testnet launcher")).toBe(true);
    expect(links.some((link) => link.props.href === "/liquidity-lab" && collectText(link.props.children) === "Open liquidity lab")).toBe(true);
  });

  it("renders a published override instead of the default", async () => {
    await publishOverride("bonding-curve", "hero_title", "heading", "Bonding Curve V2");
    const tree = await BondingCurvePage({ searchParams: undefined });
    const headings = findAll(tree, (el) => el.type === "h1");
    expect(headings.some((h1) => collectText(h1.props.children) === "Bonding Curve V2")).toBe(true);
    expect(headings.some((h1) => collectText(h1.props.children) === "Bonding Curve")).toBe(false);
  });

  it("hides the next-milestone section (and its CTAs) when its visibility toggle is published false", async () => {
    await publishOverride("bonding-curve", "next_step_visible", "visibility", "false");
    const tree = await BondingCurvePage({ searchParams: undefined });
    const text = collectText(tree);
    expect(text).not.toContain("Connect the curve to real testnet launches");

    const links = findAll(tree, (el) => el.type === Link);
    expect(links).toHaveLength(0);
  });
});

describe("home page content wiring", () => {
  it("passes the registered defaults into HoodlumsMarketHome as props", async () => {
    const tree = await HomePage({ searchParams: undefined });
    const [home] = findAll(tree, (el) => el.type === HoodlumsMarketHome);
    expect(home.props.heroEyebrow).toBe("BUILD. TEST. LAUNCH.");
    expect(home.props.heroTitleLine1).toBe("Launch a meme token");
    expect(home.props.heroTitleLine2).toBe("without the clutter.");
    expect(home.props.primaryCtaLabel).toBe("Create new token");
    expect(home.props.primaryCtaLink).toBe("#launch-studio");
  });

  it("passes a published override through to HoodlumsMarketHome", async () => {
    await publishOverride("home", "hero_title_line2", "heading", "guaranteed liquidity.");
    const tree = await HomePage({ searchParams: undefined });
    const [home] = findAll(tree, (el) => el.type === HoodlumsMarketHome);
    expect(home.props.heroTitleLine2).toBe("guaranteed liquidity.");
  });

  it("only shows a staged draft to an authenticated preview request", async () => {
    await authenticatePreviewSession();
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "home", elementId: "hero_sub", elementType: "text", value: "Draft sub-copy", actor: "admin" });

    const withoutPreview = await HomePage({ searchParams: Promise.resolve({}) });
    const [homeWithoutPreview] = findAll(withoutPreview, (el) => el.type === HoodlumsMarketHome);
    expect(homeWithoutPreview.props.heroSub).not.toBe("Draft sub-copy");

    const withPreview = await HomePage({ searchParams: Promise.resolve({ cms_preview: "1" }) });
    const [homeWithPreview] = findAll(withPreview, (el) => el.type === HoodlumsMarketHome);
    expect(homeWithPreview.props.heroSub).toBe("Draft sub-copy");
  });
});

describe("providers page content wiring", () => {
  it("passes the registered defaults into ProviderLauncher as props", async () => {
    const tree = await ProvidersPage({ searchParams: undefined });
    const [providers] = findAll(tree, (el) => el.type === ProviderLauncher);
    expect(providers.props.headerEyebrow).toBe("PRIVATE LAUNCH ADAPTERS");
    expect(providers.props.headerTitle).toBe("Robinhood provider launch desk");
    expect(providers.props.backToStudioLabel).toBe("Back to studio");
  });

  it("passes a published override through to ProviderLauncher", async () => {
    await publishOverride("providers", "header_title", "heading", "Provider desk V2");
    const tree = await ProvidersPage({ searchParams: undefined });
    const [providers] = findAll(tree, (el) => el.type === ProviderLauncher);
    expect(providers.props.headerTitle).toBe("Provider desk V2");
  });

  it("only shows a staged draft to an authenticated preview request", async () => {
    await authenticatePreviewSession();
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "providers", elementId: "header_intro", elementType: "text", value: "Draft intro", actor: "admin" });

    const withoutPreview = await ProvidersPage({ searchParams: Promise.resolve({}) });
    const [providersWithoutPreview] = findAll(withoutPreview, (el) => el.type === ProviderLauncher);
    expect(providersWithoutPreview.props.headerIntro).not.toBe("Draft intro");

    const withPreview = await ProvidersPage({ searchParams: Promise.resolve({ cms_preview: "1" }) });
    const [providersWithPreview] = findAll(withPreview, (el) => el.type === ProviderLauncher);
    expect(providersWithPreview.props.headerIntro).toBe("Draft intro");
  });
});

describe("allocations page content wiring", () => {
  it("renders the default liquidity-lab CTA", async () => {
    const tree = await AllocationsPage({ searchParams: undefined });
    const links = findAll(tree, (el) => el.type === Link);
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("/liquidity-lab");
    expect(collectText(links[0].props.children)).toBe("Open Testnet Liquidity Lab →");
  });

  it("hides the CTA entirely when published invisible", async () => {
    await publishOverride("allocations", "liquidity_cta_visible", "visibility", "false");
    const tree = await AllocationsPage({ searchParams: undefined });
    expect(findAll(tree, (el) => el.type === Link)).toHaveLength(0);
  });

  it("uses a published label/link override", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "allocations", elementId: "liquidity_cta_label", elementType: "button_label", value: "Go to lab", actor: "admin" });
    await store.publish({ pageId: "allocations", elementId: "liquidity_cta_label", actor: "admin" });
    await store.saveDraft({ pageId: "allocations", elementId: "liquidity_cta_link", elementType: "button_link", value: "/testnet", actor: "admin" });
    await store.publish({ pageId: "allocations", elementId: "liquidity_cta_link", actor: "admin" });

    const tree = await AllocationsPage({ searchParams: undefined });
    const links = findAll(tree, (el) => el.type === Link);
    expect(links[0].props.href).toBe("/testnet");
    expect(collectText(links[0].props.children)).toBe("Go to lab");
  });

  it("passes the registered header defaults into TokenAllocationDesk as props", async () => {
    const tree = await AllocationsPage({ searchParams: undefined });
    const [desk] = findAll(tree, (el) => el.type === TokenAllocationDesk);
    expect(desk.props.headerEyebrow).toBe("PRIVATE TOKEN OPERATIONS");
    expect(desk.props.headerTitle).toBe("Allocation and distribution desk");
  });

  it("passes a published header override through to TokenAllocationDesk", async () => {
    await publishOverride("allocations", "header_title", "heading", "Allocation desk V2");
    const tree = await AllocationsPage({ searchParams: undefined });
    const [desk] = findAll(tree, (el) => el.type === TokenAllocationDesk);
    expect(desk.props.headerTitle).toBe("Allocation desk V2");
  });

  it("only shows a staged header draft to an authenticated preview request", async () => {
    await authenticatePreviewSession();
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "allocations", elementId: "header_eyebrow", elementType: "text", value: "Draft eyebrow", actor: "admin" });

    const withoutPreview = await AllocationsPage({ searchParams: Promise.resolve({}) });
    const [deskWithoutPreview] = findAll(withoutPreview, (el) => el.type === TokenAllocationDesk);
    expect(deskWithoutPreview.props.headerEyebrow).not.toBe("Draft eyebrow");

    const withPreview = await AllocationsPage({ searchParams: Promise.resolve({ cms_preview: "1" }) });
    const [deskWithPreview] = findAll(withPreview, (el) => el.type === TokenAllocationDesk);
    expect(deskWithPreview.props.headerEyebrow).toBe("Draft eyebrow");
  });
});

const FIXTURE: PublicGeneratedSite = {
  slug: "hoodlums",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew taking meme culture to a new chain.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: "",
  generatedSiteHtml: null,
  contractAddress: "0x3bf7447cd055f1475a8b09090c7b062abc9d3798",
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  status: "launched",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("public token site ([slug]) chrome content wiring", () => {
  it("passes the registered defaults into the Dexscreener chrome", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as ReactElementLike[];
    const dexscreener = children[1] as ReactElementLike;
    expect(dexscreener.type).toBe(PublicDexscreenerSection);
    expect(dexscreener.props.heading).toBe("Dexscreener");
    expect(dexscreener.props.openLabel).toBe("OPEN DEXSCREENER ↗");
  });

  it("hides the Dexscreener chrome entirely when published invisible, even with a contract address", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    await publishOverride("public-token-site", "dexscreener_visible", "visibility", "false");

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as ReactElementLike[];
    expect(children[1]).toBeNull();
  });

  it("uses a published heading override for the Dexscreener chrome", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    await publishOverride("public-token-site", "dexscreener_heading", "heading", "Live chart");

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as ReactElementLike[];
    const dexscreener = children[1] as ReactElementLike;
    expect(dexscreener.props.heading).toBe("Live chart");
  });
});

describe("account page content wiring", () => {
  it("renders the registered defaults when nothing has been published", async () => {
    const tree = await AccountPage({ searchParams: undefined });
    const text = collectText(tree);
    expect(text).toContain("Choose how you sign in.");
    expect(text).toContain("Email and project sync");
    expect(text).toContain("Solana and EVM wallet");
    expect(text).toContain(
      "Existing wallet connections inside the launch tools remain unchanged while this account system is built safely in separate steps.",
    );
  });

  it("renders a published override for a header field and a provider row note", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "account", elementId: "header_title", elementType: "heading", value: "Sign in, your way.", actor: "admin" });
    await store.publish({ pageId: "account", elementId: "header_title", actor: "admin" });
    await store.saveDraft({ pageId: "account", elementId: "metamask_note", elementType: "text", value: "Recommended EVM wallet", actor: "admin" });
    await store.publish({ pageId: "account", elementId: "metamask_note", actor: "admin" });

    const tree = await AccountPage({ searchParams: undefined });
    const text = collectText(tree);
    expect(text).toContain("Sign in, your way.");
    expect(text).toContain("Recommended EVM wallet");
    expect(text).not.toContain("Choose how you sign in.");
  });

  it("only shows a staged draft to an authenticated preview request", async () => {
    await authenticatePreviewSession();
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({ pageId: "account", elementId: "footer_copy", elementType: "text", value: "Draft footer copy", actor: "admin" });

    const withoutPreview = await AccountPage({ searchParams: Promise.resolve({}) });
    expect(collectText(withoutPreview)).not.toContain("Draft footer copy");

    const withPreview = await AccountPage({ searchParams: Promise.resolve({ cms_preview: "1" }) });
    expect(collectText(withPreview)).toContain("Draft footer copy");
  });
});
