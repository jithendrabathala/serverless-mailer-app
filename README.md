# Serverless Mailer

A tiny, self-hostable HTTP email API. Send transactional email over your own SMTP account with a single `POST /send` request — no vendor SDK, no per-email pricing.

Built with [Hono](https://hono.dev) + [Nodemailer](https://nodemailer.com), written in TypeScript, and deployable to Vercel as a serverless function (or run anywhere Node runs).

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Deploying to Vercel](#deploying-to-vercel)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [SMTP provider notes](#smtp-provider-notes)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Features

- **One endpoint** — `POST /send` with a JSON body. HTML and/or plain text.
- **Bring your own SMTP** — Gmail, Zoho, Resend, SendGrid, Mailgun, Amazon SES, or any SMTP host.
- **Bearer token auth** — protect the endpoint with a shared secret.
- **Schema validation** — request bodies are validated with [Zod](https://zod.dev); bad input gets a `400` with field-level detail instead of a silent failure.
- **Runs two ways** — a local Node server for development, a Vercel serverless function in production, from the same `src/app.ts`.
- **Health check** — `GET /health` for uptime monitors.

## Quick start

**Prerequisites:** Node.js 20+ and [pnpm](https://pnpm.io) (`npm i -g pnpm`).

```bash
# 1. Clone and install
git clone git@github.com:jithendrabathala/serverless-mailer-app.git
cd serverless-mailer-app
pnpm install

# 2. Create your local env file
cp .env.example .env

# 3. Fill in your SMTP credentials (see Configuration below)
$EDITOR .env

# 4. Start the dev server (hot reload via tsx watch)
pnpm dev
```

The server starts on `http://localhost:3000`.

**Verify it's up:**

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"mailer"}
```

**Send your first email:**

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_api_key_here" \
  -d '{
    "to": "someone@example.com",
    "subject": "Hello from Serverless Mailer",
    "html": "<h1>It works</h1><p>Sent via SMTP.</p>"
  }'
# {"success":true,"messageId":"<...@yourdomain.com>"}
```

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` for local development; set the same variables in your Vercel project settings for production.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SMTP_HOST` | **Yes** | — | SMTP server hostname, e.g. `smtp.gmail.com`. |
| `SMTP_USER` | **Yes** | — | SMTP username (usually your full email address). |
| `SMTP_PASS` | **Yes** | — | SMTP password or app-specific password. |
| `SMTP_PORT` | No | `587` | `587` for STARTTLS, `465` for implicit TLS. |
| `SMTP_SECURE` | No | `false` | Set to the string `true` only when using port `465`. |
| `FROM_EMAIL` | No | falls back to `SMTP_USER` | Default sender, e.g. `Memory House <noreply@yourdomain.com>`. |
| `MAILER_API_KEY` | No (but see below) | — | Shared secret required in the `Authorization` header on `/send`. |
| `PORT` | No | `3000` | Local dev server port. Ignored on Vercel. |

> **⚠️ `MAILER_API_KEY` is opt-in.** If it is unset or empty, the auth middleware waves every request through and `/send` becomes an **open relay** that anyone can use to send mail from your account. Always set it in any deployed environment.

Example `.env`:

```dotenv
PORT=3000
MAILER_API_KEY=a-long-random-string

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL=Memory House <noreply@yourdomain.com>
```

Generate a decent key with:

```bash
openssl rand -hex 32
```

## API reference

### `GET /health`

No auth required. Useful for uptime checks and post-deploy smoke tests.

```json
{ "status": "ok", "service": "mailer" }
```

### `POST /send`

Sends an email. Requires `Authorization: Bearer <MAILER_API_KEY>` whenever `MAILER_API_KEY` is set.

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `to` | `string` \| `string[]` | **Yes** | Recipient email, or an array of them. Each must be a valid address. |
| `subject` | `string` | **Yes** | Non-empty subject line. |
| `html` | `string` | Conditional | HTML body. |
| `text` | `string` | Conditional | Plain-text body. |
| `from` | `string` | No | Overrides `FROM_EMAIL` for this message. |
| `replyTo` | `string` | No | Valid email address for replies. |

At least one of `html` or `text` must be present. Supplying both is fine — clients pick the best one they can render.

**Example — multiple recipients, both body types, custom reply-to**

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MAILER_API_KEY" \
  -d '{
    "to": ["alice@example.com", "bob@example.com"],
    "subject": "Weekly digest",
    "html": "<p>Your digest is ready.</p>",
    "text": "Your digest is ready.",
    "replyTo": "support@yourdomain.com"
  }'
```

**Example — from JavaScript**

```js
const res = await fetch(`${MAILER_URL}/send`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.MAILER_API_KEY}`,
  },
  body: JSON.stringify({
    to: 'someone@example.com',
    subject: 'Welcome aboard',
    html: '<p>Thanks for signing up.</p>',
  }),
});

const data = await res.json();
if (!res.ok) throw new Error(data.message ?? data.error);
```

**Responses**

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `{ "success": true, "messageId": "<...>" }` | Handed off to the SMTP server successfully. |
| `400` | `{ "error": "Validation error", "details": { ... } }` | Body failed schema validation; `details` is a Zod flattened error. |
| `401` | `{ "error": "Unauthorized: Invalid or missing API key" }` | Missing or wrong bearer token. |
| `500` | `{ "error": "Server configuration error", "message": "..." }` | `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is missing. |
| `500` | `{ "error": "Failed to send email", "message": "..." }` | SMTP rejected the message, timed out, or the connection failed. |

**Note on `200`:** a success response means your SMTP server *accepted* the message, not that it landed in the inbox. Bounces and spam filtering happen downstream — check your provider's dashboard for delivery status.

**CORS** is enabled for all origins on all routes. If you plan to call this endpoint from browser code, remember that doing so exposes your API key to anyone who opens devtools — call it from your server instead.

## Deploying to Vercel

`vercel.json` rewrites every incoming path to `api/index.ts`, which wraps the same Hono app in Vercel's Node handler. So the routes are identical to local: `/health` and `/send`.

```bash
npm i -g vercel

vercel link          # connect this directory to a Vercel project

# Add secrets (repeat for each variable, choose the environments when prompted)
vercel env add MAILER_API_KEY
vercel env add SMTP_HOST
vercel env add SMTP_USER
vercel env add SMTP_PASS
vercel env add SMTP_PORT
vercel env add SMTP_SECURE
vercel env add FROM_EMAIL

vercel deploy        # preview deployment
vercel deploy --prod # production
```

Then smoke-test the deployment:

```bash
curl https://your-project.vercel.app/health
```

To pull production env vars back into a local `.env.local`:

```bash
vercel env pull
```

### Running elsewhere

Nothing here is Vercel-specific beyond `api/index.ts`. To run it as a plain Node service (Docker, Fly, Railway, a VPS):

```bash
pnpm build          # tsc → dist/
node dist/src/index.js
```

Make sure the environment variables above are present in the process environment.

## Project structure

```
.
├── api/
│   └── index.ts        # Vercel serverless entrypoint — wraps the Hono app
├── src/
│   ├── app.ts          # The whole API: middleware, schema, routes, transporter
│   └── index.ts        # Local Node server entrypoint (@hono/node-server)
├── .env.example        # Template for local environment variables
├── vercel.json         # Rewrites all paths → /api/index
└── tsconfig.json
```

`src/app.ts` is the only file with business logic; both entrypoints import it. Add routes there and they work in both environments automatically.

Environment variables are read from either Hono's `c.env` or `process.env`, so the same code works across runtimes without changes.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the local server with hot reload (`tsx watch src/index.ts`). |
| `pnpm build` | Type-checks and compiles to `dist/` via `tsc`. |
| `pnpm test` | Placeholder — no test suite yet; exits `1`. |

## SMTP provider notes

**Gmail** — a normal account password will not work. Enable 2-Step Verification, then create an [App Password](https://myaccount.google.com/apppasswords) and use that as `SMTP_PASS`. Host `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`. Gmail rewrites the `From` header to your own address, so a custom `FROM_EMAIL` on a domain you don't own will be ignored.

**Port 465 vs 587** — these must agree. Port `465` requires `SMTP_SECURE=true`; port `587` requires `SMTP_SECURE=false` (Nodemailer upgrades to STARTTLS on its own). Mixing them produces a connection timeout rather than a clear error.

**Deliverability** — for anything beyond testing, use a domain you control and set up SPF, DKIM, and DMARC with your provider. Mail sent from a mismatched `From` address tends to land in spam.

## Troubleshooting

**`{"error":"Server configuration error"}`** — one of `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` is missing. Locally, confirm `.env` exists and you restarted `pnpm dev`. On Vercel, confirm the variables are set for the environment you deployed to and redeploy — env changes don't apply to existing deployments.

**Requests hang, then fail with a timeout** — connection, greeting, and socket timeouts are all set to 10 seconds in `src/app.ts`. A timeout usually means a wrong port/`SMTP_SECURE` combination, or the host blocking outbound SMTP.

**`535 Authentication failed`** — wrong credentials. On Gmail, this is nearly always a regular password used where an App Password is required.

**`401 Unauthorized`** — the header must be exactly `Authorization: Bearer <key>`, matching `MAILER_API_KEY` character for character. Watch for trailing whitespace or newlines when copying keys into env settings.

**`/send` works without a token** — `MAILER_API_KEY` isn't set in that environment. See the warning in [Configuration](#configuration).

**`pnpm-workspace.yaml` placeholder** — the checked-in file has `allowBuilds: esbuild: set this to true or false`, which is placeholder text rather than a boolean. `pnpm install` currently accepts it without complaint, but replace it with `esbuild: true` (or `false`) so the intent is explicit — or delete the file, since this repo isn't a multi-package workspace.

## Security notes

- Set `MAILER_API_KEY` in every deployed environment. Without it, `/send` is unauthenticated.
- Never commit `.env` — it's already in `.gitignore`, with `.env.example` explicitly allowed through.
- Don't call this API from browser code; the key would be public. Proxy through your own backend.
- There is no rate limiting. If the endpoint is reachable from the internet, consider putting it behind [Vercel's WAF / rate limiting](https://vercel.com/docs/security/vercel-waf) so a leaked key can't be used to burn through your provider's sending quota.
- Rotating the key is a matter of updating `MAILER_API_KEY` and redeploying; there is no key list or revocation mechanism.
