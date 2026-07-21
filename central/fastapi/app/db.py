from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base 

from .config import DATABASE_URL


# Resilience against Supabase/network dropping connections ("server closed the
# connection unexpectedly" / "SSL SYSCALL error: EOF"):
#   - pool_pre_ping: liveness-check a pooled connection on checkout and reconnect
#     if it's dead, instead of failing the query.
#   - pool_recycle: drop connections older than this so they never reach a
#     server-side idle cutoff. Shortened to 5 min — Supabase's pooler and the
#     VPS<->us-east-2 path close idle connections well before 30 min.
#   - keepalives: send TCP keepalives so a NAT/middlebox on the VPS<->Supabase
#     path can't silently drop an idle connection (the likely cause here — the
#     pooler is the session pooler on :5432, so it's not a prepared-stmt issue).
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    pool_pre_ping=True,
    pool_recycle=300,   # 5 min
    connect_args={
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    },
)
async_session = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()
