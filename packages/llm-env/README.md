# @constructive-io/llm-env

Single source of truth for all LLM-related environment variables and defaults.

## Usage

```typescript
import { getLlmEnvOptions, LLM_DEFAULTS } from '@constructive-io/llm-env';

const opts = getLlmEnvOptions();
// opts.embedding.provider  → EMBEDDER_PROVIDER  || 'ollama'
// opts.embedding.model     → EMBEDDER_MODEL     || 'nomic-embed-text'
// opts.embedding.baseUrl   → EMBEDDER_BASE_URL  || 'http://localhost:11434'
// opts.chat.provider       → CHAT_PROVIDER      || 'ollama'
// opts.chat.model          → CHAT_MODEL         || 'llama3'
// opts.chat.baseUrl        → CHAT_BASE_URL      || 'http://localhost:11434'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDER_PROVIDER` | `ollama` | Embedding provider name |
| `EMBEDDER_MODEL` | `nomic-embed-text` | Embedding model identifier |
| `EMBEDDER_BASE_URL` | `http://localhost:11434` | Embedding provider URL |
| `CHAT_PROVIDER` | `ollama` | Chat provider name |
| `CHAT_MODEL` | `llama3` | Chat model identifier |
| `CHAT_BASE_URL` | `http://localhost:11434` | Chat provider URL |
