from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base 

from .config import DATABASE_URL


engine = create_async_engine(DATABASE_URL, echo=False, pool_size=5)
async_session = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()
