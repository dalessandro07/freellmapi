import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CerebrasProvider } from '../../providers/cerebras.js';

describe('CerebrasProvider', () => {
  let provider: CerebrasProvider;

  beforeEach(() => {
    provider = new CerebrasProvider();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('cerebras');
    expect(provider.name).toBe('Cerebras');
  });

  it('should call Cerebras API with OpenAI-compatible format', async () => {
    const mockResponse = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: 1234567890,
      model: 'qwen3-235b',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Response from Cerebras' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    };

    let capturedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url, _init) => {
      capturedUrl = url as string;
      return {
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any;
    });

    const result = await provider.chatCompletion(
      'csk_test456',
      [{ role: 'user', content: 'Hello' }],
      'qwen3-235b',
    );

    expect(capturedUrl).toContain('api.cerebras.ai');
    expect(result.choices[0].message.content).toBe('Response from Cerebras');
    expect(result._routed_via?.platform).toBe('cerebras');
    expect(result._routed_via?.model).toBe('qwen3-235b');
  });

  it('should validate key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true } as any);
    expect(await provider.validateKey('valid')).toBe(true);
  });
});
