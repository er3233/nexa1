import { supabase } from "../lib/supabase";

export const AVATAR_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
export const CHAT_MEDIA_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const CHAT_MEDIA_TYPES = [
  ...IMAGE_TYPES,
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/webm",
  "audio/ogg",
  "application/pdf",
  "text/plain",
];

// Yürütülebilir / tehlikeli uzantıları kesin reddet.
const BLOCKED_EXT = [
  "exe", "bat", "cmd", "com", "sh", "msi", "scr", "js", "mjs", "cjs",
  "jar", "app", "dll", "vbs", "ps1", "apk", "deb", "rpm", "html", "htm", "svg",
];

function extOf(name) {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function sanitizeName(name) {
  const base = (name || "dosya").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-80);
}

export function validateFile(file, kind = "chat") {
  if (!file) return { ok: false, error: "Dosya seçilmedi." };
  const ext = extOf(file.name);
  if (BLOCKED_EXT.includes(ext)) return { ok: false, error: "Bu dosya türüne izin verilmiyor." };

  if (kind === "avatar") {
    if (!IMAGE_TYPES.includes(file.type)) return { ok: false, error: "Avatar yalnızca resim olabilir (jpg, png, gif, webp)." };
    if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: "Avatar en fazla 3 MB olabilir." };
  } else {
    if (file.type && !CHAT_MEDIA_TYPES.includes(file.type)) return { ok: false, error: "Bu dosya türü desteklenmiyor." };
    if (file.size > CHAT_MEDIA_MAX_BYTES) return { ok: false, error: "Dosya en fazla 25 MB olabilir." };
  }
  return { ok: true };
}

export function kindFromMime(type) {
  if (!type) return "file";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

export async function uploadAvatar(userId, file) {
  const v = validateFile(file, "avatar");
  if (!v.ok) throw new Error(v.error);
  const path = `${userId}/${Date.now()}_${sanitizeName(file.name)}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function uploadChatMedia(conversationId, file) {
  const v = validateFile(file, "chat");
  if (!v.ok) throw new Error(v.error);
  const path = `${conversationId}/${Date.now()}_${sanitizeName(file.name)}`;
  const { error } = await supabase.storage.from("chat-media").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return {
    path,
    bucket: "chat-media",
    name: file.name,
    size: file.size,
    mime: file.type,
    kind: kindFromMime(file.type),
  };
}

// chat-media private → imzalı URL (süreli)
export async function getSignedUrl(path, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteChatMedia(path) {
  const { error } = await supabase.storage.from("chat-media").remove([path]);
  if (error) throw error;
}
