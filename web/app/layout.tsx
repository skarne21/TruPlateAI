import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TruPlate AI",
  description:
    "Log meals by photo, text or voice. Foods identified by AI, macros grounded in the USDA database.",
  appleWebApp: { capable: true, title: "TruPlate", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // `cover` lets the layout paint under the notch and home indicator; the
  // safe-area padding in globals.css is what keeps content out of them.
  viewportFit: "cover",
  // No pinch-zoom lock: capping the scale is a documented accessibility
  // failure, and iOS ignores it anyway.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#100d0b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
