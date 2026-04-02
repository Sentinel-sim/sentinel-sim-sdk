# sentinel-sim

Python SDK for [Sentinel SIM](https://sentinel-sim.com) — AI agent tool routing, orchestration, and observability.

## Install

```bash
pip install sentinel-sim
```

## Quick start

```python
from sentinel import Sentinel

client = Sentinel(
    api_key="sk_sentinel_...",
    base_url="https://api.sentinel-sim.com",
)

# Any tool, any provider
result = client.execute("chat", "openai", {
    "messages": [{"role": "user", "content": "Hello"}],
    "model": "gpt-4o-mini",
}, provider_credentials={"openai": "sk-..."})

# Provider helpers
result = client.openai_chat([{"role": "user", "content": "Hello"}],
                            provider_credentials={"openai": "sk-..."})

# Agent chain orchestration
run = client.run(agent_id=1, payload={"task": "deploy a page"})
status = client.get_chain_execution(run["execution_id"])
```

## Async

```python
from sentinel import AsyncSentinel

async with AsyncSentinel(api_key="sk_sentinel_...") as client:
    result = await client.openai_chat([{"role": "user", "content": "Hi"}])
```

## HMAC signing

```python
client = Sentinel(
    api_key="sk_sentinel_...",
    base_url="https://api.sentinel-sim.com",
    hmac_secret="your-hmac-secret",  # from key creation response
)
```

## Providers

OpenAI, Anthropic, Gemini, Mistral, Cohere, Perplexity, DeepSeek, HuggingFace, GitHub, Vercel, Railway, Stripe, Resend, Cloudflare, Pinecone, Supabase, Neon, Twilio, GoDaddy, ElevenLabs, Replicate

## Links

- [Dashboard](https://sentinel-sim.com/dashboard)
- [API Docs](https://api.sentinel-sim.com/docs)
