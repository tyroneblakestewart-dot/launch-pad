import { afterEach, describe, expect, it } from "vitest";
import Link from "next/link";
import BondingCurvePage from "@/app/(app)/bonding-curve/page";
import AllocationsPage from "@/app/(app)/allocations/page";
import PublicGeneratedSitePage from "@/app/[slug]/page";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import type { PublicGeneratedSite } from "@/lib/public-site";
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

afterEach(() => {
  resetPageContentStoreForTests();
  resetPublicGeneratedSiteAdapterForTests();
  resetDexscreenerPairCacheForTests();
});

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
