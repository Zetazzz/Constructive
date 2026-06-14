import type { AgentTool } from '@agentic-kit/agent';

export const getCurrentTime: AgentTool = {
  name: 'get_current_time',
  label: 'Get current time',
  description: 'Returns the current time in the requested IANA timezone.',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone, e.g. "America/Los_Angeles". Defaults to UTC.',
      },
    },
    additionalProperties: false,
  },
  execute: async (_id, params) => {
    const timezone = (params.timezone as string | undefined) ?? 'UTC';
    let text: string;
    try {
      text = new Date().toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'short' });
    } catch (err) {
      text = `Invalid timezone "${timezone}": ${(err as Error).message}`;
    }
    return { content: [{ type: 'text', text }] };
  },
};

export const sendEmail: AgentTool = {
  name: 'send_email',
  label: 'Send email',
  description:
    'Send an email. Always requires explicit user approval before the email is actually sent.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address.' },
      subject: { type: 'string', description: 'Subject line.' },
      body: { type: 'string', description: 'Plain-text email body.' },
    },
    required: ['to', 'subject', 'body'],
    additionalProperties: false,
  },
  decision: {
    type: 'object',
    properties: {
      approved: { type: 'boolean', description: 'true if the user approved sending.' },
    },
    required: ['approved'],
    additionalProperties: false,
  },
  execute: async (_id, params, decision) => {
    const { approved } = (decision ?? {}) as { approved?: boolean };
    if (!approved) {
      return {
        content: [
          { type: 'text', text: 'User denied sending the email. The email was not sent.' },
        ],
      };
    }
    const to = params.to as string;
    const subject = params.subject as string;
    return {
      content: [
        {
          type: 'text',
          text: `Email sent to ${to} with subject "${subject}".`,
        },
      ],
    };
  },
};

export const tools: AgentTool[] = [getCurrentTime, sendEmail];
