import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

const PORT = Number(process.env.PORT || 8080);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const APP_ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 12000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);

app.disable("x-powered-by");

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map(v => v.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-DeviceLock-Token", "X-Client-Request-Id", "X-OpenAI-Api-Key"]
}));
app.use(express.json({ limit: "256kb" }));

const buckets = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      ok: false,
      error: "rate_limit",
      message: "Demasiadas solicitudes. Intenta de nuevo en un momento."
    });
  }

  next();
}

function requireAppToken(req, res, next) {
  if (!APP_ACCESS_TOKEN) return next();

  const received = req.get("X-DeviceLock-Token");
  if (!received || received !== APP_ACCESS_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Token de aplicación inválido."
    });
  }

  next();
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item =>
      item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    )
    .slice(-20)
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, MAX_MESSAGE_CHARS)
    }));
}

function cleanContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  const allowed = [
    "device",
    "manufacturer",
    "model",
    "androidVersion",
    "sdk",
    "batteryPercent",
    "charging",
    "temperatureC",
    "thermalStatus",
    "refreshRateHz",
    "maxRefreshRateHz",
    "ramAvailableMb",
    "ramTotalMb",
    "storageFreeMb",
    "storageTotalMb",
    "screenWidthPx",
    "screenHeightPx",
    "hasShizuku",
    "hasRoot",
    "hasWirelessDebugging"
  ];

  const output = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const value = context[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        output[key] = value;
      }
    }
  }

  return output;
}

function buildInstructions(context) {
  const base = `
Eres "IA Optimización", el agente técnico de DeviceLock Tool.

OBJETIVO:
Ayuda al usuario a diagnosticar y optimizar su dispositivo Android de forma realista.
Usa las herramientas estructuradas disponibles cuando necesites datos reales o una acción permitida.

REGLAS:
- Habla español claro, directo y natural.
- No inventes datos del dispositivo.
- Distingue una recomendación de una acción realmente ejecutada.
- Nunca afirmes que cambiaste una configuración si la herramienta no confirmó su ejecución y verificación.
- Explica riesgos cuando una optimización pueda aumentar consumo, temperatura, inestabilidad o desgaste.
- No prometas FPS o Hz que el hardware, panel o juego no puedan entregar.
- Antes de cambios relevantes, la aplicación puede pedir confirmación al usuario; respeta el resultado.
- El modelo NO tiene acceso directo a shell, Root, Shizuku ni al hardware.
- Nunca generes comandos shell para ejecución automática.
- Solo usa las funciones declaradas. No inventes nombres de herramientas.
- Distingue Hz de FPS: cambiar Hz no garantiza FPS de juegos o aplicaciones.
- Después de una modificación, verifica el estado resultante y explica si fue SUCCESS, PARTIAL, CANCELLED, FAILED, NOT_SUPPORTED o PERMISSION_REQUIRED.
`;

  if (!context) return base;

  return base + `
CONTEXTO INICIAL DEL DISPOSITIVO:
${JSON.stringify(context, null, 2)}
`;
}

const TOOL_NAMES = new Set([
  "get_device_capabilities",
  "audit_device",
  "get_device_diagnostics",
  "get_display_info",
  "get_battery_info",
  "get_thermal_info",
  "get_memory_info",
  "get_storage_info",
  "get_power_info",
  "get_animation_settings",
  "get_network_info",
  "get_connection_info",
  "get_app_inventory_summary",
  "get_runtime_summary",
  "get_package_info",
  "get_package_permissions",
  "get_package_components",
  "get_package_state",
  "find_packages_by_name",
  "probe_system_commands",
  "get_shell_command_catalog",
  "get_torch_state",
  "set_torch_mode",
  "read_setting",
  "read_system_property",
  "set_preferred_refresh_rate",
  "set_animation_scale",
  "set_screen_brightness",
  "set_package_enabled",
  "open_application",
  "uninstall_package_for_user"
]);

function cleanTools(tools) {
  if (!Array.isArray(tools)) return [];

  return tools
    .filter(tool =>
      tool &&
      tool.type === "function" &&
      typeof tool.name === "string" &&
      TOOL_NAMES.has(tool.name) &&
      tool.parameters && typeof tool.parameters === "object"
    )
    .slice(0, 64)
    .map(tool => ({
      type: "function",
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description.slice(0, 1200) : "",
      strict: true,
      parameters: tool.parameters
    }));
}

