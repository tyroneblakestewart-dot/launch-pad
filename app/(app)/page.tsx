import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { FullWebsiteGenerator } from "@/components/full-website-generator";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { HoodlumsMarketHome } from "@/components/hoodlums-market-home";
import { HoodlumsWelcomeModal } from "@/components/hoodlums-welcome-modal";
import { RobinhoodTestnetDeploymentController } from "@/components/robinhood-testnet-deployment-controller";
import { TokenStudioWorkspace } from "@/components/token-studio-workspace";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";
import { listLiveGeneratedSites } from "@/lib/server/public-generated-sites";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const [liveSites, { content }] = await Promise.all([
    listLiveGeneratedSites(),
    resolvePageContent("home", (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM]),
  ]);

  return (
    <>
      <HoodlumsWelcomeModal />
      <ArtworkUploadController />
      <FullWebsiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <RobinhoodTestnetDeploymentController />
      <HoodlumsMarketHome
        liveSites={liveSites}
        heroEyebrow={content.hero_eyebrow}
        heroTitleLine1={content.hero_title_line1}
        heroTitleLine2={content.hero_title_line2}
        heroSub={content.hero_sub}
        primaryCtaLabel={content.primary_cta_label}
        primaryCtaLink={content.primary_cta_link}
        secondaryCtaLabel={content.secondary_cta_label}
        secondaryCtaLink={content.secondary_cta_link}
      />
      <div id="launch-studio" style={{ scrollMarginTop: 16 }}>
        <TokenStudioWorkspace />
      </div>
    </>
  );
}
