import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CohereProvider } from '../../providers/cohere.js';

describe('CohereProvider', () => {
  let provider: CohereProvider;

  beforeEach(() => {
    provider = new CohereProvider();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('cohere');
    expect(provider.name).toBe('Cohere');
  });

  it('should translate response to OpenAI format', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 'cohere-123',
        message: { content: [{ type: 'text', text: 'Hello from Cohere!' }] },
        finish_reason: 'COMPLETE',
        usage: { tokens: { input_tokens: 10, output_tokens: 5 } },
      }),
    } as any);

    const result = await provider.chatCompletion(
      'test-key',
      [{ role: 'user', content: 'Hi' }],
      'command-r-plus-08-2024',
    );

    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Hello from Cohere!');
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result._routed_via?.platform).toBe('cohere');
  });

  it('should validate key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true } as any);
    expect(await provider.validateKey('valid')).toBe(true);
  });
});
