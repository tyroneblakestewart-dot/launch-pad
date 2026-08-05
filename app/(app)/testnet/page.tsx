import type { Metadata } from "next";
import { TestnetLauncher } from "@/components/testnet-launcher";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Testnet Launcher | Private Meme Token Studio",
  description: "Create wallet-signed test tokens on Robinhood Chain testnet or Solana devnet.",
};

type TestnetPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TestnetPage({ searchParams }: TestnetPageProps) {
  const { content } = await resolvePageContent(
    "testnet",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <TestnetLauncher
      heroEyebrow={content.hero_eyebrow}
      heroTitleLine1={content.hero_title_line1}
      heroTitleLine2={content.hero_title_line2}
      heroIntro={content.hero_intro}
    />
  );
}
