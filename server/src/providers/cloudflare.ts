import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

/**
 * Cloudflare Workers AI provider.
 * API key format expected: "account_id:api_token"
 * The account_id is extracted from the key to build the URL.
 */
export class CloudflareProvider extends BaseProvider {
  readonly platform = 'cloudflare' as const;
  readonly name = 'Cloudflare Workers AI';

  private parseKey(apiKey: string): { accountId: string; token: string } {
    const sep = apiKey.indexOf(':');
    if (sep === -1) throw new Error('Cloudflare key must be in format "account_id:api_token"');
    return { accountId: apiKey.slice(0, sep), token: apiKey.slice(sep + 1) };
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const { accountId, token } = this.parseKey(apiKey);
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelId}`;

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        max_tokens: options?.max_tokens,
        temperature: options?.temperature,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errors = (err as any).errors;
      throw new Error(`Cloudflare API error ${res.status}: ${errors?.[0]?.message ?? res.statusText}`);
    }

    const data = await res.json() as any;
    const text = data.result?.response ?? '';

    return {
      id: this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      _routed_via: { platform: 'cloudflare', model: modelId },
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const { accountId, token } = this.parseKey(apiKey);
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelId}`;

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        max_tokens: options?.max_tokens,
        temperature: options?.temperature,
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Cloudflare API error ${res.status}: ${(err as any).errors?.[0]?.message ?? res.statusText}`);
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
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.response) {
            yield {
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [{ index: 0, delta: { content: parsed.response }, finish_reason: null }],
            };
          }
        } catch { /* skip */ }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const { token } = this.parseKey(apiKey);
      const res = await this.fetchWithTimeout(
        'https://api.cloudflare.com/client/v4/user/tokens/verify',
        { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
        10000,
      );
      if (!res.ok) return false;
      const data = await res.json() as any;
      return data.success === true && data.result?.status === 'active';
    } catch {
      return false;
    }
  }
}
