from sqlalchemy import select
from typing import AsyncGenerator

from .db import async_session
from .models import Round

async def get_session() -> AsyncGenerator:
    async with async_session() as session:
        yield session

async def ensure_first_round(session):
    if not await session.scalar(select(Round).limit(1)):
        session.add(Round(id=1))
        await session.commit()
