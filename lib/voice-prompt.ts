/**
 * The one voice-specific tool that isn't in the canonical AGENT_TOOLS
 * catalogue: per-turn knowledge retrieval. The webhook runs vector
 * retrieval and returns the top matched chunks. Every OTHER voice tool
 * (booking, contact capture, etc.) is generated from AGENT_TOOLS via
 * buildVoiceFunctionTools — voice no longer has a parallel hardcoded set.
 *
 * The legacy per-call prompt builder (buildVoiceSystemPrompt) died with
 * the registered-assistant migration — the canonical prompt is built
 * once, at registration/sync time, by lib/voice/vapi-assistant.ts, and
 * per-call context arrives via the {{callContext}} variable slot.
 */
export const VOICE_KNOWLEDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'query_knowledge',
    description: 'Search the workspace knowledge base for information relevant to the caller\'s question. ALWAYS call this BEFORE answering any question that asks for specific facts — product details, release notes, FAQ answers, policies, pricing, anything the merchant has documented. Pass the caller\'s question restated naturally. Returns up to 5 ranked snippets; if it returns nothing, say so honestly instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The caller\'s question, restated naturally as a search query.' },
      },
      required: ['query'],
    },
  },
}

