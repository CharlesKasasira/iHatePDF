# iHatePDF API Mode

API mode exposes document automation over stable, API-key-authenticated REST endpoints.

Base URL:

```text
http://localhost:4000/api
```

Production deployments should use your public API URL, for example:

```text
https://pdf.example.com/api
```

## Authentication

Create API keys from an authenticated browser session:

```bash
curl -X POST "$API_BASE_URL/api-keys" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"local automation"}'
```

The response includes `key` once. Store it securely.

Use the key with API mode endpoints:

```bash
Authorization: Bearer ihp_...
```

or:

```bash
X-API-Key: ihp_...
```

API keys are hashed at rest and scoped to the owning user. Files, tasks, and signing workflows created with a key inherit that user ownership.

## OpenAPI

The machine-readable schema is available at:

```text
GET /api/v1/openapi.json
```

Import it into Postman, Insomnia, Stoplight, or an SDK generator to bootstrap clients. The schema describes the stable `/api/v1` automation surface and the shared task status response.

## API Key Usage Stats

The Developer page shows per-key usage totals, calls in the last 30 days, and the busiest routes. The same data is returned by:

```text
GET /api/api-keys
```

Each key includes:

```json
{
  "usage": {
    "total": 42,
    "last30Days": 18,
    "byRoute": [
      {
        "method": "POST",
        "route": "/v1/tasks/compress",
        "count": 12,
        "lastUsedAt": "2026-05-14T00:00:00.000Z"
      }
    ]
  }
}
```

## Files

Upload a source file:

```bash
curl -X POST "$API_BASE_URL/v1/files" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY" \
  -F "file=@contract.pdf" \
  -F "retentionHours=24"
```

Response:

```json
{
  "schemaVersion": "2026-05-14",
  "file": {
    "id": "clx...",
    "objectKey": "uploads/...",
    "fileName": "contract.pdf"
  }
}
```

## Tasks

Queue a task:

```bash
curl -X POST "$API_BASE_URL/v1/tasks/compress" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"clx...","outputName":"contract-compressed.pdf"}'
```

Task response schema:

```json
{
  "schemaVersion": "2026-05-14",
  "task": {
    "id": "clx...",
    "type": "compress",
    "status": "queued",
    "progress": {
      "percent": 0,
      "message": null
    },
    "result": {
      "fileId": null,
      "downloadUrl": null,
      "expiresAt": null
    },
    "error": null,
    "timestamps": {
      "createdAt": "2026-05-14T00:00:00.000Z",
      "updatedAt": "2026-05-14T00:00:00.000Z"
    }
  }
}
```

Poll status:

```bash
curl "$API_BASE_URL/v1/tasks/$TASK_ID/status" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY"
```

Queue status:

```bash
curl "$API_BASE_URL/v1/queue/status" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY"
```

Queue response schema:

```json
{
  "schemaVersion": "2026-05-14",
  "queue": {
    "name": "pdf-tasks",
    "waiting": 0,
    "active": 0,
    "delayed": 0,
    "completed": 0,
    "failed": 0,
    "paused": 0
  },
  "generatedAt": "2026-05-14T00:00:00.000Z"
}
```

Task endpoints:

- `POST /api/v1/tasks/merge`
- `POST /api/v1/tasks/split`
- `POST /api/v1/tasks/remove-pages`
- `POST /api/v1/tasks/extract-pages`
- `POST /api/v1/tasks/organize-pdf`
- `POST /api/v1/tasks/sign`
- `POST /api/v1/tasks/compress`
- `POST /api/v1/tasks/protect`
- `POST /api/v1/tasks/unlock`
- `POST /api/v1/tasks/jpg-to-pdf`
- `POST /api/v1/tasks/pdf-to-word`
- `POST /api/v1/tasks/pdf-to-jpg`
- `POST /api/v1/tasks/pdf-to-powerpoint`
- `POST /api/v1/tasks/pdf-to-excel`
- `POST /api/v1/tasks/word-to-pdf`
- `POST /api/v1/tasks/excel-to-pdf`
- `POST /api/v1/tasks/powerpoint-to-pdf`
- `POST /api/v1/tasks/edit`
- `GET /api/v1/tasks/:id`
- `GET /api/v1/tasks/:id/status`

## Signature Workflows

Create a signing workflow:

