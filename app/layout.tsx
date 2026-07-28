import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://hoodlums.dev"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
