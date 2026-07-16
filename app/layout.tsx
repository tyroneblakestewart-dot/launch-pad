import type { Metadata, Viewport } from "next";
import { WalletProviderSelector } from "@/components/wallet-provider-selector";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hoodlums.dev"),
  title: {
    default: "HOODLUMS Launchpad — This Is Just the Beginning",
    template: "%s | HOODLUMS",
  },
  description:
    "Build, test and prepare meme-token launches through the private HOODLUMS command centre.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "HOODLUMS",
    title: "HOODLUMS Launchpad — This Is Just the Beginning",
    description:
      "Build the token, test the contract and prepare the allocation from one private launch command centre.",
    images: [
      {
        url: "/hoodlums-robbin-hero.webp",
        width: 900,
        height: 900,
        alt: "Robbin the Leader — HOODLUMS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HOODLUMS Launchpad — This Is Just the Beginning",
    description:
      "Build the token, test the contract and prepare the allocation from one private launch command centre.",
    images: ["/hoodlums-robbin-hero.webp"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030805",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <WalletProviderSelector />
      </body>
    </html>
  );
}
