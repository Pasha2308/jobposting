import { AIError, type AIProvider, type ExtractionRequest } from './provider';

/** Rotates free-tier credentials only for transient/quota failures. Bad input and
 * authentication failures remain visible instead of being hidden by retries. */
export class FailoverAIProvider implements AIProvider {
  readonly name: string;
  private cursor = 0;

  constructor(private readonly providers: AIProvider[]) {
    if (!providers.length) throw new Error('At least one AI provider is required.');
    this.name = providers.map((provider) => provider.name).join(' → ');
  }

  extract(request: ExtractionRequest): Promise<unknown> {
    return this.run((provider) => provider.extract(request));
  }

  listRoles(request: ExtractionRequest): Promise<string[]> {
    return this.run((provider) => provider.listRoles?.(request) ?? Promise.resolve([]));
  }

  private async run<T>(call: (provider: AIProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let offset = 0; offset < this.providers.length; offset += 1) {
      const index = (this.cursor + offset) % this.providers.length;
      try {
        const result = await call(this.providers[index]);
        this.cursor = (index + 1) % this.providers.length;
        return result;
      } catch (error) {
        last = error;
        const kind = error instanceof AIError ? error.kind : 'unavailable';
        if (!['quota', 'timeout', 'unavailable'].includes(kind)) throw error;
      }
    }
    throw last ?? new AIError('unavailable', 'All configured AI credentials are temporarily unavailable.', true);
  }
}
