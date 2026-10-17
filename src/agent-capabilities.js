const MAX_SOURCE_URLS = 8;

function normalizeSource(value) {
  if (!value || typeof value.url !== "string") return null;
  let url;
  try {
    url = new URL(value.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname) return null;
  const title = typeof value.title === "string"
    ? value.title.replace(/[\\r\\n\\t]+/g, " ").trim().slice(0, 180)
    : "";
  return { title: title || url.hostname, url: url.toString() };
}

export function hasWebSearchCall(response) {
  return Array.isArray(response?.output) &&
    response.output.some(item => item?.type === "web_search_call");
}

export function extractWebSearchSources(response, limit = MAX_SOURCE_URLS) {
  const sources = [];
  const seen = new Set();
  const add = candidate => {
    const source = normalizeSource(candidate);
    if (!source || seen.has(source.url) || sources.length >= limit) return;
    seen.add(source.url);
    sources.push(source);
  };

  for (const item of response?.output || []) {
    if (item?.type === "web_search_call") {
      for (const source of item?.action?.sources || []) add(source);
    }
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        if (annotation?.type === "url_citation") add(annotation.url_citation);
      }
    }
  }
  return sources;
}

export function appendSourcesToAnswer(answer, sources, mode = "device") {
  const cleanAnswer = typeof answer === "string" ? answer.trim() : "";
  if (mode === "assistant" || !Array.isArray(sources) || sources.length === 0) {
    return cleanAnswer;
  }
  const lines = sources.slice(0, MAX_SOURCE_URLS).map((source, index) =>
    `${index + 1}. ${String(source.title || source.url).replace(/[\\r\\n\\t]+/g, " ").slice(0, 180)} — ${source.url}`
  );
  return `${cleanAnswer}\\n\\nFuentes consultadas:\\n${lines.join("\\n")}`;
}

export function isWebSearchEnabled(configValue, endpoint) {
  if (typeof configValue === "string" && configValue.trim() !== "") {
    return configValue.trim().toLowerCase() === "true";
  }
  try {
    return new URL(endpoint).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}
