import type { Metadata, Viewport } from "next";
import { AppNavigation, MobileBottomNavigation } from "@/components/app-navigation";
import { WalletProviderSelector } from "@/components/wallet-provider-selector";
import "./globals.css";
import "./hoodlums-brand-theme.css";
import "./hoodlums-dashboard-consistency.css";
import "./hoodlums-studio-consistency.css";
import "./allocation-mobile-tabs.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hoodlums.dev"),
  title: {
    default: "HOODLUMS Launchpad — This Is Just the Beginning",
    template: "%s | HOODLUMS",
  },
  description:
    "Build, test and prepare meme-token launches through the private HOODLUMS command centre.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "HOODLUMS",
    title: "HOODLUMS Launchpad — This Is Just the Beginning",
    description:
      "Build the token, test the contract and prepare the allocation from one private launch command centre.",
  },
  twitter: {
    card: "summary",
    title: "HOODLUMS Launchpad — This Is Just the Beginning",
    description:
      "Build the token, test the contract and prepare the allocation from one private launch command centre.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030805",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppNavigation />
        {children}
        <MobileBottomNavigation />
        <WalletProviderSelector />
      </body>
    </html>
  );
}
