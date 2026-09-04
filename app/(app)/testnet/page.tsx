import type { Metadata } from "next";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { TestnetLauncher } from "@/components/testnet-launcher";

export const metadata: Metadata = {
  title: "Token Launcher | Private Meme Token Studio",
  description: "Create wallet-signed test tokens on Robinhood Chain or Solana devnet.",
};

export default function TestnetPage() {
  return (
    <>
      <AccountOverlayShell />
      <TestnetLauncher />
    </>
  );
}
