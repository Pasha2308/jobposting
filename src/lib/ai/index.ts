import type { AIProvider } from './provider';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import type { AppEnv } from '../env';

export type AIConfig = {
  aiProvider: 'none' | 'gemini' | 'groq';
  geminiApiKey: string | null;
  geminiModel: string;
  groqApiKey: string | null;
  groqModel: string;
};

export function createAIProvider(env: AIConfig | AppEnv): AIProvider | null {
  if (env.aiProvider === 'groq') {
    if (!env.groqApiKey) return null;
    return new GroqProvider({ apiKey: env.groqApiKey, model: env.groqModel || 'openai/gpt-oss-120b' });
  }

  if (env.aiProvider === 'gemini') {
    if (!env.geminiApiKey) return null;
    return new GeminiProvider({ apiKey: env.geminiApiKey, model: env.geminiModel || 'gemini-2.5-flash' });
  }

  return null;
}

export * from './provider';
export { GeminiProvider } from './gemini';
export { GroqProvider } from './groq';

