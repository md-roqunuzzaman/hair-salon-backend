import { createHash, createHmac } from "node:crypto";

type Action = "TextModeration" | "ImageModeration";
interface Credentials { secretId?: string; secretKey?: string; region?: string }
const targets = {
  TextModeration: { service: "tms", host: "tms.tencentcloudapi.com" },
  ImageModeration: { service: "ims", host: "ims.tencentcloudapi.com" },
} as const;
export const TENCENT_MODERATION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const unavailable = () => new Error("TENCENT_MODERATION_UNAVAILABLE");
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value, "utf8").digest();

// TC3 v3 POST JSON signing, matching Tencent's documented content-type/host
// signed-header variant. Never log this object: its headers contain credentials.
export function signTencentModerationRequest(action: Action, payload: Record<string, string>, credentials: Credentials, timestamp = Math.floor(Date.now() / 1000)) {
  if (!Object.hasOwn(targets, action)) throw unavailable();
  const secretId = credentials.secretId?.trim(), secretKey = credentials.secretKey?.trim();
  const region = credentials.region || "ap-guangzhou";
  if (!secretId || !/^[A-Za-z0-9_-]{1,256}$/.test(secretId) || !secretKey ||
      !/^[a-z]+-[a-z0-9-]{1,60}$/.test(region) || !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
      !payload || typeof payload !== "object" || Array.isArray(payload)) throw unavailable();
  const { host, service } = targets[action];
  const body = JSON.stringify(payload);
  const contentType = "application/json; charset=utf-8";
  const signedHeaders = "content-type;host";
  const canonical = ["POST", "/", "", `content-type:${contentType}\nhost:${host}\n`, signedHeaders, sha(body)].join("\n");
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), scope, sha(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(`TC3${secretKey}`, date), service), "tc3_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return { url: `https://${host}/`, body, headers: {
    "Content-Type": contentType,
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "X-TC-Action": action, "X-TC-Version": "2020-12-29", "X-TC-Region": region, "X-TC-Timestamp": String(timestamp),
  } };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw unavailable();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "", complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw unavailable();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function tencentModerationRequest(action: Action, payload: Record<string, string>, credentials: Credentials): Promise<unknown> {
  const request = signTencentModerationRequest(action, payload, credentials);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, TENCENT_MODERATION_TIMEOUT_MS);
  });
  try {
    const operation = async () => {
      const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, redirect: "error", signal: controller.signal });
      const envelope = await readResponse(response);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || "Error" in envelope) throw unavailable();
      const data = (envelope as Record<string, unknown>).Response;
      if (!data || typeof data !== "object" || Array.isArray(data) || "Error" in data) throw unavailable();
      return data;
    };
    return await Promise.race([operation(), deadline]);
  } catch {
    // No raw fetch/provider error, request, response or cause crosses this boundary.
    throw unavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
