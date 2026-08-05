import type { Metadata } from "next";
import { MonadTestnetLauncher } from "@/components/monad-testnet-launcher";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Monad Testnet Launcher | Private Meme Token Studio",
  description: "Create wallet-signed fixed-supply test tokens on Monad Testnet.",
};

type MonadTestnetPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MonadTestnetPage({ searchParams }: MonadTestnetPageProps) {
  const { content } = await resolvePageContent(
    "monad",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <MonadTestnetLauncher
      heroEyebrow={content.hero_eyebrow}
      heroTitleLine1={content.hero_title_line1}
      heroTitleLine2={content.hero_title_line2}
      heroIntro={content.hero_intro}
    />
  );
}
