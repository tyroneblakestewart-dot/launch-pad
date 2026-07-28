import type { Metadata } from "next";
import { TestnetLauncher } from "@/components/testnet-launcher";

export const metadata: Metadata = {
  title: "Testnet Launcher | Private Meme Token Studio",
  description: "Create wallet-signed test tokens on Robinhood Chain testnet or Solana devnet.",
};

export default function TestnetPage() {
  return <TestnetLauncher />;
}
