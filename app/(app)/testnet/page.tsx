import type { Metadata } from "next";
import { TestnetLauncher } from "@/components/testnet-launcher";

export const metadata: Metadata = {
  title: "Token Launcher | Private Meme Token Studio",
  description: "Create wallet-signed test tokens on Robinhood Chain or Solana devnet.",
};

export default function TestnetPage() {
  return <TestnetLauncher />;
}
