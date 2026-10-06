# DeviceLock AI Server

Backend para conectar **DeviceLock Tool → IA Optimización → OpenAI Responses API**.

## Funciones

- La API key de OpenAI vive únicamente en el servidor.
- `GET /health` comprueba el servicio.
- `POST /v1/ai/chat` recibe mensaje, historial y contexto del dispositivo.
- Filtra y limita el contexto aceptado.
- Incluye rate limiting básico.
- Nunca entrega la API key al APK.
- El modelo no ejecuta comandos del teléfono.

## Modelo

El valor inicial es `gpt-6-luna`. Está configurado como variable de entorno para poder cambiarlo sin modificar la app.

## Variables

```env
OPENAI_API_KEY=TU_CLAVE
OPENAI_MODEL=gpt-6-luna
OPENAI_RESPONSES_URL=https://api.openai.com/v1/responses
PORT=8080
APP_ACCESS_TOKEN=
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
