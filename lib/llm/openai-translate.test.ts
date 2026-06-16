import { describe, it, expect } from 'vitest'
import { anthropicToOpenAIRequest, openAIToAnthropicResponse } from './openai-translate'
import type { LlmCreateParams } from './types'

describe('anthropicToOpenAIRequest', () => {
  it('puts the system prompt first as a system message', () => {
    const out = anthropicToOpenAIRequest(
      { max_tokens: 100, system: 'You are helpful', messages: [{ role: 'user', content: 'hi' }] },
      true,
    )
    expect(out.messages[0]).toEqual({ role: 'system', content: 'You are helpful' })
    expect(out.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(out.max_tokens).toBe(100)
  })

  it('flattens an array-of-blocks system prompt to text', () => {
    const out = anthropicToOpenAIRequest(
      { max_tokens: 50, system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }], messages: [{ role: 'user', content: 'x' }] },
      true,
    )
    expect(out.messages[0]).toEqual({ role: 'system', content: 'A\nB' })
  })

  it('maps an assistant tool_use block to tool_calls with stringified args', () => {
    const params: LlmCreateParams = {
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'book me in' },
        { role: 'assistant', content: [
          { type: 'text', text: 'Sure' },
          { type: 'tool_use', id: 'call_1', name: 'book', input: { day: 'mon' } },
        ] },
      ],
    }
    const out = anthropicToOpenAIRequest(params, true)
    const assistant = out.messages[1] as any // [user, assistant] — no system in this case
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe('Sure')
    expect(assistant.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'book', arguments: JSON.stringify({ day: 'mon' }) } },
    ])
  })

  it('maps a user tool_result block to a tool-role message', () => {
    const params: LlmCreateParams = {
      max_tokens: 100,
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'booked' }] },
      ],
    }
    const out = anthropicToOpenAIRequest(params, true)
    expect(out.messages[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'booked' })
  })

  it('includes images as image_url parts when vision is supported', () => {
    const params: LlmCreateParams = {
      max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
        { type: 'text', text: 'what is this' },
      ] }],
    }
    const out = anthropicToOpenAIRequest(params, true)
    const u = out.messages[0] as any
    expect(u.content).toEqual([
      { type: 'image_url', image_url: { url: 'https://x/y.png' } },
      { type: 'text', text: 'what is this' },
    ])
  })

  it('strips images (text only) when vision is NOT supported', () => {
    const params: LlmCreateParams = {
      max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
        { type: 'text', text: 'what is this' },
      ] }],
    }
    const out = anthropicToOpenAIRequest(params, false)
    const u = out.messages[0] as any
    expect(u.content).toBe('what is this')
  })

  it('translates tools and the three tool_choice modes', () => {
    const base: LlmCreateParams = {
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'book', description: 'book it', input_schema: { type: 'object', properties: {} } }],
    }
    const any = anthropicToOpenAIRequest({ ...base, tool_choice: { type: 'any' } }, true)
    expect(any.tools?.[0]).toEqual({ type: 'function', function: { name: 'book', description: 'book it', parameters: { type: 'object', properties: {} } } })
    expect(any.tool_choice).toBe('required')

    const forced = anthropicToOpenAIRequest({ ...base, tool_choice: { type: 'tool', name: 'book' } }, true)
    expect(forced.tool_choice).toEqual({ type: 'function', function: { name: 'book' } })

    const auto = anthropicToOpenAIRequest({ ...base, tool_choice: { type: 'auto' } }, true)
    expect(auto.tool_choice).toBe('auto')

    const none = anthropicToOpenAIRequest(base, true)
    expect(none.tool_choice).toBeUndefined()
  })
})

describe('openAIToAnthropicResponse', () => {
  it('maps a plain text completion', () => {
    const out = openAIToAnthropicResponse({
      choices: [{ message: { role: 'assistant', content: 'hello there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    })
    expect(out.content).toEqual([{ type: 'text', text: 'hello there' }])
    expect(out.stop_reason).toBe('end_turn')
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 5 })
  })

  it('maps tool_calls to tool_use blocks with parsed input', () => {
    const out = openAIToAnthropicResponse({
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [
          { id: 'call_9', type: 'function', function: { name: 'book', arguments: '{"day":"tue"}' } },
        ] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    })
    expect(out.stop_reason).toBe('tool_use')
    expect(out.content).toEqual([{ type: 'tool_use', id: 'call_9', name: 'book', input: { day: 'tue' } }])
  })

  it('keeps both text and tool_use when the model emits both', () => {
    const out = openAIToAnthropicResponse({
      choices: [{
        message: { role: 'assistant', content: 'one sec', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } },
        ] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(out.content).toEqual([
      { type: 'text', text: 'one sec' },
      { type: 'tool_use', id: 'c1', name: 'f', input: {} },
    ])
  })

  it('tolerates malformed tool-call arguments (empty object)', () => {
    const out = openAIToAnthropicResponse({
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'f', arguments: 'not json' } },
        ] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(out.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'f', input: {} }])
  })

  it('maps length finish_reason to max_tokens', () => {
    const out = openAIToAnthropicResponse({
      choices: [{ message: { role: 'assistant', content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(out.stop_reason).toBe('max_tokens')
  })
})
