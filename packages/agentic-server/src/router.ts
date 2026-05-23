/**
 * router — Express router for the agentic-server
 *
 * Provides REST endpoints for AI agent conversations:
 *
 *   POST /v1/threads                             → create thread
 *   POST /v1/threads/:thread_id/messages         → send message + stream response
 *   POST /v1/orgs/:entity_id/threads             → create thread (entity-scoped)
 *   POST /v1/orgs/:entity_id/threads/:thread_id/messages → send message (entity-scoped)
 *   POST /v1/embed                               → generate embedding
 *
 * All routes require `req.constructive` (from @constructive-io/express-context).
 * Billing (check_quota + record_usage) and inference logging are automatic
 * when the billing/inference_log modules are provisioned.
 */

import express, { Router, Request, Response } from 'express';
import { Logger } from '@pgpmjs/logger';
import { OllamaAdapter } from '@agentic-kit/ollama';

import { checkQuota, logInference, recordUsage } from './billing';
import type { InferenceLogEntry } from './billing';
import { getAgentDiscovery, getDatabaseConfig } from './discovery';
import type { AgentDiscovery, BillingConfig, InferenceLogConfig } from './discovery';
import { getEnvOptions } from './env';

const log = new Logger('agentic-server');

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThreadRow {
  id: string;
  mode: string;
  model: string | null;
  system_prompt: string | null;
  status: string;
}

interface MessageRow {
  id: string;
  author_role: string;
  parts: any;
  created_at: string;
}

interface CreateThreadBody {
  mode?: string;
  model?: string;
  system_prompt?: string;
  title?: string;
}

interface SendMessageBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  temperature?: number;
  stream?: boolean;
}

interface EmbedBody {
  input: string | string[];
  model?: string;
}

