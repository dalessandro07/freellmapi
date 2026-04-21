import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

const API_BASE = 'https://api.cohere.com/v2';

interface CohereResponse {
  id: string;
  message?: { content?: { type: string; text: string }[] };
  finish_reason?: string;
  usage?: {
    tokens?: { input_tokens?: number; output_tokens?: number };
  };
}

export class CohereProvider extends BaseProvider {
  readonly platform = 'cohere' as const;
  readonly name = 'Cohere';

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const cohereMessages = messages.map(m => ({
      role: m.role === 'system' ? 'system' as const : m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }));

    const res = await this.fetchWithTimeout(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: cohereMessages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        p: options?.top_p,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Cohere API error ${res.status}: ${(err as any).message ?? res.statusText}`);
    }

    const data = await res.json() as CohereResponse;
    const text = data.message?.content?.[0]?.text ?? '';

    return {
      id: data.id ?? this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: data.finish_reason ?? 'stop',
      }],
      usage: {
        prompt_tokens: data.usage?.tokens?.input_tokens ?? 0,
        completion_tokens: data.usage?.tokens?.output_tokens ?? 0,
        total_tokens: (data.usage?.tokens?.input_tokens ?? 0) + (data.usage?.tokens?.output_tokens ?? 0),
      },
      _routed_via: { platform: 'cohere', model: modelId },
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const cohereMessages = messages.map(m => ({
      role: m.role === 'system' ? 'system' as const : m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }));

    const res = await this.fetchWithTimeout(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: cohereMessages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Cohere API error ${res.status}: ${(err as any).message ?? res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = this.makeId();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'content-delta') {
            const text = event.delta?.message?.content?.text ?? '';
            if (text) {
              yield {
                id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              };
            }
          } else if (event.type === 'message-end') {
            yield {
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${API_BASE}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }, 10000);
      return res.ok;
    } catch {
      return false;
    }
  }
}
