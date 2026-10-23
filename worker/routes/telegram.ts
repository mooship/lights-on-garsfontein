import { STATUS_PATH, TELEGRAM_WEBHOOK_PATH } from '../../shared/paths';
import { refuseBadToken } from '../lib/auth';
import { safeEqual } from '../lib/crypto';
import { errors, json, readCappedText } from '../lib/http';
import { purgeEdgeCache, type RouteContext, type Routes } from '../lib/router';
import { runCommand } from '../lib/telegram-commands';

/** Telegram sends the `secret_token` given to setWebhook in this header (README, Owner alerts on Telegram). */
export const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

async function requireTelegramSecret(ctx: RouteContext): Promise<Response | null> {
  const secret = ctx.env.TELEGRAM_WEBHOOK_SECRET;
  const sent = ctx.request.headers.get(TELEGRAM_SECRET_HEADER);
  if (secret && sent !== null && (await safeEqual(sent, secret))) return null;
  return refuseBadToken(ctx);
}

/** Empty, and 200 because Telegram resends an update until it gets one. */
const nothing = () => new Response(null, { headers: { 'Cache-Control': 'no-store' } });

/**
 * Answers the owner's chat with a sendMessage in the response body, so no call back to Telegram is
 * needed. Everyone else, and anything but a text message, gets nothing, so the bot gives nothing away.
 */
async function postUpdate({ request, env, db }: RouteContext): Promise<Response> {
  const raw = await readCappedText(request);
  if (raw === null) return errors.payloadTooLarge();
  let update: { message?: { chat?: { id?: unknown }; text?: unknown } } | null = null;
  try {
    update = JSON.parse(raw);
  } catch {
    // Not JSON, so not an update: it gets nothing, like any other message the bot does not answer.
  }
  const message = update?.message;
  if (!message || String(message.chat?.id) !== env.TELEGRAM_CHAT_ID || typeof message.text !== 'string') {
    return nothing();
  }
  const { text, statusChanged } = await runCommand(message.text, db, new Date());
  if (statusChanged) await purgeEdgeCache(new URL(request.url).origin, [STATUS_PATH]);
  return json({
    method: 'sendMessage',
    chat_id: message.chat?.id,
    text,
    link_preview_options: { is_disabled: true },
  });
}

export const telegramRoutes: Routes = {
  [`POST ${TELEGRAM_WEBHOOK_PATH}`]: { handler: postUpdate, authorize: requireTelegramSecret },
};
