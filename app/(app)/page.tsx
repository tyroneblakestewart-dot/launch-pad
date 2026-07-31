import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { FullWebsiteGenerator } from "@/components/full-website-generator";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { HoodlumsMarketHome } from "@/components/hoodlums-market-home";
import { HoodlumsWelcomeModal } from "@/components/hoodlums-welcome-modal";
import { RobinhoodTestnetDeploymentController } from "@/components/robinhood-testnet-deployment-controller";
import { TokenStudioWorkspace } from "@/components/token-studio-workspace";
import { listLiveGeneratedSites } from "@/lib/server/public-generated-sites";

export default async function Home() {
  const liveSites = await listLiveGeneratedSites();

  return (
    <>
      <HoodlumsWelcomeModal />
      <ArtworkUploadController />
      <FullWebsiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <RobinhoodTestnetDeploymentController />
      <HoodlumsMarketHome liveSites={liveSites} />
      <div id="launch-studio" style={{ scrollMarginTop: 16, background: "#050706" }}>
        <TokenStudioWorkspace />
      </div>
    </>
  );
}
