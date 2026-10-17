# DeviceLock AI Server

Backend para conectar **DeviceLock Tool → IA Optimización → OpenAI Responses API**.

## Funciones

- La API key de OpenAI vive únicamente en el servidor.
- `GET /health` comprueba el servicio sin llamar al modelo.
- `POST /v1/ai/verify-key` comprueba la autenticación de una clave de cliente con `GET /v1/models` de OpenAI; no genera texto y tiene timeout de 5 segundos.
- `POST /v1/ai/chat` recibe mensaje, historial y contexto del dispositivo.
- Filtra y limita el contexto aceptado.
- Incluye rate limiting básico.
- Nunca entrega la API key al APK.
- El modelo no ejecuta comandos del teléfono.

## Modelo

El valor predeterminado real del código es `gpt-5-mini`; el modelo efectivo se configura mediante `OPENAI_MODEL`. `/health` informa la configuración predeterminada y cada respuesta de chat incluye el modelo reportado por el proveedor.

## Búsqueda web y tiempos de espera

`WEB_SEARCH_ENABLED=true` activa la herramienta real `web_search` de Responses API. Si la variable no está definida, se habilita automáticamente solo para el endpoint oficial `https://api.openai.com/v1/responses`; para endpoints de terceros debe activarse explícitamente después de verificar compatibilidad. `WEB_SEARCH_ENABLED=false` la desactiva. Las respuestas de texto añaden URLs únicamente cuando el proveedor devuelve referencias reales de búsqueda. `AI_REQUEST_TIMEOUT_MS` limita la espera entre 5 y 120 segundos.

## Variables

```env
OPENAI_API_KEY=TU_CLAVE
OPENAI_MODEL=gpt-5-mini
OPENAI_RESPONSES_URL=https://api.openai.com/v1/responses
PORT=8080
APP_ACCESS_TOKEN=
WEB_SEARCH_ENABLED=true
AI_REQUEST_TIMEOUT_MS=45000
```

## Probar localmente

Requisitos: Node.js 20+.

```bash
npm install
cp .env.example .env
npm start
```

Health:

```bash
curl http://localhost:8080/health
```

Chat:

```bash
curl -X POST http://localhost:8080/v1/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hola, ¿qué puedes hacer en DeviceLock?"}'
```

Si usas `APP_ACCESS_TOKEN`:

```bash
-H "X-DeviceLock-Token: TU_TOKEN"
```

## Android

Request:

```json
{
  "message": "¿Cuánto de batería tengo?",
  "history": [],
  "context": {
    "device": "HONOR ELI-NX9",
    "androidVersion": "16",
    "batteryPercent": 31,
    "charging": true,
    "refreshRateHz": 120
  }
}
```

Response:

```json
{
  "ok": true,
  "answer": "Tienes 31% de batería y el teléfono está cargando.",
  "model": "gpt-6-luna",
  "responseId": "resp_..."
}
```

## Seguridad

Nunca pongas `OPENAI_API_KEY` en:

- el APK
- MainActivity.kt
- BuildConfig
- strings.xml
- repositorios Git
- variables que terminen empaquetadas en el cliente

La clave debe existir como secreto del backend.

## Próxima fase

Streaming, conversaciones persistentes, herramientas estructuradas y acciones seguras mediante Shizuku/Root. Las acciones deben estar en una allowlist; nunca se deben ejecutar comandos shell arbitrarios enviados por el modelo.
