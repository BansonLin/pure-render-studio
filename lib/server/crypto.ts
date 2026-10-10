import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * 後台金鑰加密（AES-256-GCM）。金鑰由 AUTH_SECRET 衍生：儲存區即使外流也讀不到 API 金鑰。
 * 代價：換 AUTH_SECRET 後舊金鑰無法解密，需在設定頁重新輸入。
 */
function key(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("伺服器未設定 AUTH_SECRET，無法加密金鑰。");
  return Buffer.from(hkdfSync("sha256", s, "pure-render-studio", "company-settings-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptSecret(token: string): string {
  if (!token.startsWith("v1.")) throw new Error("金鑰格式不符");
  const raw = Buffer.from(token.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
