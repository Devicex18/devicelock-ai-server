import test from "node:test";
import assert from "node:assert/strict";

async function loadApp(serverKey = "", moduleSuffix = "default") {
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
    return (await import(`../src/server.js?provider-errors-test=${moduleSuffix}`)).app;
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.serverKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.serverKey;
    if (previous.appToken === undefined) delete process.env.APP_ACCESS_TOKEN;
    else process.env.APP_ACCESS_TOKEN = previous.appToken;
  }
}

async function withHttpServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function withMockedFetch(status, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url;
    // Keep the test's own localhost request real and mock only the server's outbound provider call.
    if (typeof requestUrl === "string" && requestUrl.startsWith("http://127.0.0.1:")) {
      return previousFetch(input, init);
    }
    return new Response(JSON.stringify({
      error: {
        type: status === 429 ? "rate_limit_error" : status === 404 ? "invalid_request_error" : "api_error",
        code: status === 401 || status === 403 ? "invalid_api_key" : status === 429 ? "rate_limit_exceeded" : status === 404 ? "model_not_found" : "server_error",
        message: "Provider test payload must not be returned verbatim."
      }
    }), { status, headers: { "Content-Type": "application/json" } });
  };
  try { await callback(); }
  finally { globalThis.fetch = previousFetch; }
}

test("a new client API key takes precedence over the server fallback for each chat request", async () => {
  const serverKey = "sk-server-fallback-secret-never-used";
  const clientKey = "sk-client-current-key-must-win";
  const app = await loadApp(serverKey, "client-key-precedence");
  const previousFetch = globalThis.fetch;
  let authorizationSeen = null;
  globalThis.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url;
    if (typeof requestUrl === "string" && requestUrl.startsWith("http://127.0.0.1:")) {
      return previousFetch(input, init);
    }
    authorizationSeen = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify({
      id: "resp-client-key-priority",
      model: "gpt-test-model",
      output_text: "ok"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await withHttpServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/v1/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-Api-Key": clientKey
        },
        body: JSON.stringify({ message: "test", mode: "conversation" })
      });
      assert.equal(response.status, 200);
      const serialized = await response.text();
      const body = JSON.parse(serialized);
      assert.equal(body.ok, true);
      assert.equal(body.answer, "ok");
      assert.equal(body.model, "gpt-test-model");
      assert.equal(authorizationSeen, `Bearer ${clientKey}`);
      assert.notEqual(authorizationSeen, `Bearer ${serverKey}`);
      assert.equal(serialized.includes(clientKey), false);
      assert.equal(serialized.includes(serverKey), false);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

const scenarios = [
  { status: 401, error: "openai_auth_error", message: /rechazó la clave API/i },
  { status: 403, error: "openai_auth_error", message: /rechazó la clave API/i },
  { status: 429, error: "openai_rate_limit", message: /límite de uso o cuota/i },
  { status: 404, error: "openai_model_endpoint_error", message: /modelo o endpoint/i },
  { status: 503, error: "openai_provider_unavailable", message: /error temporal/i }
];

for (const scenario of scenarios) {
  test(`chat preserves provider error category for upstream HTTP ${scenario.status}`, async () => {
    const app = await loadApp();
    await withMockedFetch(scenario.status, async () => {
      await withHttpServer(app, async baseUrl => {
        const clientKey = "sk-client-secret-test-do-not-echo";
        const response = await fetch(`${baseUrl}/v1/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-OpenAI-Api-Key": clientKey
          },
          body: JSON.stringify({ message: "test", mode: "conversation" })
        });
        assert.equal(response.status, 502, "upstream failures remain identified as proxy/provider failures");
        const serialized = await response.text();
        const body = JSON.parse(serialized);
        assert.equal(body.ok, false);
        assert.equal(body.error, scenario.error);
        assert.equal(body.status, scenario.status);
        assert.match(body.message, scenario.message);
        assert.equal(serialized.includes(clientKey), false);
        assert.equal(serialized.includes("Provider test payload"), false);
      });
    });
  });
}
