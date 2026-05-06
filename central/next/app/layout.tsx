import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { headers } from "next/headers"
import ContextProvider from "@/context";
import ChakraProvider from "@/components/chakra/provider"
import { Toaster } from "@/components/ui/toaster";
import Script from "next/script"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CryptoClaw",
  description: "Pay with crypto. Control the claw. Win prizes.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isProd = process.env.NODE_ENV === "production";

  const headersObj = await headers();
  const cookies = headersObj.get('cookie')

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preload the card back so the first auto-shuffle doesn't flash the
            simey CSS solid-blue fallback color while the bg-image fetches. */}
        <link rel="preload" as="image" href="/cards/back.png" />
      </head>
      {isProd && <Script defer src={process.env.NEXT_PUBLIC_UMAMI_SRC} data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID} />}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Persistent invisible bitmap: keeps iOS Safari's GPU compositing
            layer for the card back warm across page reloads. Without this,
            a refresh loses the prior layer and the first auto-shuffle paints
            a transparent frame while the bitmap is uploaded to GPU. */}
        <img
          src="/cards/back.png"
          alt=""
          aria-hidden="true"
          decoding="sync"
          loading="eager"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 2,
            height: 2,
            opacity: 0,
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
        <ContextProvider cookies={cookies}>
          <ChakraProvider>
            {children}
            <Toaster />
          </ChakraProvider>
        </ContextProvider>
      </body>
    </html>
  );
}
