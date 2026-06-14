import { Agent } from '@agentic-kit/agent';
import { OpenAIAdapter } from '@agentic-kit/openai';
import type { Message } from 'agentic-kit';

import { tools } from '@/lib/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = [
  'You are a friendly assistant in a chat-app demo.',
  'You have two tools available:',
  '- get_current_time(timezone?): returns the current time in the requested IANA timezone.',
  '- send_email(to, subject, body): drafts an email. The user must approve before it is sent.',
  'When the user asks for the current time anywhere, call get_current_time.',
  'When the user asks you to send an email, call send_email exactly once and wait for the user decision.',
  'Keep replies short.',
].join('\n');

interface RequestBody {
  messages: Message[];
}

function lastMessageHasPendingDecision(messages: Message[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const completedToolCallIds = new Set(
    messages
      .filter((m): m is Extract<Message, { role: 'toolResult' }> => m.role === 'toolResult')
      .map((m) => m.toolCallId)
  );
  return last.content.some(
    (block) =>
      block.type === 'toolCall' &&
      !completedToolCallIds.has(block.id) &&
      'decision' in block &&
      block.decision !== undefined
  );
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  const baseUrl =
    process.env.OPENAI_BASE_URL ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const modelId = process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? 'gpt-5.4-mini';

  if (!apiKey) {
    return new Response('OPENAI_API_KEY (or LLM_API_KEY) is not set on the server', {
      status: 500,
    });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response('Empty messages', { status: 400 });
  }

  const adapter = new OpenAIAdapter({ apiKey, baseUrl });
  const model = adapter.createModel(modelId);

  const agent = new Agent({
    initialState: { model, tools, systemPrompt: SYSTEM_PROMPT },
    streamFn: (m, ctx, opts) => adapter.stream(m, ctx, opts),
    maxSteps: 5,
  });

  const isResume = lastMessageHasPendingDecision(messages);

  if (isResume) {
    agent.replaceMessages(messages);
    try {
      const handle = agent.continue();
      return handle.toResponse();
    } catch (err) {
      return new Response(`continue() failed: ${(err as Error).message}`, { status: 400 });
    }
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return new Response('Last message must be a user message when not resuming', { status: 400 });
  }

  agent.replaceMessages(messages.slice(0, -1));
  const handle = agent.prompt(last);
  return handle.toResponse();
}
