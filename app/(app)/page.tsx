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
  const previewFlag = (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM];
  const [liveSites, { content }, { content: pathChooserContent }] = await Promise.all([
    listLiveGeneratedSites(),
    resolvePageContent("home", previewFlag),
    resolvePageContent("path-chooser", previewFlag),
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
        showPlans
      />
      <div id="launch-studio" style={{ scrollMarginTop: 16 }}>
        <TokenStudioWorkspace
          pathChooserContent={{
            eyebrow: pathChooserContent.eyebrow,
            title: pathChooserContent.title,
            subheading: pathChooserContent.subheading,
            dismissedContinueLabel: pathChooserContent.dismissed_continue_label,
            fullDetailsLabel: pathChooserContent.full_details_label,
          }}
        />
      </div>
    </>
  );
}
