import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  TokenUsage,
} from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Translate OpenAI messages to Gemini format
function toGeminiContents(messages: ChatMessage[]) {
  const systemInstruction = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  return {
    contents,
    systemInstruction: systemInstruction
      ? { parts: [{ text: systemInstruction.content }] }
      : undefined,
  };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GoogleProvider extends BaseProvider {
  readonly platform = 'google' as const;
  readonly name = 'Google AI Studio';

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const { contents, systemInstruction } = toGeminiContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.max_tokens,
        topP: options?.top_p,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage: TokenUsage = {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    };

    return {
      id: this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: data.candidates?.[0]?.finishReason?.toLowerCase() === 'stop' ? 'stop' : 'stop',
      }],
      usage,
      _routed_via: { platform: 'google', model: modelId },
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const { contents, systemInstruction } = toGeminiContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.max_tokens,
        topP: options?.top_p,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `${API_BASE}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
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
        const raw = trimmed.slice(6);
        if (raw === '[DONE]') return;

        const chunk = JSON.parse(raw) as GeminiResponse;
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!text) continue;

        yield {
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: { content: text },
            finish_reason: null,
          }],
        };
      }
    }

    // Final chunk
    yield {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(
        `${API_BASE}/models?key=${apiKey}`,
        { method: 'GET' },
        10000,
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
