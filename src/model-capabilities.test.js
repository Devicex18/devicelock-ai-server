import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelCapabilities, supportsImageInput } from "./model-capabilities.js";

test("exact verified OpenAI vision models advertise image input", () => {
  const capabilities = resolveModelCapabilities("gpt-5-mini");
  assert.equal(capabilities.verified, true);
  assert.deepEqual(capabilities.inputModalities, ["text", "image"]);
  assert.equal(supportsImageInput("gpt-5-mini"), true);
});

test("exact verified text-only models reject images", () => {
  const capabilities = resolveModelCapabilities("gpt-oss-120b");
  assert.equal(capabilities.verified, true);
  assert.deepEqual(capabilities.inputModalities, ["text"]);
  assert.equal(supportsImageInput("gpt-oss-120b"), false);
});

test("unknown model IDs stay unknown even if their names look multimodal", () => {
  for (const model of ["gpt-6-luna", "vision-flash-special", "gpt-5-mini-custom"]) {
    const capabilities = resolveModelCapabilities(model);
    assert.equal(capabilities.verified, false, model);
    assert.deepEqual(capabilities.inputModalities, [], model);
    assert.equal(supportsImageInput(model), false, model);
  }
});

test("model identifiers are exact aside from letter case and surrounding whitespace", () => {
  assert.equal(supportsImageInput("  GPT-5-MINI  "), true);
  assert.equal(supportsImageInput("gpt-5-mini-latest-unverified"), false);
});
