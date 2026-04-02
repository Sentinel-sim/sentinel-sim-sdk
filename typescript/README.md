# sentinel-sim

TypeScript SDK for [Sentinel SIM](https://sentinel-sim.com) — AI agent tool routing, orchestration, and observability.

## Install

```bash
npm install sentinel-sim
```

## Quick start

```typescript
import { Sentinel } from "sentinel-sim";

const client = new Sentinel({
  apiKey: "sk_sentinel_...",
  baseUrl: "https://api.sentinel-sim.com",
});

// Any tool, any provider
const result = await client.execute("chat", "openai", {
  messages: [{ role: "user", content: "Hello" }],
  model: "gpt-4o-mini",
}, { providerCredentials: { openai: "sk-..." } });

// Provider helpers
const chat = await client.openaiChat(
  [{ role: "user", content: "Hello" }],
  { providerCredentials: { openai: "sk-..." } }
);
```

## HMAC signing

```typescript
const client = new Sentinel({
  apiKey: "sk_sentinel_...",
  baseUrl: "https://api.sentinel-sim.com",
  hmacSecret: "your-hmac-secret",
});
```

## Providers

OpenAI, Anthropic, Gemini, Mistral, Cohere, Perplexity, DeepSeek, HuggingFace, GitHub, Vercel, Railway, Stripe, Resend, Cloudflare, Pinecone, Supabase, Neon, Twilio, GoDaddy, ElevenLabs, Replicate

## Links

- [Dashboard](https://sentinel-sim.com/dashboard)
- [API Docs](https://api.sentinel-sim.com/docs)
