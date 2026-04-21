import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroqProvider } from '../../providers/groq.js';

describe('GroqProvider', () => {
  let provider: GroqProvider;

  beforeEach(() => {
    provider = new GroqProvider();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('groq');
    expect(provider.name).toBe('Groq');
  });

  it('should call Groq API with OpenAI-compatible format', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'llama-3.3-70b-versatile',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };

    let capturedHeaders: Record<string, string> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init as any).headers)
      );
      return {
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any;
    });

    const result = await provider.chatCompletion(
      'gsk_test123',
      [{ role: 'user', content: 'Hi' }],
      'llama-3.3-70b-versatile',
    );

    expect(capturedHeaders['Authorization']).toBe('Bearer gsk_test123');
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result._routed_via?.platform).toBe('groq');
  });

  it('should throw on API error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    } as any);

    await expect(
      provider.chatCompletion('bad-key', [{ role: 'user', content: 'Hi' }], 'llama-3.3-70b-versatile')
    ).rejects.toThrow(/Invalid API key/);
  });

  it('should validate key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true } as any);
    expect(await provider.validateKey('valid')).toBe(true);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false } as any);
    expect(await provider.validateKey('invalid')).toBe(false);
  });
});
