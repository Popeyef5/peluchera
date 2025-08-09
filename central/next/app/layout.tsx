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
      {isProd && <Script defer src={process.env.NEXT_PUBLIC_UMAMI_SRC} data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID} />}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
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
