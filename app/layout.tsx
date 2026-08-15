import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://hoodlums.dev"),
};

// viewport-fit=cover lets the mobile full-screen preview (issue #327
// problem 2) extend under the safe areas (notch/home indicator) so its own
// env(safe-area-inset-*) padding on the control bar has something to
// resolve against; without it those insets are always 0.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
