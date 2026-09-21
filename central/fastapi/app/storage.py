"""Asset storage: an S3-compatible bucket (Neon Object Storage in prod).

The browser uploads directly to the bucket with a presigned PUT that this module
signs, so a multi-hundred-megabyte opening video never streams through nginx or
FastAPI. The backend only signs, and hands back the public URL to store.

Neon requires path-style addressing and SigV4, which is what the client below
is pinned to. Any other S3-compatible store (AWS, R2, MinIO) works unchanged.
"""
import secrets
from typing import Optional

from .config import (
    ASSETS_BUCKET,
    ASSETS_PUBLIC_BASE,
    ASSETS_S3_ACCESS_KEY_ID,
    ASSETS_S3_ENDPOINT,
    ASSETS_S3_REGION,
    ASSETS_S3_SECRET_ACCESS_KEY,
)

# What each admin upload slot may hold. Anything else is refused before signing.
FOLDERS = {"boosters", "cards", "videos"}
ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}
PRESIGN_TTL_SEC = 15 * 60
# Keys are never overwritten (a new upload gets a new random key), so a long
# cache is safe and keeps repeat views off the bucket's transfer allowance.
CACHE_CONTROL = "public, max-age=31536000, immutable"

_client = None


class StorageNotConfigured(RuntimeError):
    pass


def configured() -> bool:
    return bool(ASSETS_S3_ENDPOINT and ASSETS_S3_ACCESS_KEY_ID and ASSETS_S3_SECRET_ACCESS_KEY)


def client():
    global _client
    if not configured():
        raise StorageNotConfigured(
            "Asset storage is not configured: set ASSETS_S3_ENDPOINT, "
            "ASSETS_S3_ACCESS_KEY_ID and ASSETS_S3_SECRET_ACCESS_KEY."
        )
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=ASSETS_S3_ENDPOINT,
            region_name=ASSETS_S3_REGION,
            aws_access_key_id=ASSETS_S3_ACCESS_KEY_ID,
            aws_secret_access_key=ASSETS_S3_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
    return _client


def public_url(key: str) -> str:
    return f"{ASSETS_PUBLIC_BASE.rstrip('/')}/{key}"


def new_key(folder: str, content_type: str) -> str:
    return f"{folder}/{secrets.token_urlsafe(9)}.{ALLOWED_TYPES[content_type]}"


def presign_upload(folder: str, content_type: str) -> dict:
    """Signed PUT for one new object. The browser must send exactly the headers
    returned here, because they are part of the signature."""
    if folder not in FOLDERS:
        raise ValueError("Unknown upload folder.")
    if content_type not in ALLOWED_TYPES:
        raise ValueError("That file type isn't supported. Use JPEG, PNG, WebP, GIF, MP4, WebM or MOV.")
    key = new_key(folder, content_type)
    headers = {"Content-Type": content_type, "Cache-Control": CACHE_CONTROL}
    url = client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": ASSETS_BUCKET,
            "Key": key,
            "ContentType": content_type,
            "CacheControl": CACHE_CONTROL,
        },
        ExpiresIn=PRESIGN_TTL_SEC,
    )
    return {"upload_url": url, "headers": headers, "public_url": public_url(key), "key": key}


def put_object(key: str, body: bytes, content_type: Optional[str]) -> str:
    """Server-side upload, used by the one-off copy from the old storage."""
    extra = {"CacheControl": CACHE_CONTROL}
    if content_type:
        extra["ContentType"] = content_type
    client().put_object(Bucket=ASSETS_BUCKET, Key=key, Body=body, **extra)
    return public_url(key)


def apply_cors(admin_origins) -> None:
    """Public reads from anywhere (WebGL refuses cross-origin textures without an
    Access-Control-Allow-Origin header), writes only from the admin panel."""
    client().put_bucket_cors(
        Bucket=ASSETS_BUCKET,
        CORSConfiguration={
            "CORSRules": [
                {
                    "AllowedOrigins": ["*"],
                    "AllowedMethods": ["GET", "HEAD"],
                    "AllowedHeaders": ["*"],
                    "MaxAgeSeconds": 86400,
                },
                {
                    "AllowedOrigins": list(admin_origins),
                    "AllowedMethods": ["PUT"],
                    "AllowedHeaders": ["Content-Type", "Cache-Control"],
                    "MaxAgeSeconds": 3600,
                },
            ]
        },
    )
