import {
  getConstructiveEnvOptions,
  getTestEnvOptions
} from '@constructive-io/graphql-env';
import type { SmtpOptions } from '@constructive-io/graphql-types';
import { send } from '../src/index';
import { createSmtpCatcher } from './smtp-catcher';

const main = async () => {
  const testOptions = getTestEnvOptions();
  const useCatcher = testOptions.smtpUseCatcher ?? false;
  const catcher = useCatcher ? await createSmtpCatcher() : null;

  const smtpFromEnv = getConstructiveEnvOptions().smtp ?? {};

  const smtpOverrides: SmtpOptions = catcher
    ? {
        host: catcher.host,
        port: catcher.port,
        secure: false,
        tlsRejectUnauthorized: false,
        from: testOptions.smtpFrom ?? smtpFromEnv.from ?? 'no-reply@example.com'
      }
    : {};

  const to =
    testOptions.smtpTo ??
    (catcher ? 'test-recipient@example.com' : smtpFromEnv.from);
  if (!to) {
    throw new Error('Missing SMTP_TEST_TO');
  }

  const subject = testOptions.smtpSubject ?? 'SMTP postmaster test email';
  const html =
    testOptions.smtpHtml ??
    '<p>This is a test email from simple-smtp-server.</p>';
  const text =
    testOptions.smtpText ??
    'This is a test email from simple-smtp-server.';
  const from = testOptions.smtpFrom;

  const start = Date.now();

  try {
    const info = await send(
      {
        to,
        subject,
        html,
        text,
        ...(from ? { from } : {})
      },
      smtpOverrides
    );

    if (catcher) {
      const message = await catcher.waitForMessage(5000);
      // eslint-disable-next-line no-console
      console.log('[smtppostmaster] Captured test email', {
        envelope: message.envelope,
        preview: message.raw.slice(0, 200)
      });
    }

    // eslint-disable-next-line no-console
    console.log('[smtppostmaster] Sent test email', {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
      timeMs: Date.now() - start
    });
  } finally {
    if (catcher) {
      await catcher.stop();
    }
  }
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[smtppostmaster] Failed to send test email', error);
  process.exitCode = 1;
});
