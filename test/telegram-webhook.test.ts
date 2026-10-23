import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { STATUS_PATH, TELEGRAM_WEBHOOK_PATH } from '../shared/paths';
import { admin } from '../src/admin/copy';
import { TELEGRAM_SECRET_HEADER } from '../worker/routes/telegram';
import { call, getStatus, setHeartbeat } from './helpers';

const SECRET = 'test-webhook-secret';
const OWNER = 42;
const telegramEnv = (overrides: Partial<Env> = {}): Env => ({
  ...env,
  TELEGRAM_BOT_TOKEN: '123456:test-bot-token',
  TELEGRAM_CHAT_ID: String(OWNER),
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  ...overrides,
});
const update = (text: string | undefined, chatId = OWNER) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: 'private' }, date: 0, ...(text === undefined ? {} : { text }) },
});
const send = (body: unknown, { secret = SECRET as string | null, env: testEnv = telegramEnv() } = {}) =>
  call(TELEGRAM_WEBHOOK_PATH, {
    method: 'POST',
    body,
    headers: secret === null ? {} : { [TELEGRAM_SECRET_HEADER]: secret },
    env: testEnv,
  });
const pausedUntil = async () =>
  (await env.DB.prepare('SELECT paused_until FROM heartbeats WHERE id = 1').first<{ paused_until: string | null }>())
    ?.paused_until ?? null;

describe('the Telegram webhook', () => {
  it('refuses a missing or wrong secret, and every request while the secret is unset', async () => {
    await setHeartbeat(30);
    const refused = [
      await send(update('/pause 3h'), { secret: null }),
      await send(update('/pause 3h'), { secret: 'wrong' }),
      await send(update('/pause 3h'), { env: telegramEnv({ TELEGRAM_WEBHOOK_SECRET: '' }) }),
      await send(update('/pause 3h'), { secret: '', env: telegramEnv({ TELEGRAM_WEBHOOK_SECRET: '' }) }),
    ];

    for (const res of refused) expect(res.status).toBe(401);
    expect(await pausedUntil()).toBeNull();
  });

  it("answers the owner's command in the response, as a sendMessage", async () => {
    const res = await send(update('/help'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      method: 'sendMessage',
      chat_id: OWNER,
      text: admin.telegram.help,
      link_preview_options: { is_disabled: true },
    });
  });

  it('says nothing to other chats, to edits and to messages without text, and changes nothing', async () => {
    await setHeartbeat(30);
    const silent = [
      await send(update('/pause 3h', 7)),
      await send({ update_id: 2, edited_message: update('/pause 3h').message }),
      await send(update(undefined)),
      await send({ update_id: 3 }),
    ];

    for (const res of silent) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
    }
    expect(await pausedUntil()).toBeNull();
  });

  it('says nothing to a body that is not an update', async () => {
    const res = await call(TELEGRAM_WEBHOOK_PATH, {
      method: 'POST',
      rawBody: '{not json',
      headers: { 'Content-Type': 'application/json', [TELEGRAM_SECRET_HEADER]: SECRET },
      env: telegramEnv(),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('shows a pause on the site at once', async () => {
    await setHeartbeat(30);
    expect((await getStatus()).monitored).toBe(true);
    // The status is now in the edge cache.
    expect((await call(STATUS_PATH)).status).toBe(200);

    expect((await send(update('/pause 3h'))).status).toBe(200);

    expect((await getStatus()).monitored).toBe(false);
  });
});
