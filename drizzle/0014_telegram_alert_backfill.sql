-- Data only: an outage alerted before Telegram had claims of its own is not alerted on Telegram twice, and still gets its follow-up.
UPDATE `outages` SET `telegram_off_alert_at` = `off_alert_at`, `telegram_on_alert_at` = `on_alert_at` WHERE `off_alert_at` IS NOT NULL;
