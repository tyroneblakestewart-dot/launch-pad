import type { Metadata } from "next";
import { WalletProviderSelector } from "@/components/wallet-provider-selector";
import "./globals.css";

export const metadata: Metadata = {
  title: "Private Meme Token Studio",
  description:
    "Prepare wallet-signed meme-token launches and generate a matching landing page.",
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
