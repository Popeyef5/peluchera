"use client";

import { apiFetch } from "./api";

// Upload a file to the asset bucket (pack art, card images, opening videos) and
// return its public URL, which the caller stores on the inventory row.
//
// The backend signs a one-shot PUT (POST /admin/uploads, admin-only) and the
// browser sends the file straight to the bucket, so large videos never pass
// through nginx or FastAPI. The bucket's CORS rules only accept PUTs from the
// admin panel's origins.
type SignedUpload = {
  upload_url: string;
  headers: Record<string, string>;
  public_url: string;
};

export async function uploadAsset(
  file: File,
  folder: "boosters" | "cards" | "videos",
): Promise<string> {
  const contentType = file.type || guessType(file.name);
  if (!contentType) {
    throw new Error("Can't tell what kind of file this is. Use JPEG, PNG, WebP, GIF, MP4, WebM or MOV.");
  }

  const signed = await apiFetch<SignedUpload>("/admin/uploads", {
    method: "POST",
    body: JSON.stringify({ folder, content_type: contentType }),
  });

  // Send exactly the headers that were signed, or the bucket rejects the PUT.
  const res = await fetch(signed.upload_url, {
    method: "PUT",
    headers: signed.headers,
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}). Try again, or check the bucket's CORS settings.`);
  }
  return signed.public_url;
}

// Some browsers leave File.type empty for less common extensions.
function guessType(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop();
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };
  return (ext && byExt[ext]) || null;
}
