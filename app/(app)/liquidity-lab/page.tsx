import type { Metadata } from "next";
import { LiquidityLab } from "@/components/liquidity-lab";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Testnet Liquidity Lab | HOODLUMS",
  description: "Deploy and test a private HOODLUMS liquidity pool on Robinhood Chain Testnet.",
};

type LiquidityLabPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LiquidityLabPage({ searchParams }: LiquidityLabPageProps) {
  const { content } = await resolvePageContent(
    "liquidity-lab",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <LiquidityLab
      heroEyebrow={content.hero_eyebrow}
      heroTitle={content.hero_title}
      heroIntro={content.hero_intro}
    />
  );
}
