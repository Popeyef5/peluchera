# Telegram alerts
import logging

from telegram import Bot

from .config import TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_CHATS, TELEGRAM_ALERTS

log = logging.getLogger(__name__)


class TelegramNotifier:
    def __init__(self, token, chats):
        self.token = token
        self.chats = chats

    def _chat_id(self, chat):
        # Prefer the requested chat; fall back to any configured one so a
        # key-name mismatch (e.g. "info" vs "regular") can't silently swallow an
        # alert.
        if self.chats.get(chat):
            return self.chats[chat]
        for cid in self.chats.values():
            if cid:
                return cid
        return None

    async def send_plain(self, text, chat="info"):
        if not TELEGRAM_ALERTS:
            return  # globally disabled via TELEGRAM_ALERTS=false
        if not self.token:
            log.info("Telegram not configured (no token) — skipping alert")
            return
        chat_id = self._chat_id(chat)
        if not chat_id:
            log.warning("Telegram has no chat configured — skipping alert")
            return
        try:
            # python-telegram-bot v20+: a bare Bot must be initialized before
            # use. The async context manager handles init/shutdown around this
            # one-off send, so we don't depend on a long-lived initialized Bot.
            async with Bot(self.token) as bot:
                await bot.send_message(chat_id=chat_id, text=text[:4096])  # 4096 = Telegram's hard limit
        except Exception:
            log.exception("Telegram send failed")


alertBot = TelegramNotifier(token=TELEGRAM_BOT_TOKEN, chats=TELEGRAM_BOT_CHATS)
