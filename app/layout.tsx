import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import CannyIdentify from "@/components/CannyIdentify";
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
  title: "Voxility AI — Conversational AI Agents",
  description: "Build AI agents that talk, text, and close deals. Connect your CRM, calendar, and phone — all from one platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          id="canny-sdk"
          strategy="lazyOnload"
          dangerouslySetInnerHTML={{
            __html: `!function(w,d,i,s){function l(){if(!d.getElementById(i)){var f=d.getElementsByTagName(s)[0],e=d.createElement(s);e.type="text/javascript",e.async=!0,e.src="https://sdk.canny.io/sdk.js",f.parentNode.insertBefore(e,f)}}if("function"!=typeof w.Canny){var c=function(){c.q.push(arguments)};c.q=[],w.Canny=c,"complete"===d.readyState?l():w.attachEvent?w.attachEvent("onload",l):w.addEventListener("load",l,!1)}}(window,document,"canny-jssdk","script");`,
          }}
        />
        <SessionProvider>
          <ThemeProvider>
            <CannyIdentify />
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
