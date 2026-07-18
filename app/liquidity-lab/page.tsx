import type { Metadata } from "next";
import { LiquidityLab } from "@/components/liquidity-lab";

export const metadata: Metadata = {
  title: "Testnet Liquidity Lab | HOODLUMS",
  description: "Deploy and test a private HOODLUMS liquidity pool on Robinhood Chain Testnet.",
};

export default function LiquidityLabPage() {
  return <LiquidityLab />;
}
