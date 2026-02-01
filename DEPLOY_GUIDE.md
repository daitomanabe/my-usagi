# my-usagi Deployment Guide

## Prerequisites

### 1. Cloudflare Account
- Cloudflare Workers account (free tier works)
- Workers AI enabled (for ASR and LLM)
- D1, R2, and Queues enabled

### 2. CLI Tools
```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### 3. Node.js
- Node.js 18+ recommended
- npm or pnpm

---

## Step 1: Create Cloudflare Resources

### D1 Database
```bash
# Create database
wrangler d1 create my-usagi-db

# Note the database_id from output
# Update wrangler.jsonc with the database_id
```

### R2 Bucket
```bash
# Create bucket
wrangler r2 bucket create my-usagi-audio
```

### Queue
```bash
# Create queue
wrangler queues create my-usagi-analysis
```

---

## Step 2: Update Configuration

### wrangler.jsonc
Update the following fields with your actual resource IDs:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-usagi-db",
      "database_id": "YOUR_DATABASE_ID_HERE",  // <-- Update this
      "preview_database_id": "YOUR_PREVIEW_DB_ID",  // <-- Update this
      "migrations_dir": "migrations"
    }
  ]
}
```

---

## Step 3: Apply D1 Migrations

### Local (Development)
```bash
wrangler d1 migrations apply my-usagi-db --local
```

### Production
```bash
wrangler d1 migrations apply my-usagi-db
```

This creates the following tables:
- `sessions` - Conversation sessions
- `conversation_turns` - Individual conversation exchanges
- `vocabulary` - Word tracking
- `highlights` - Notable moments
- `analysis_jobs` - Async processing jobs

---

## Step 4: Set Secrets

### PARENT_PIN (Required)
```bash
wrangler secret put PARENT_PIN
# Enter a secure PIN for parent dashboard access
```

### ANTHROPIC_API_KEY (Optional - for fallback LLM)
```bash
wrangler secret put ANTHROPIC_API_KEY
# Enter your Anthropic API key
```

---

## Step 5: Local Development

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
wrangler dev
```

Open http://localhost:8787 in your browser.

### Test Checklist
- [ ] Session initialization (page load)
- [ ] Audio recording (click "しゃべる")
- [ ] Speech recognition (Whisper ASR)
- [ ] Rabbit response (Llama LLM)
- [ ] Parent dashboard (/parent/)
- [ ] Offline indicator (toggle network in DevTools)

---

## Step 6: Deploy to Production

### Deploy
```bash
npm run deploy
# or
wrangler deploy
```

### Verify Deployment
```bash
# Health check
curl https://my-usagi.YOUR_SUBDOMAIN.workers.dev/api/health

# Expected response:
# {"status":"ok","services":{"d1":"ok","r2":"ok","queues":"ok"}}
```

---

## Post-Deployment

### Custom Domain (Optional)
1. Go to Cloudflare Dashboard > Workers & Pages
2. Select your worker
3. Settings > Domains & Routes
4. Add custom domain

### Monitor Usage
- Workers Analytics: Dashboard > Workers & Pages > Analytics
- D1 Metrics: Dashboard > D1 > Your database > Metrics
- R2 Usage: Dashboard > R2 > Your bucket

---

## Troubleshooting

### "AI binding not available"
- Ensure Workers AI is enabled in your Cloudflare account
- Check wrangler.jsonc has `"ai": { "binding": "AI" }`

### "D1 database not found"
- Verify database_id in wrangler.jsonc matches your actual D1 database
- Run migrations: `wrangler d1 migrations apply my-usagi-db`

### "R2 bucket not found"
- Verify bucket_name in wrangler.jsonc matches your actual R2 bucket

### "Queue not found"
- Create queue: `wrangler queues create my-usagi-analysis`

### "PARENT_PIN not configured"
- Set secret: `wrangler secret put PARENT_PIN`

### Offline Issues
- Clear service worker: DevTools > Application > Service Workers > Unregister
- Clear cache: DevTools > Application > Storage > Clear site data

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Router    │───▶│   D1 DB     │    │  R2 Bucket  │     │
│  │  (API)      │    │ (sessions,  │    │  (audio)    │     │
│  └─────────────┘    │  vocab...)  │    └─────────────┘     │
│         │           └─────────────┘                         │
│         ▼                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  Durable    │───▶│ Workers AI  │    │   Queue     │     │
│  │  Object     │    │ (Whisper,   │    │ (analysis)  │     │
│  │ (session)   │    │  Llama)     │    └─────────────┘     │
│  └─────────────┘    └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Resource Limits (Free Tier)

| Resource | Limit |
|----------|-------|
| Workers Requests | 100,000/day |
| Workers AI | 10,000 neurons/day |
| D1 Storage | 5GB |
| D1 Reads | 5M/day |
| D1 Writes | 100K/day |
| R2 Storage | 10GB |
| R2 Operations | 1M Class A, 10M Class B/month |
| Queues | 1M messages/month |

---

## Security Notes

1. **PARENT_PIN**: Use a strong, unique PIN
2. **Audio Data**: Stored in R2, not encrypted by default
3. **Session IDs**: Non-guessable ULIDs
4. **LLM Prompts**: Child-safe system prompt, but review responses
5. **Rate Limiting**: Not implemented - consider adding for production

---

## Future Enhancements

- [ ] TTS integration (Japanese voice synthesis)
- [ ] kuromoji for accurate Japanese tokenization
- [ ] PWA icons (192x192, 512x512)
- [ ] OAuth authentication for parent dashboard
- [ ] Multi-child profiles
- [ ] Vocabulary analytics dashboard

---

**Generated**: 2026-02-01
**Version**: Phase 2 Complete
