"use client";

import { getSupabase } from "./supabase";

// Upload a file to the public `assets` bucket (booster faces, card images,
// opening videos) and return its public URL. Writes are gated by Supabase RLS to
// the admin allow-list emails (see the storage policy). Path is namespaced +
// time-stamped-ish to avoid collisions without needing Date.now everywhere.
export async function uploadAsset(
  file: File,
  folder: "boosters" | "cards" | "videos",
): Promise<string> {
  const supabase = getSupabase();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${folder}/${rand}.${ext}`;

  const { error } = await supabase.storage.from("assets").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("assets").getPublicUrl(path);
  return data.publicUrl;
}