interface UsageResult {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveOllamaAdapter(): { adapter: OllamaAdapter; model: string; baseUrl: string } | null {
  const { chat } = getEnvOptions();
  if (chat.provider === 'ollama') {
    return {
      adapter: new OllamaAdapter(chat.baseUrl),
      model: chat.model,
      baseUrl: chat.baseUrl,
    };
  }
  return null;
}

function resolveEmbeddingAdapter(): { adapter: OllamaAdapter; model: string } | null {
  const { embedding } = getEnvOptions();
  if (embedding.provider === 'ollama') {
    return {
      adapter: new OllamaAdapter(embedding.baseUrl),
      model: embedding.model,
    };
  }
  return null;
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

async function handleCreateThread(
  req: Request,
  res: Response,
  entityId: string,
): Promise<void> {
  const ctx = req.constructive;
  if (!ctx?.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!ctx.api.dbname) {
    res.status(400).json({ error: 'Database not resolved' });
    return;
  }

  const discovery = await getAgentDiscovery(ctx.pool, ctx.api.dbname);
  if (!discovery?.thread) {
    res.status(404).json({ error: 'Agent module not provisioned for this database' });
    return;
  }

  const body: CreateThreadBody = req.body || {};
  const { thread } = discovery;

  const result = await ctx.withPgClient(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO "${thread.schemaName}"."${thread.tableName}"
       (entity_id, owner_id, mode, model, system_prompt, title)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, mode, model, system_prompt, status, created_at`,
      [
        entityId,
        ctx.userId,
        body.mode ?? 'ask',
        body.model ?? null,
        body.system_prompt ?? null,
        body.title ?? null,
      ],
    );
    return rows[0];
  });

  res.status(201).json({
    id: result.id,
    mode: result.mode,
    model: result.model,
    system_prompt: result.system_prompt,
    status: result.status,
    created_at: result.created_at,
  });
}

async function handleSendMessage(
  req: Request,
  res: Response,
  entityId: string,
): Promise<void> {
  const ctx = req.constructive;
  if (!ctx?.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!ctx.api.dbname) {
    res.status(400).json({ error: 'Database not resolved' });
    return;
  }

  const discovery = await getAgentDiscovery(ctx.pool, ctx.api.dbname);
  if (!discovery?.thread || !discovery?.message) {
    res.status(404).json({ error: 'Agent module not provisioned for this database' });
    return;
  }

  const body: SendMessageBody = req.body || {};
  if (!body.messages?.length) {
    res.status(400).json({ error: 'messages[] is required and must not be empty' });
    return;
  }

  const { thread, message: msgTable } = discovery;
  const threadId = req.params.thread_id;
  const userId = ctx.userId;

  // Verify thread exists (RLS enforced)
  const threadRow = await ctx.withPgClient(async (client) => {
    const { rows } = await client.query(
      `SELECT id, mode, model, system_prompt, status
       FROM "${thread.schemaName}"."${thread.tableName}"
       WHERE id = $1`,
      [threadId],
    );
    return rows[0] as ThreadRow | undefined;
  });

  if (!threadRow) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  // Resolve billing + inference log config
  const dbConfig = ctx.databaseId
    ? await getDatabaseConfig(ctx.pool, ctx.databaseId)
    : { billing: null, inferenceLog: null };

  const ollama = resolveOllamaAdapter();
  if (!ollama) {
    res.status(503).json({ error: 'No LLM provider configured' });
    return;
  }

  const model = body.model ?? threadRow.model ?? ollama.model;
  const meterSlug = model;

  // Quota check
  if (dbConfig.billing) {
    const allowed = await checkQuota(ctx, dbConfig.billing, entityId, meterSlug);
    if (!allowed) {
      res.status(429).json({
        error: 'Token quota exceeded',
        meter: meterSlug,
        entity_id: entityId,
      });
      return;
    }
  }

  // Persist user messages
  await ctx.withPgClient(async (client) => {
    for (const msg of body.messages) {
      if (msg.role === 'user') {
        await client.query(
          `INSERT INTO "${msgTable.schemaName}"."${msgTable.tableName}"
           (thread_id, owner_id, entity_id, author_role, parts)
           VALUES ($1, $2, (SELECT entity_id FROM "${thread.schemaName}"."${thread.tableName}" WHERE id = $1), $3, $4)`,
          [threadId, userId, 'user', JSON.stringify([{ type: 'text', text: msg.content }])],
        );
      }
    }
  });

  // Load full thread history
  const history = await ctx.withPgClient(async (client) => {
    const { rows } = await client.query(
      `SELECT author_role, parts, created_at
       FROM "${msgTable.schemaName}"."${msgTable.tableName}"
       WHERE thread_id = $1
       ORDER BY created_at ASC`,
      [threadId],
    );
    return rows as MessageRow[];
  });

  const llmMessages: Array<{ role: string; content: string }> = [];
  if (threadRow.system_prompt) {
    llmMessages.push({ role: 'system', content: threadRow.system_prompt });
  }
  for (const row of history) {
    const parts = Array.isArray(row.parts) ? row.parts : [];
    const textContent = parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('');
    if (textContent) {
      llmMessages.push({
        role: row.author_role === 'user' ? 'user' : 'assistant',
        content: textContent,
      });
    }
  }

  const startTime = Date.now();
  const shouldStream = body.stream !== false;

  if (shouldStream) {
    await handleStreamingResponse(req, res, {
      ctx, ollama, model, llmMessages, body,
      entityId, userId, threadId,
      thread, msgTable, dbConfig, startTime, meterSlug,
    });
  } else {
    await handleBatchResponse(req, res, {
      ctx, ollama, model, llmMessages, body,
      entityId, userId, threadId,
      thread, msgTable, dbConfig, startTime, meterSlug,
    });
  }
}

interface MessageContext {
  ctx: NonNullable<Request['constructive']>;
  ollama: { adapter: OllamaAdapter; model: string; baseUrl: string };
  model: string;
  llmMessages: Array<{ role: string; content: string }>;
  body: SendMessageBody;
  entityId: string;
  userId: string;
  threadId: string;
  thread: NonNullable<AgentDiscovery['thread']>;
  msgTable: NonNullable<AgentDiscovery['message']>;
  dbConfig: { billing: BillingConfig | null; inferenceLog: InferenceLogConfig | null };
  startTime: number;
  meterSlug: string;
}

async function handleStreamingResponse(
  _req: Request,
  res: Response,
  mc: MessageContext,
): Promise<void> {
  const { ctx, ollama, model, llmMessages, body, entityId, userId, threadId, thread, msgTable, dbConfig, startTime, meterSlug } = mc;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const messageId = `msg_${Date.now()}`;

  try {
    const systemMsg = llmMessages.find(m => m.role === 'system');
    const nonSystem = llmMessages.filter(m => m.role !== 'system');
    const modelDesc = ollama.adapter.createModel(model, { maxOutputTokens: undefined });
    const context = {
      systemPrompt: systemMsg?.content,
      messages: nonSystem.map((m) => ({
        role: m.role as 'user',
        content: m.content,
        timestamp: Date.now(),
      })),
    };
    const stream = ollama.adapter.stream(modelDesc, context, {
      temperature: body.temperature,
    });

    let streamedContent = '';
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        streamedContent += event.delta;
        const sseEvent = {
          id: messageId,
          choices: [{
            index: 0,
            delta: { content: event.delta, role: 'assistant' },
            finish_reason: null as string | null,
          }],
          model,
        };
        res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);
      }
    }

    const result = await stream.result();
    const content = streamedContent;
    const latencyMs = Date.now() - startTime;
    const usage: UsageResult = {
      input: result.usage.input,
      output: result.usage.output,
      reasoning: result.usage.reasoning,
      cacheRead: result.usage.cacheRead,
      cacheWrite: result.usage.cacheWrite,
      totalTokens: result.usage.totalTokens,
    };

    res.write('data: [DONE]\n\n');
    res.end();

    // Persist assistant message (fire-and-forget)
    if (content) {
      ctx.withPgClient(async (client) => {
        await client.query(
          `INSERT INTO "${msgTable.schemaName}"."${msgTable.tableName}"
           (thread_id, owner_id, entity_id, author_role, parts, model)
           VALUES ($1, $2, (SELECT entity_id FROM "${thread.schemaName}"."${thread.tableName}" WHERE id = $1), $3, $4, $5)`,
          [threadId, userId, 'assistant', JSON.stringify([{ type: 'text', text: content }]), model],
        );
      }).catch((err) => log.error('Failed to persist assistant message:', err));
    }

    // Record billing usage (fire-and-forget)
    if (dbConfig.billing && usage.totalTokens > 0) {
      recordUsage(ctx, dbConfig.billing, entityId, meterSlug, usage.totalTokens, {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        model,
        latency_ms: latencyMs,
        stream: true,
      }).catch(() => {});
    }

    // Inference log (fire-and-forget)
    if (dbConfig.inferenceLog) {
      logInference(ctx, dbConfig.inferenceLog, {
        entityId, actorId: userId, model, provider: 'ollama',
        service: 'llm', operation: 'chat',
        inputTokens: usage.input, outputTokens: usage.output,
        totalTokens: usage.totalTokens, latencyMs, status: 'ok',
      }).catch(() => {});
    }
  } catch (streamErr: any) {
    log.error('Streaming error:', streamErr);
    const errorEvent = { error: { message: streamErr.message, type: 'stream_error' } };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function handleBatchResponse(
  _req: Request,
  res: Response,
  mc: MessageContext,
): Promise<void> {
  const { ctx, ollama, model, llmMessages, body, entityId, userId, threadId, thread, msgTable, dbConfig, startTime, meterSlug } = mc;

  const systemMsg = llmMessages.find(m => m.role === 'system');
  const nonSystem = llmMessages.filter(m => m.role !== 'system');
  const modelDesc = ollama.adapter.createModel(model, { maxOutputTokens: undefined });
  const context = {
    systemPrompt: systemMsg?.content,
    messages: nonSystem.map((m) => ({
      role: m.role as 'user',
      content: m.content,
      timestamp: Date.now(),
    })),
  };
  const stream = ollama.adapter.stream(modelDesc, context, {
    temperature: body.temperature,
  });

  const result = await stream.result();
  const content = result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const latencyMs = Date.now() - startTime;
  const usage: UsageResult = {
    input: result.usage.input,
    output: result.usage.output,
    reasoning: result.usage.reasoning,
    cacheRead: result.usage.cacheRead,
    cacheWrite: result.usage.cacheWrite,
    totalTokens: result.usage.totalTokens,
  };

  // Persist assistant message
  await ctx.withPgClient(async (client) => {
    await client.query(
      `INSERT INTO "${msgTable.schemaName}"."${msgTable.tableName}"
       (thread_id, owner_id, entity_id, author_role, parts, model)
       VALUES ($1, $2, (SELECT entity_id FROM "${thread.schemaName}"."${thread.tableName}" WHERE id = $1), $3, $4, $5)`,
      [threadId, userId, 'assistant', JSON.stringify([{ type: 'text', text: content }]), model],
    );
  });

  // Record billing + inference log (fire-and-forget)
  if (dbConfig.billing && usage.totalTokens > 0) {
    recordUsage(ctx, dbConfig.billing, entityId, meterSlug, usage.totalTokens, {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead,
      cache_write_tokens: usage.cacheWrite,
      model,
      latency_ms: latencyMs,
      stream: false,
    }).catch(() => {});
  }

  if (dbConfig.inferenceLog) {
    logInference(ctx, dbConfig.inferenceLog, {
      entityId, actorId: userId, model, provider: 'ollama',
      service: 'llm', operation: 'chat',
      inputTokens: usage.input, outputTokens: usage.output,
      totalTokens: usage.totalTokens, latencyMs, status: 'ok',
    }).catch(() => {});
  }

  res.json({
    id: `msg_${Date.now()}`,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    model,
    usage: {
      prompt_tokens: usage.input,
      completion_tokens: usage.output,
      total_tokens: usage.totalTokens,
    },
  });
}

// ─── Embedding Handler ──────────────────────────────────────────────────────

async function handleEmbed(req: Request, res: Response): Promise<void> {
  const ctx = req.constructive;
  if (!ctx?.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const body: EmbedBody = req.body || {};
  if (!body.input) {
    res.status(400).json({ error: 'input is required' });
    return;
  }

  const embedder = resolveEmbeddingAdapter();
  if (!embedder) {
    res.status(503).json({ error: 'No embedding provider configured' });
    return;
  }

  const model = body.model ?? embedder.model;
  const inputs = Array.isArray(body.input) ? body.input : [body.input];

  const dbConfig = ctx.databaseId
    ? await getDatabaseConfig(ctx.pool, ctx.databaseId)
    : { billing: null, inferenceLog: null };

  // Quota check
  if (dbConfig.billing) {
    const allowed = await checkQuota(ctx, dbConfig.billing, ctx.userId, model);
    if (!allowed) {
      res.status(429).json({ error: 'Embedding quota exceeded', meter: model });
      return;
    }
  }

  const startTime = Date.now();

  try {
    const results = await Promise.all(
      inputs.map((text) => embedder.adapter.embed(text, model)),
    );

    const latencyMs = Date.now() - startTime;
    const totalTokens = results.reduce((sum, r) => sum + r.promptTokens, 0);

    // Record usage (fire-and-forget)
    if (dbConfig.billing && totalTokens > 0) {
      recordUsage(ctx, dbConfig.billing, ctx.userId, model, totalTokens, {
        input_tokens: totalTokens,
        model,
        latency_ms: latencyMs,
        batch_size: inputs.length,
      }).catch(() => {});
    }

    if (dbConfig.inferenceLog) {
      logInference(ctx, dbConfig.inferenceLog, {
        entityId: ctx.userId,
        actorId: ctx.userId,
        model,
        provider: 'ollama',
        service: 'embedding',
        operation: 'embed',
        inputTokens: totalTokens,
        outputTokens: 0,
        totalTokens,
        latencyMs,
        status: 'ok',
      }).catch(() => {});
    }

    res.json({
      object: 'list',
      data: results.map((r, i) => ({
        object: 'embedding',
        index: i,
        embedding: r.embedding,
      })),
      model,
      usage: {
        prompt_tokens: totalTokens,
        total_tokens: totalTokens,
      },
    });
  } catch (err: any) {
    log.error('Embedding error:', err);
    res.status(500).json({ error: err.message ?? 'Embedding failed' });
  }
}

// ─── Router Factory ─────────────────────────────────────────────────────────

export function createAgenticRouter(): Router {
  const router = Router();

  router.use(express.json());

  // Entity-scoped routes
  router.post('/v1/orgs/:entity_id/threads', async (req: Request, res: Response) => {
    try {
      await handleCreateThread(req, res, req.params.entity_id);
    } catch (err: any) {
      log.error('Error creating thread:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/v1/orgs/:entity_id/threads/:thread_id/messages', async (req: Request, res: Response) => {
    try {
      await handleSendMessage(req, res, req.params.entity_id);
    } catch (err: any) {
      log.error('Error in messages endpoint:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Global routes (entity_id = user_id from JWT)
  router.post('/v1/threads', async (req: Request, res: Response) => {
    try {
      const userId = req.constructive?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      await handleCreateThread(req, res, userId);
    } catch (err: any) {
      log.error('Error creating thread:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/v1/threads/:thread_id/messages', async (req: Request, res: Response) => {
    try {
      const userId = req.constructive?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      await handleSendMessage(req, res, userId);
    } catch (err: any) {
      log.error('Error in messages endpoint:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Embedding endpoint
  router.post('/v1/embed', async (req: Request, res: Response) => {
    try {
      await handleEmbed(req, res);
    } catch (err: any) {
      log.error('Error in embed endpoint:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
