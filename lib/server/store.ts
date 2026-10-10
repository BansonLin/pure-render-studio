import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

/**
 * 後台小型 JSON 儲存。
 * - 正式環境：Vercel Blob（private），以 ETag 做樂觀鎖，兩人同時寫入不會互相覆蓋
 * - 本機開發／測試：SETTINGS_STORE_DIR 指定的資料夾（不進 git）
 */
export type StoreMode = "blob" | "file" | null;

export function storeMode(): StoreMode {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.SETTINGS_STORE_DIR) return "file";
  return null;
}

interface Read<T> {
  value: T;
  etag: string | null;
}

async function readRaw(key: string): Promise<{ text: string; etag: string | null } | null> {
  const mode = storeMode();
  if (mode === "blob") {
    // 設定剛存完就要讀到新值，略過 CDN 快取
    const r = await get(key, { access: "private", useCache: false }).catch((e: Error) => {
      if (e.name === "BlobNotFoundError") return null;
      throw e;
    });
    if (!r || r.statusCode !== 200) return null;
    return { text: await new Response(r.stream).text(), etag: r.blob.etag };
  }
  if (mode === "file") {
    try {
      return { text: await fs.readFile(path.join(process.env.SETTINGS_STORE_DIR!, key), "utf8"), etag: null };
    } catch {
      return null;
    }
  }
  throw new Error("後台儲存尚未啟用（缺少 BLOB_READ_WRITE_TOKEN）。");
}

async function writeRaw(key: string, text: string, etag: string | null) {
  const mode = storeMode();
  if (mode === "blob") {
    await put(key, text, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      ...(etag ? { ifMatch: etag } : { allowOverwrite: true }),
    });
    return;
  }
  if (mode === "file") {
    const p = path.join(process.env.SETTINGS_STORE_DIR!, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, text, "utf8");
    return;
  }
  throw new Error("後台儲存尚未啟用（缺少 BLOB_READ_WRITE_TOKEN）。");
}

export async function readJson<T>(key: string, fallback: T): Promise<Read<T>> {
  const r = await readRaw(key);
  if (!r) return { value: fallback, etag: null };
  try {
    return { value: JSON.parse(r.text) as T, etag: r.etag };
  } catch {
    return { value: fallback, etag: r.etag };
  }
}

/** 讀→改→寫；寫入時若別人先改過（ETag 不符）就重讀再套一次 */
export async function updateJson<T>(key: string, fallback: T, fn: (v: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await readJson(key, fallback);
    const next = fn(structuredClone(cur.value));
    try {
      await writeRaw(key, JSON.stringify(next), cur.etag);
      return next;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) continue;
      throw e;
    }
  }
  throw new Error("後台資料同時被多人修改，請再試一次。");
}
