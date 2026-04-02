# Sentinel SIM SDK

Python and TypeScript clients for [Sentinel SIM](https://sentinel-sim.com) — AI agent tool routing, orchestration, and observability.

## Structure

```
python/     Python SDK (pip install sentinel-sim)
typescript/ TypeScript SDK (npm install sentinel-sim)
```

## Python

```python
from sentinel import Sentinel

client = Sentinel(
    api_key="sk_sentinel_...",
    base_url="https://api.sentinel-sim.com",
)

# Execute any tool on any provider
result = client.execute("chat", "openai", {
    "messages": [{"role": "user", "content": "Hello"}],
    "model": "gpt-4o-mini",
}, provider_credentials={"openai": "sk-..."})

# Agent chain orchestration
run = client.run(agent_id=1, payload={"task": "build a page"})
status = client.get_chain_execution(run["execution_id"])
```

## TypeScript

```typescript
import { Sentinel } from "sentinel-sim";

const client = new Sentinel({
  apiKey: "sk_sentinel_...",
  baseUrl: "https://api.sentinel-sim.com",
});

const result = await client.execute("chat", "openai", {
  messages: [{ role: "user", content: "Hello" }],
  model: "gpt-4o-mini",
}, { providerCredentials: { openai: "sk-..." } });
```

## Providers

OpenAI, Anthropic, Gemini, Mistral, Cohere, Perplexity, DeepSeek, HuggingFace, GitHub, Vercel, Railway, Stripe, Resend, Cloudflare, Pinecone, Supabase, Neon, Twilio, GoDaddy, ElevenLabs, Replicate

## Links

- [Dashboard](https://sentinel-sim.com/dashboard)
- [API Docs](https://api.sentinel-sim.com/docs)
