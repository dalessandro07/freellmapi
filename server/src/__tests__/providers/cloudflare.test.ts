import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareProvider } from '../../providers/cloudflare.js';

describe('CloudflareProvider', () => {
  let provider: CloudflareProvider;

  beforeEach(() => {
    provider = new CloudflareProvider();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('cloudflare');
    expect(provider.name).toBe('Cloudflare Workers AI');
  });

  it('should parse account_id:token key format', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = url as string;
      capturedHeaders = (init as any).headers;
      return {
        ok: true,
        json: () => Promise.resolve({ result: { response: 'Hello from CF!' } }),
      } as any;
    });

    const result = await provider.chatCompletion(
      'abc123:my-token-here',
      [{ role: 'user', content: 'Hi' }],
      '@cf/meta/llama-3.1-70b-instruct',
    );

    expect(capturedUrl).toContain('abc123');
    expect(capturedUrl).toContain('@cf/meta/llama-3.1-70b-instruct');
    expect(capturedHeaders['Authorization']).toBe('Bearer my-token-here');
    expect(result.choices[0].message.content).toBe('Hello from CF!');
  });

  it('should throw if key format is wrong', async () => {
    await expect(
      provider.chatCompletion('no-colon-here', [{ role: 'user', content: 'Hi' }], 'model')
    ).rejects.toThrow(/account_id:api_token/);
  });
});
