import { ArtworkSiteGenerator } from "@/components/artwork-site-generator";
import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { HoodlumsLaunchHero } from "@/components/hoodlums-launch-hero";
import { NewTokenController } from "@/components/new-token-controller";
import { RobinhoodTestnetDeploymentController } from "@/components/robinhood-testnet-deployment-controller";
import { TokenStudioWorkspace } from "@/components/token-studio-workspace";

export default function Home() {
  return (
    <>
      <style>{`
        @media (max-width: 900px) {
          section[aria-labelledby="hoodlums-dashboard-title"] > header:first-child,
          section[aria-labelledby="hoodlums-dashboard-title"] > div > header:first-child {
            display: none !important;
          }
        }
      `}</style>
      <ArtworkUploadController />
      <ArtworkSiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <NewTokenController />
      <RobinhoodTestnetDeploymentController />
      <HoodlumsLaunchHero />
      <div id="launch-studio" style={{ scrollMarginTop: 16, background: "#050706" }}>
        <TokenStudioWorkspace />
      </div>
    </>
  );
}
