# Telegram alerts
from telegram import Bot

from .config import TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_CHATS

class TelegramNotifier:
    def __init__(self, token, chats):
        self.bot = Bot(token=token) if token else None
        self.chats = chats

    async def send_plain(self, text, chat="info"):
        if chat not in self.chats or not self.chats[chat]:
          return
        # Telegram hard-limit is 4096 chars; trim per chat
        await self.bot.send_message(chat_id=self.chats[chat], text=text[:4096])


alertBot = TelegramNotifier(token=TELEGRAM_BOT_TOKEN, chats=TELEGRAM_BOT_CHATS)