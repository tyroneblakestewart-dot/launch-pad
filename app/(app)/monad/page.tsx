import type { Metadata } from "next";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { MonadTestnetLauncher } from "@/components/monad-testnet-launcher";

export const metadata: Metadata = {
  title: "Monad Testnet Launcher | Private Meme Token Studio",
  description: "Create wallet-signed fixed-supply test tokens on Monad Testnet.",
};

export default function MonadTestnetPage() {
  return (
    <>
      <AccountOverlayShell />
      <MonadTestnetLauncher />
    </>
  );
}
