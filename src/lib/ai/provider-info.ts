/** LLM providers for AI grouping (browser-safe: labels and defaults only). */

export type Provider = "anthropic" | "openai" | "gemini" | "openai_compatible";

export const PROVIDER_INFO: Record<
  Provider,
  { label: string; baseUrl: string | null; needsBaseUrl: boolean; defaultModel: string | null; keyHint: string; keyUrl: string | null }
> = {
  anthropic: {
    label: "Anthropic Claude",
    baseUrl: null,
    needsBaseUrl: false,
    defaultModel: "claude-opus-5-5",
    keyHint: "sk-ant-…",
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsBaseUrl: false,
    defaultModel: null,
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Google Gemini",
    // Gemini's OpenAI-compatible endpoint
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsBaseUrl: false,
    defaultModel: null,
    keyHint: "AI…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai_compatible: {
    label: "Other (OpenAI-compatible API)",
    baseUrl: null,
    needsBaseUrl: true,
    defaultModel: null,
    keyHint: "API key",
    keyUrl: null,
  },
};

/** Claude models offered before the list is loaded from the provider. */
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, lower cost)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, lowest cost)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2 (most capable, highest cost)" },
];
