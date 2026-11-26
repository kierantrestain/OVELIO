import { SMTPServer } from 'smtp-server';
import type { SMTPServerSession } from 'smtp-server';
import { checkRecipient, receiveSuppression } from '../src/server/audience';
import { logError, requiredEnv, secretsEqual } from '../src/server/config';
import { createRelay } from '../src/server/delivery';

const relay = createRelay();
const accounts = Object.fromEntries([
  [requiredEnv('SMTP_LISTMONK_USERNAME'), requiredEnv('SMTP_LISTMONK_PASSWORD')],
  [requiredEnv('SMTP_MAUTIC_USERNAME'), requiredEnv('SMTP_MAUTIC_PASSWORD')],
  // OVELIO's own sends; optional so an .env from before OVELIO 2.0 still starts.
  ...(process.env.SMTP_OVELIO_PASSWORD ? [[process.env.SMTP_OVELIO_USERNAME || 'console', process.env.SMTP_OVELIO_PASSWORD]] : []),
]) as Record<string, string>;
const from = requiredEnv('SMTP_FROM_EMAIL').toLowerCase();
const smtpError = (responseCode: number, message: string) => Object.assign(new Error(message), { responseCode });

async function dataRecipients(session: SMTPServerSession) {
  const addresses = session.envelope.rcptTo.map(entry => entry.address.toLowerCase());
  const results = await Promise.all(addresses.map(checkRecipient));
  return results.every(Boolean) ? addresses : null;
}

const server = new SMTPServer({
  banner: 'OVELIO email policy',
  authMethods: ['PLAIN', 'LOGIN'],
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  authOptional: false,
  size: 2 * 1024 * 1024,
  socketTimeout: 45000,
  disableReverseLookup: true,
  onAuth(auth, _session, callback) {
    const password = auth.username && Object.hasOwn(accounts, auth.username) ? accounts[auth.username] : '';
    if (!password || !auth.password || !secretsEqual(password, auth.password)) return callback(smtpError(535, 'Authentication rejected.'));
    callback(null, { user: auth.username });
  },
  onMailFrom(address, _session, callback) {
    callback(address.address.toLowerCase() === from ? null : smtpError(553, 'Sender is not approved.'));
  },
  onRcptTo(address, _session, callback) {
    void checkRecipient(address.address)
      .then(allowed => callback(allowed ? null : smtpError(550, 'Recipient has no active email consent.')))
      .catch(error => {
        logError('smtp-policy', error);
        callback(smtpError(451, 'Email policy temporarily unavailable.'));
      });
  },
  onData(stream, session, callback) {
    void (async () => {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const limit = 2 * 1024 * 1024;
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes <= limit) chunks.push(buffer);
      }
      if (bytes > limit || stream.sizeExceeded) return callback(smtpError(552, 'Message exceeds the size limit.'));
      const recipients = await dataRecipients(session);
      if (!recipients?.length) return callback(smtpError(550, 'Recipient has no active email consent.'));
      try {
        await relay.sendMail({ envelope: { from, to: recipients }, raw: Buffer.concat(chunks) });
      } catch (error) {
        const failure = error as { responseCode?: number; response?: string };
        if (recipients.length === 1 && failure.responseCode === 550 && /\b5\.1\.[01]\b/.test(failure.response ?? '')) {
          await receiveSuppression(recipients[0], 'bounce', 'Permanent recipient rejection');
          return callback(smtpError(550, 'Provider reported a permanent recipient rejection.'));
        }
        throw error;
      }
      callback(null, 'Accepted for delivery');
    })().catch(error => {
      logError('smtp-relay', error);
      callback(smtpError(451, 'Delivery temporarily unavailable.'));
    });
  },
});

server.on('error', error => {
  logError('smtp-listener', error);
  process.exit(1);
});
server.listen(Number(process.env.SMTP_GATEWAY_PORT) || 2525, '0.0.0.0', () => console.info('Email policy gateway ready.'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
