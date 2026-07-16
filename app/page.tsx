import { ArtworkSiteGenerator } from "@/components/artwork-site-generator";
import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { HoodlumsLaunchHero } from "@/components/hoodlums-launch-hero";
import { NewTokenController } from "@/components/new-token-controller";
import { RobinhoodTestnetDeploymentController } from "@/components/robinhood-testnet-deployment-controller";
import { TokenStudio } from "@/components/token-studio";

export default function Home() {
  return (
    <>
      <ArtworkUploadController />
      <ArtworkSiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <NewTokenController />
      <RobinhoodTestnetDeploymentController />
      <HoodlumsLaunchHero />
      <div id="launch-studio" style={{ scrollMarginTop: 16, background: "#050706" }}>
        <TokenStudio />
      </div>
    </>
  );
}