function cleanToolOutputs(outputs) {
  if (!Array.isArray(outputs)) return [];

  return outputs
    .filter(item =>
      item &&
      item.type === "function_call_output" &&
      typeof item.call_id === "string" &&
      item.call_id.length > 0 &&
      typeof item.output === "string"
    )
    .slice(0, 20)
    .map(item => ({
      type: "function_call_output",
      call_id: item.call_id.slice(0, 200),
      output: item.output.slice(0, 12000)
    }));
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();

  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractToolCalls(data) {
  const calls = [];
  for (const item of data?.output || []) {
    if (item?.type !== "function_call") continue;
    if (typeof item.call_id !== "string" || typeof item.name !== "string") continue;
    calls.push({
      callId: item.call_id,
      name: item.name,
      arguments: typeof item.arguments === "string" ? item.arguments : "{}"
    });
  }
  return calls.slice(0, 20);
}

function resolveOpenAiApiKey(req) {
  const clientKey = req.get("X-OpenAI-Api-Key")?.trim();
  return clientKey || OPENAI_API_KEY || "";
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "devicelock-ai-server",
    configured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
});

// X-OpenAI-Api-Key is used only for the current HTTPS request and is never persisted by this server.
app.post("/v1/ai/chat", rateLimit, requireAppToken, async (req, res) => {
  try {
    const openAiApiKey = resolveOpenAiApiKey(req);
    if (!openAiApiKey) {
      return res.status(503).json({
        ok: false,
        error: "openai_key_required",
        message: "Se necesita una clave de OpenAI para procesar esta solicitud."
      });
    }

    const previousResponseId =
      typeof req.body?.previousResponseId === "string" && req.body.previousResponseId.trim()
        ? req.body.previousResponseId.trim()
        : null;

    const toolOutputs = cleanToolOutputs(req.body?.toolOutputs);
    const tools = cleanTools(req.body?.tools);
    const isToolTurn = Boolean(previousResponseId && toolOutputs.length);

    let input;
    let context = null;

    if (isToolTurn) {
      input = toolOutputs;
    } else {
      const message =
        typeof req.body?.message === "string"
          ? req.body.message.trim()
          : "";

      if (!message) {
        return res.status(400).json({
          ok: false,
          error: "invalid_message",
          message: "El campo 'message' es obligatorio para iniciar una conversación."
        });
      }

      if (message.length > MAX_MESSAGE_CHARS) {
        return res.status(413).json({
          ok: false,
          error: "message_too_large",
          message: `El mensaje supera el límite de ${MAX_MESSAGE_CHARS} caracteres.`
        });
      }

      const history = cleanHistory(req.body?.history);
      context = cleanContext(req.body?.context);
      input = [
        ...history,
        {
          role: "user",
          content: message
        }
      ];
    }

    const requestBody = {
      model: OPENAI_MODEL,
      instructions: buildInstructions(context),
      input,
      tools,
      tool_choice: tools.length ? "auto" : "none",
      max_output_tokens: 1200
    };

    if (previousResponseId) requestBody.previous_response_id = previousResponseId;

    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const raw = await openAiResponse.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!openAiResponse.ok) {
      console.error(
        "OpenAI error:",
        openAiResponse.status,
        data || raw.slice(0, 500)
      );

      return res.status(502).json({
        ok: false,
        error: "openai_error",
        message: data?.error?.message || "OpenAI rechazó la solicitud.",
        status: openAiResponse.status
      });
    }

    const answer = extractOutputText(data);
    const toolCalls = extractToolCalls(data);

    if (!answer && !toolCalls.length) {
      return res.status(502).json({
        ok: false,
        error: "empty_model_response",
        message: "El modelo no devolvió texto ni una acción."
      });
    }

    return res.json({
      ok: true,
      answer,
      toolCalls,
      model: data.model || OPENAI_MODEL,
      responseId: data.id || null
    });
  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "No se pudo completar la solicitud."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DeviceLock AI Server listening on port ${PORT}`);
});
