/**
 * Exact model capability records for the server-managed OpenAI Responses API model.
 * Do not broaden this list using regular expressions or name fragments. Unknown IDs fail closed.
 */
const IMAGE_INPUT_MODELS = new Set([
  "gpt-4o", "gpt-4o-mini", "gpt-4-turbo",
  "gpt-4o-2024-05-13", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20",
  "gpt-4o-mini-2024-07-18", "gpt-4-turbo-2024-04-09",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4.1-2025-04-14", "gpt-4.1-mini-2025-04-14", "gpt-4.1-nano-2025-04-14",
  "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "gpt-5-2025-08-07", "gpt-5-mini-2025-08-07", "gpt-5-nano-2025-08-07",
  "gpt-5.1", "gpt-5.1-mini", "gpt-5.1-nano",
  "gpt-5.2", "gpt-5.2-mini", "gpt-5.2-nano",
  "o3", "o4-mini"
]);

const TEXT_ONLY_MODELS = new Set([
  "gpt-oss-120b", "gpt-oss-20b",
  "gpt-3.5-turbo", "gpt-3.5-turbo-0125",
  "text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002",
  "whisper-1", "tts-1", "tts-1-hd", "moderation-latest"
]);

export function resolveModelCapabilities(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (IMAGE_INPUT_MODELS.has(id)) {
    return {
      verified: true,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      source: "teuw-verified-openai-model-registry-v1"
    };
  }
  if (TEXT_ONLY_MODELS.has(id)) {
    return {
      verified: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
      source: "teuw-verified-openai-model-registry-v1"
    };
  }
  return {
    verified: false,
    inputModalities: [],
    outputModalities: [],
    source: "unknown"
  };
}

export function supportsImageInput(modelId) {
  const capabilities = resolveModelCapabilities(modelId);
  return capabilities.verified && capabilities.inputModalities.includes("image");
}
