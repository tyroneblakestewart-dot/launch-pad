import type { Metadata } from "next";
import { HoodlumsFactorySetup } from "@/components/hoodlums-factory-setup";

export const metadata: Metadata = {
  title: "Factory Setup | HOODLUMS",
  description:
    "Owner-only, wallet-signed HoodlumsTokenFactory deployment on Robinhood Chain Testnet.",
};

export default function FactorySetupPage() {
  return <HoodlumsFactorySetup />;
}
