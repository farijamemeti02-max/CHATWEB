# GameTik – R2-Integration

## Deployment

- Node.js: 22.x
- Start: `npm start`
- Project check: `npm run check`

## Render environment variables

Set these in the Render service's Environment settings. Never commit secret values to GitHub:

- `R2_ENDPOINT` – the exact S3 API endpoint shown by Cloudflare R2
- `R2_BUCKET` – `gametik-media`
- `R2_ACCESS_KEY_ID` – R2 access key ID
- `R2_SECRET_ACCESS_KEY` – R2 secret access key
- `R2_REGION` – `auto`

The server uses Cloudflare R2 when all four required R2 endpoint/bucket/key variables are present. If R2 is not configured, uploads fall back to local `/uploads/` storage, which may be ephemeral on Render.

## Checks

`npm run check` validates JavaScript syntax and checks for important routes and R2 wiring. It does not replace a live upload/download test against the actual Render service and R2 bucket.

The media files are stored in R2 when configured. Other GameTik state (accounts, sessions, posts metadata, messages, etc.) is still file-backed/in-memory and is not made database-persistent by this media integration alone.