```bash
curl -X POST "$API_BASE_URL/v1/signature-requests" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "clx...",
    "requesterEmail": "sender@example.com",
    "title": "Vendor agreement",
    "outputName": "vendor-agreement-signed.pdf",
    "routing": "sequential",
    "recipients": [
      {
        "key": "signer-1",
        "email": "signer@example.com",
        "name": "Signer One",
        "routingOrder": 1
      }
    ],
    "fields": [
      {
        "recipientKey": "signer-1",
        "type": "signature",
        "page": 1,
        "x": 72,
        "y": 120,
        "width": 180,
        "height": 60
      }
    ]
  }'
```

Fetch workflow state:

```bash
curl "$API_BASE_URL/v1/signature-requests/$ENVELOPE_ID" \
  -H "Authorization: Bearer $IHATEPDF_API_KEY"
```

## Webhooks

Create a webhook endpoint from an authenticated browser session:

```bash
curl -X POST "$API_BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "url": "https://example.com/ihatepdf/webhooks",
    "events": ["task.completed", "task.failed", "signing.envelope.completed"]
  }'
```

The response includes `signingSecret` once. Use it to verify webhook signatures.

Webhook headers:

- `X-IHatePDF-Delivery`: delivery id
- `X-IHatePDF-Event`: event type
- `X-IHatePDF-Timestamp`: Unix timestamp
- `X-IHatePDF-Signature`: `v1=` plus HMAC-SHA256 of `timestamp.body`

Webhook payload:

```json
{
  "id": "evt_...",
  "type": "task.completed",
  "createdAt": "2026-05-14T00:00:00.000Z",
  "data": {
    "taskId": "clx...",
    "type": "compress",
    "status": "completed",
    "outputFileId": "clx..."
  }
}
```

Supported events:

- `task.completed`
- `task.failed`
- `signing.envelope.created`
- `signing.envelope.finalizing`
- `signing.envelope.completed`
- `signing.envelope.finalization_failed`
- `signing.envelope.revoked`
- `signing.envelope.expired`
- `signing.recipient.completed`
- `signing.recipient.reminded`
- `signing.recipient.reassigned`
- `signing.notification_sent`

Use `["*"]` to subscribe to all events.

### Delivery Logs and Retries

Webhook delivery attempts are stored with status, HTTP response code, response body excerpt, error message, attempt count, and timestamps.

List recent deliveries:

```bash
curl "$API_BASE_URL/webhooks/deliveries" \
  -b cookies.txt
```

List deliveries for one endpoint:

```bash
curl "$API_BASE_URL/webhooks/$WEBHOOK_ID/deliveries" \
  -b cookies.txt
```

Retry a delivery:

```bash
curl -X POST "$API_BASE_URL/webhooks/deliveries/$DELIVERY_ID/retry" \
  -b cookies.txt
```

Retries reuse the original payload and delivery id, increment the attempt count, and re-sign the body with the endpoint's current signing secret.

## Error Codes

| Code | Meaning | Caller action |
| --- | --- | --- |
| `400` | Invalid payload, unsupported file type, malformed page range, or missing task fields. | Fix request data and retry. |
| `401` | Missing, expired, revoked, or invalid API key. | Create or rotate the key and update the caller. |
| `404` | File, task, signature workflow, webhook endpoint, or delivery was not found for this owner. | Confirm ids belong to the authenticated user. |
| `410` | File retention window expired. | Re-upload the source file. |
| `429` | Rate limit exceeded. | Back off and retry later. |
| `500` | Unexpected processing failure. | Check task status and logs, then retry idempotently where safe. |

## SDK Examples

Node.js:

```js
const apiKey = process.env.IHATEPDF_API_KEY;
const baseUrl = process.env.IHATEPDF_API_URL ?? "http://localhost:4000/api";

const formData = new FormData();
formData.set("file", new Blob([await fs.promises.readFile("contract.pdf")]), "contract.pdf");
formData.set("retentionHours", "24");

const upload = await fetch(`${baseUrl}/v1/files`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: formData
});
```

Python:

```python
import os
import requests

base_url = os.getenv("IHATEPDF_API_URL", "http://localhost:4000/api")
headers = {"Authorization": f"Bearer {os.environ['IHATEPDF_API_KEY']}"}

with open("contract.pdf", "rb") as source:
    response = requests.post(
        f"{base_url}/v1/files",
        headers=headers,
        files={"file": source},
        data={"retentionHours": "24"},
    )
response.raise_for_status()
```
