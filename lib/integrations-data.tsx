/**
 * Single source of truth for the integrations + channels we surface on the
 * marketing site (homepage strip + the dedicated /integrations page). Keeping
 * the lists here means the homepage and the integrations page never drift.
 */
import {
  GoHighLevelIcon, HubSpotIcon, ShopifyIcon, VapiIcon, CalendlyIcon, CalcomIcon,
  StripeIcon, FacebookIcon, InstagramIcon, GoogleIcon, WhatsAppIcon, SmsIcon,
  LiveChatIcon, SlackIcon, ZapierIcon, MessengerIcon, VideoMeetingIcon, PhoneIcon,
  EmailIcon,
} from '@/components/icons/brand-icons'

export type LogoItem = { label: string; Icon: React.ComponentType<{ className?: string }> }

// GoHighLevel Marketplace listing — the Sponsored Partner badge links here.
export const MARKETPLACE_URL = 'https://marketplace.gohighlevel.com/'

/** Flat list used by the homepage "Integrates with" strip. */
export const INTEGRATIONS: LogoItem[] = [
  { label: 'GoHighLevel', Icon: GoHighLevelIcon },
  { label: 'HubSpot', Icon: HubSpotIcon },
  { label: 'Shopify', Icon: ShopifyIcon },
  { label: 'Facebook', Icon: FacebookIcon },
  { label: 'Instagram', Icon: InstagramIcon },
  { label: 'Zapier', Icon: ZapierIcon },
  { label: 'Slack', Icon: SlackIcon },
  { label: 'Stripe', Icon: StripeIcon },
  { label: 'Calendly', Icon: CalendlyIcon },
  { label: 'Cal.com', Icon: CalcomIcon },
  { label: 'Vapi', Icon: VapiIcon },
  { label: 'Google', Icon: GoogleIcon },
]

/** Channels the agent operates across — homepage strip + integrations page. */
export const CHANNELS: LogoItem[] = [
  { label: 'Zoom & Google Meet', Icon: VideoMeetingIcon },
  { label: 'Voice calls', Icon: PhoneIcon },
  { label: 'SMS', Icon: SmsIcon },
  { label: 'WhatsApp', Icon: WhatsAppIcon },
  { label: 'Facebook Messenger', Icon: MessengerIcon },
  { label: 'Instagram DMs', Icon: InstagramIcon },
  { label: 'Live chat widget', Icon: LiveChatIcon },
  { label: 'Slack', Icon: SlackIcon },
]

export type IntegrationItem = LogoItem & { blurb: string }
export type IntegrationGroup = { category: string; caption: string; items: IntegrationItem[] }

/**
 * Grouped, described integrations for the dedicated /integrations page.
 * GoHighLevel intentionally leads — it's the platform we build on and
 * resell as a Sponsored Partner.
 */
export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    category: 'CRM & platforms',
    caption: 'Your system of record. The agent reads and writes it natively.',
    items: [
      { label: 'GoHighLevel', Icon: GoHighLevelIcon, blurb: 'One-click Marketplace install. We build on HighLevel as a Sponsored Partner & reseller.' },
      { label: 'HubSpot', Icon: HubSpotIcon, blurb: 'Two-way contact, deal, and conversation sync.' },
      { label: 'Shopify', Icon: ShopifyIcon, blurb: 'Orders, customers, and storefront events feed the agent.' },
    ],
  },
  {
    category: 'Advertising',
    caption: 'Connect ad accounts so every click becomes a tracked, booked outcome.',
    items: [
      { label: 'Meta Ads', Icon: FacebookIcon, blurb: 'Facebook & Instagram lead ads engaged the instant they convert.' },
      { label: 'Google Ads', Icon: GoogleIcon, blurb: 'Search & PMax leads qualified and written back to your CRM.' },
      { label: 'Instagram', Icon: InstagramIcon, blurb: 'DMs and lead forms answered automatically.' },
    ],
  },
  {
    category: 'Calendars & scheduling',
    caption: 'Real-time availability so the agent books straight onto your calendar.',
    items: [
      { label: 'Calendly', Icon: CalendlyIcon, blurb: 'Live availability, instant confirmations, reminders.' },
      { label: 'Cal.com', Icon: CalcomIcon, blurb: 'Open-source scheduling, fully supported.' },
      { label: 'Google Calendar', Icon: GoogleIcon, blurb: 'Native two-way calendar sync.' },
    ],
  },
  {
    category: 'Messaging & channels',
    caption: 'One agent, every channel your customers actually use.',
    items: [
      { label: 'Twilio', Icon: SmsIcon, blurb: 'Two-way SMS & voice on local numbers, US & Canada.' },
      { label: 'WhatsApp', Icon: WhatsAppIcon, blurb: 'Conversations on the channel customers prefer.' },
      { label: 'Slack', Icon: SlackIcon, blurb: 'Pipe live chats to Slack and reply from a thread.' },
    ],
  },
  {
    category: 'Payments & commerce',
    caption: 'Take payments and react to commerce events in-conversation.',
    items: [
      { label: 'Stripe', Icon: StripeIcon, blurb: 'Collect deposits and payments inside a chat.' },
      { label: 'Shopify', Icon: ShopifyIcon, blurb: 'Abandoned-cart and order events trigger the agent.' },
    ],
  },
  {
    category: 'Voice & automation',
    caption: 'Human-sounding voice plus the glue to wire it all together.',
    items: [
      { label: 'Vapi', Icon: VapiIcon, blurb: 'Natural, low-latency voice for phone agents.' },
      { label: 'Zapier', Icon: ZapierIcon, blurb: 'Reach thousands more apps — no developer required.' },
      { label: 'Email', Icon: EmailIcon, blurb: 'Inbound and outbound email handled in-thread.' },
    ],
  },
]
