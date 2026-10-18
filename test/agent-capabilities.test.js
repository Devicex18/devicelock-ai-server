import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSourcesToAnswer,
  extractWebSearchSources,
  hasWebSearchCall,
  isWebSearchEnabled
} from "../src/agent-capabilities.js";

test("web search is enabled by default only for official OpenAI Responses endpoint", () => {
  assert.equal(isWebSearchEnabled(undefined, "https://api.openai.com/v1/responses"), true);
  assert.equal(isWebSearchEnabled(undefined, "https://example.com/v1/responses"), false);
  assert.equal(isWebSearchEnabled("true", "https://example.com/v1/responses"), true);
  assert.equal(isWebSearchEnabled("false", "https://api.openai.com/v1/responses"), false);
});

test("recognizes a real web_search_call instead of assuming the model searched", () => {
  assert.equal(hasWebSearchCall({ output: [{ type: "message" }] }), false);
  assert.equal(hasWebSearchCall({ output: [{ type: "web_search_call", action: { type: "search" } }] }), true);
  assert.equal(hasWebSearchCall(null), false);
});

test("extracts unique HTTPS source URLs and discards unsafe or malformed URLs", () => {
  const response = {
    output: [
      { type: "web_search_call", action: { sources: [
        { title: "Official docs", url: "https://docs.example.com/guide" },
        { title: "Duplicate", url: "https://docs.example.com/guide" },
        { title: "Unsafe", url: "javascript:alert(1)" },
        { title: "Bad URL", url: "not a URL" }
      ] } },
      { type: "message", content: [{ annotations: [
        { type: "url_citation", url_citation: { title: "Second source", url: "https://example.org/news" } }
      ] }] }
    ]
  };
  assert.deepEqual(extractWebSearchSources(response), [
    { title: "Official docs", url: "https://docs.example.com/guide" },
    { title: "Second source", url: "https://example.org/news" }
  ]);
});

test("appends visible source URLs only for text output with real sources", () => {
  const sources = [{ title: "Official docs", url: "https://docs.example.com/guide" }];
  assert.match(appendSourcesToAnswer("Answer", sources), /Fuentes consultadas:/);
  assert.match(appendSourcesToAnswer("Answer", sources), /https:\/\/docs\.example\.com\/guide/);
  assert.equal(appendSourcesToAnswer("Spoken answer", sources, "assistant"), "Spoken answer");
  assert.equal(appendSourcesToAnswer("Answer", []), "Answer");
});
