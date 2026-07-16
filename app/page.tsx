import Link from "next/link";
import { ArtworkSiteGenerator } from "@/components/artwork-site-generator";
import { ArtworkUploadController } from "@/components/artwork-upload-controller";
import { BuildSiteGate } from "@/components/build-site-gate";
import { DexscreenerSiteSection } from "@/components/dexscreener-site-section";
import { GeneratedSiteProjectGuard } from "@/components/generated-site-project-guard";
import { LivingLaunchpadMotion } from "@/components/living-launchpad-motion";
import { NewTokenController } from "@/components/new-token-controller";
import { RobinhoodTestnetGuard } from "@/components/robinhood-testnet-guard";
import { StudioProviderTransfer } from "@/components/studio-provider-transfer";
import { TokenStudio } from "@/components/token-studio";

const floatingLink = {
  position: "fixed" as const,
  right: 18,
  zIndex: 80,
  padding: "12px 15px",
  border: "1px solid rgba(85,255,120,.48)",
  borderRadius: 8,
  color: "#071008",
  background: "#55ff78",
  boxShadow: "0 12px 35px rgba(0,0,0,.4)",
  font: '800 10px "IBM Plex Mono", monospace',
};

export default function Home() {
  return (
    <>
      <LivingLaunchpadMotion />
      <ArtworkUploadController />
      <ArtworkSiteGenerator />
      <DexscreenerSiteSection />
      <GeneratedSiteProjectGuard />
      <BuildSiteGate />
      <NewTokenController />
      <StudioProviderTransfer />
      <RobinhoodTestnetGuard />
      <Link
        href="/social"
        style={{
          ...floatingLink,
          bottom: 174,
          color: "#fff7ca",
          background: "#172014",
          borderColor: "rgba(232,196,53,.65)",
        }}
      >
        SOCIAL PUBLISHING HUB ↗
      </Link>
      <Link href="/providers" style={{ ...floatingLink, bottom: 70 }}>
        NOXA + PONS LAUNCH ↗
      </Link>
      <Link href="/testnet" style={{ ...floatingLink, bottom: 18 }}>
        OPEN TESTNET LAB ↗
      </Link>
      <TokenStudio />
    </>
  );
}
