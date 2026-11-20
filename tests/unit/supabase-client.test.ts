import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '../../src/lib/supabase';
import { testEnv } from '../helpers';

describe('service database client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bounds each database request with an abort signal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createServiceClient(testEnv({
      supabaseUrl: 'https://database.example',
      supabaseServiceRoleKey: 'test-service-role-key',
    }));
    expect(client).not.toBeNull();

    const result = await client!.from('companies').select('id');
    expect(result.error).toBeNull();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});
