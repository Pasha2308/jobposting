import { describe, expect, it } from 'vitest';
import { FailoverAIProvider } from '../../src/lib/ai/failover';
import { AIError, type AIProvider, type ExtractionRequest } from '../../src/lib/ai/provider';

const request: ExtractionRequest = { sourceText: 'Acme is hiring an engineer.', sourceUrl: null, submittedCompany: null, categorySlugs: [] };
const provider = (name: string, result: () => Promise<unknown>): AIProvider => ({ name, extract: result });

describe('FailoverAIProvider', () => {
  it('rotates to the next credential after quota exhaustion', async () => {
    const pool = new FailoverAIProvider([
      provider('first', async () => { throw new AIError('quota', 'limited', true); }),
      provider('second', async () => ({ ok: true })),
    ]);
    await expect(pool.extract(request)).resolves.toEqual({ ok: true });
  });

  it('does not hide authentication errors by trying other accounts', async () => {
    let secondCalled = false;
    const pool = new FailoverAIProvider([
      provider('first', async () => { throw new AIError('auth', 'bad key', false); }),
      provider('second', async () => { secondCalled = true; return {}; }),
    ]);
    await expect(pool.extract(request)).rejects.toMatchObject({ kind: 'auth' });
    expect(secondCalled).toBe(false);
  });
});
