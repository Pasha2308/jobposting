import type { AIProvider } from './provider';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import type { AppEnv } from '../env';
import { FailoverAIProvider } from './failover';

export type AIConfig = {
  aiProvider: 'none' | 'gemini' | 'groq';
  geminiApiKey: string | null;
  geminiApiKeys?: string[];
  geminiModel: string;
  groqApiKey: string | null;
  groqApiKeys?: string[];
  groqModel: string;
};

export function createAIProvider(env: AIConfig | AppEnv): AIProvider | null {
  if (env.aiProvider === 'groq') {
    const keys = env.groqApiKeys?.length ? env.groqApiKeys : env.groqApiKey ? [env.groqApiKey] : [];
    if (!keys.length) return null;
    const providers = keys.map((apiKey) => new GroqProvider({ apiKey, model: env.groqModel || 'openai/gpt-oss-120b', maxRetries: keys.length > 1 ? 0 : 2 }));
    return providers.length === 1 ? providers[0] : new FailoverAIProvider(providers);
  }

  if (env.aiProvider === 'gemini') {
    const keys = env.geminiApiKeys?.length ? env.geminiApiKeys : env.geminiApiKey ? [env.geminiApiKey] : [];
    if (!keys.length) return null;
    const providers = keys.map((apiKey) => new GeminiProvider({ apiKey, model: env.geminiModel || 'gemini-2.5-flash', maxRetries: keys.length > 1 ? 0 : 2 }));
    return providers.length === 1 ? providers[0] : new FailoverAIProvider(providers);
  }

  return null;
}

export * from './provider';
export { GeminiProvider } from './gemini';
export { GroqProvider } from './groq';

