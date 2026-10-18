import test from "node:test";
import assert from "node:assert/strict";

async function loadApp(serverKey, suffix) {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    serverKey: process.env.OPENAI_API_KEY,
    appToken: process.env.APP_ACCESS_TOKEN
  };
  process.env.NODE_ENV = "test";
  process.env.APP_ACCESS_TOKEN = "";
  if (serverKey) process.env.OPENAI_API_KEY = serverKey;
  else delete process.env.OPENAI_API_KEY;
  try {
    const module = await import(`../src/server.js?health-contract-test=${suffix}`);
    return module.app;
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.serverKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.serverKey;
    if (previous.appToken === undefined) delete process.env.APP_ACCESS_TOKEN;
    else process.env.APP_ACCESS_TOKEN = previous.appToken;
  }
}

async function withHttpServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("health reports a reachable service when the server-managed key is absent", async () => {
  const app = await loadApp(null, "no-server-key");
  await withHttpServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "X-OpenAI-Api-Key": "sk-client-test-value-must-not-be-echoed" }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "devicelock-ai-server");
    assert.equal(body.configured, false, "legacy field continues to describe only the server-managed key");
    assert.equal(body.serverApiKeyConfigured, false);
    assert.equal(body.acceptsClientApiKey, true);
    assert.equal(typeof body.model, "string");
    assert.equal(JSON.stringify(body).includes("sk-client-test-value-must-not-be-echoed"), false);
  });
});

test("health reports server-managed credentials without exposing their value", async () => {
  const secret = "sk-server-test-secret-must-not-be-echoed";
  const app = await loadApp(secret, "server-key-configured");
  await withHttpServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const serialized = await response.text();
    const body = JSON.parse(serialized);
    assert.equal(body.ok, true);
    assert.equal(body.configured, true);
    assert.equal(body.serverApiKeyConfigured, true);
    assert.equal(body.acceptsClientApiKey, true);
    assert.equal(serialized.includes(secret), false);
  });
});

test("chat distinguishes missing credentials from backend reachability", async () => {
  const app = await loadApp(null, "chat-with-no-credentials");
  await withHttpServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hola" })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "openai_key_required");
  });
});
