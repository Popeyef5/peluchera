from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base 

from .config import DATABASE_URL


# pool_pre_ping: check a pooled connection is still alive on checkout and
# transparently reconnect if not. Essential against Supabase (the session pooler
# and the DB both close idle connections), otherwise a stale connection surfaces
# as "server closed the connection unexpectedly" on the next query.
# pool_recycle: proactively drop connections older than this so they never reach
# the server-side idle cutoff in the first place.
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    pool_pre_ping=True,
    pool_recycle=1800,   # 30 min
)
async_session = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()
