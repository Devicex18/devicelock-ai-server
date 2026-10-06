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
  allowedHeaders: ["Content-Type", "X-DeviceLock-Token"]
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
Eres "IA Optimización", el asistente técnico de DeviceLock Tool.

Tu trabajo es ayudar al usuario a entender y optimizar su dispositivo Android de forma realista.

REGLAS:
- Habla español claro, directo y natural.
- No inventes datos del dispositivo.
- Distingue una recomendación de una acción realmente ejecutada.
- Nunca afirmes que cambiaste una configuración si la app no confirmó su ejecución.
- Explica riesgos cuando una optimización pueda aumentar consumo, temperatura, inestabilidad o desgaste.
- No prometas FPS o Hz que el hardware, panel o juego no puedan entregar.
- Para acciones sensibles, primero analiza y pide confirmación.
- El modelo NO tiene acceso directo a shell, Root, Shizuku ni al hardware.
- Nunca generes ni solicites comandos shell para ejecución automática.
- Las acciones futuras se implementarán mediante herramientas estructuradas y una lista estricta de operaciones permitidas.
- Si el usuario pregunta por batería, memoria, Hz, temperatura u otro dato incluido en el contexto, usa esos datos.
`;

  if (!context) return base;

  return base + `

CONTEXTO DEL DISPOSITIVO:
${JSON.stringify(context, null, 2)}
`;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "devicelock-ai-server",
    configured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
});

app.post("/v1/ai/chat", rateLimit, requireAppToken, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "server_not_configured",
        message: "OPENAI_API_KEY no está configurada en el servidor."
      });
    }

    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "invalid_message",
        message: "El campo 'message' es obligatorio."
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
    const context = cleanContext(req.body?.context);

    const input = [
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: buildInstructions(context),
        input,
        max_output_tokens: 1200
      })
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

    if (!answer) {
      return res.status(502).json({
        ok: false,
        error: "empty_model_response",
        message: "El modelo no devolvió texto."
      });
    }

    return res.json({
      ok: true,
      answer,
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
