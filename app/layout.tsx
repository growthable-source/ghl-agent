import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { DM_Sans, DM_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import CannyIdentify from "@/components/CannyIdentify";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// ────────────────────────────────────────────────────────────────────────
// SEO METADATA
// ────────────────────────────────────────────────────────────────────────
// Primary keywords targeted (in order of priority):
//   1. "GoHighLevel AI" / "GoHighLevel AI add-on" (marketplace traffic)
//   2. "HubSpot AI" / "AI agent HubSpot"
//   3. "conversational AI" (broad head term)
//   4. "agentic AI for GoHighLevel" / "AI agent GoHighLevel"
//   5. "AI receptionist" / "AI sales agent" (long-tail)
//
// `metadataBase` is used by Next to resolve absolute URLs for OG/Twitter
// images and canonical links. Set once, read everywhere.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  // Title: keyword-rich but readable. Default is shown on most pages;
  // the landing page can override via `generateMetadata` if needed.
  // Format: <primary value prop> — <product> <category>
  title: {
    default: 'Voxility — AI Agents for GoHighLevel & HubSpot | Self-Improving Conversational AI',
    template: '%s | Voxility',
  },

  description:
    'Voxility is the conversational AI platform for GoHighLevel and HubSpot. AI agents that answer calls, respond to SMS, qualify leads, book appointments — and get measurably better every day from the conversations they have. Install free from the GoHighLevel marketplace.',

  // Keyword meta tag is largely ignored by Google but some secondary
  // engines (Yandex, Baidu) + marketplace crawlers still read it. Low
  // cost, small potential upside.
  keywords: [
    'GoHighLevel AI',
    'GoHighLevel AI add-on',
    'HubSpot AI',
    'conversational AI',
    'agentic AI for GoHighLevel',
    'AI agent GoHighLevel',
    'AI for GoHighLevel',
    'GoHighLevel voice AI',
    'AI SDR GoHighLevel',
    'AI receptionist',
    'AI sales agent',
    'LeadConnector AI',
    'HighLevel AI agent',
    'self-improving AI',
    'AI for CRM',
  ],

  authors: [{ name: 'Voxility' }],
  creator: 'Voxility',
  publisher: 'Voxility',

  // Canonical + language alternates. Canonical goes to the bare domain
  // so Google doesn't split signal between utm-tagged URLs.
  alternates: {
    canonical: '/',
  },

  // OG = how the page previews on Facebook, LinkedIn, Slack, Discord.
  // Images are auto-picked up from /app/opengraph-image.png by Next.
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Voxility',
    title: 'Voxility — AI Agents for GoHighLevel & HubSpot',
    description:
      'Conversational AI that answers calls, responds to texts, books appointments — and gets better every day. Self-improving agents for GoHighLevel and HubSpot.',
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Voxility — AI Agents for GoHighLevel & HubSpot',
    description:
      'Self-improving AI agents that answer calls, respond to texts, and book appointments inside your CRM. Free while in beta.',
    // creator: '@voxility_ai',   // uncomment when handle exists
  },

  // Explicit robots. Default allow; adjust if we ever need to de-index
  // paid-traffic landing variants.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },

  category: 'technology',
}

// `viewport` + `themeColor` moved out of the `metadata` export in Next
// 15+ — they live here in their own export. Theme color tints the
// browser chrome / PWA splash to the brand accent.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fa4d2e',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
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
