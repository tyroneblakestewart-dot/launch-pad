import { ArtworkSiteGenerator } from "@/components/artwork-site-generator";
import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { HoodlumsWelcomeModal } from "@/components/hoodlums-welcome-modal";
import { RobinhoodTestnetDeploymentController } from "@/components/robinhood-testnet-deployment-controller";
import { TokenStudioWorkspace } from "@/components/token-studio-workspace";

export default function Home() {
  return (
    <>
      <HoodlumsWelcomeModal />
      <ArtworkUploadController />
      <ArtworkSiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <RobinhoodTestnetDeploymentController />
      <div id="launch-studio" style={{ scrollMarginTop: 16, background: "#050706" }}>
        <TokenStudioWorkspace />
      </div>
    </>
  );
}
