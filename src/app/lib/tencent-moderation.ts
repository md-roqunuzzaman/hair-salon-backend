import { createHash, createHmac } from "node:crypto";

type Action = "TextModeration" | "ImageModeration";
interface Credentials { secretId?: string; secretKey?: string; region?: string }
const targets = {
  TextModeration: { service: "tms", host: "tms.tencentcloudapi.com" },
  ImageModeration: { service: "ims", host: "ims.tencentcloudapi.com" },
} as const;
export const TENCENT_MODERATION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
type FailureStage = "CONFIG" | "FETCH" | "HTTP" | "BODY" | "ENVELOPE" | "PROVIDER" | "TIMEOUT";
class ModerationUnavailable extends Error {
  readonly code: string;
  constructor(readonly stage: FailureStage, readonly httpStatus?: number, readonly providerCode?: string) {
    super("TENCENT_MODERATION_UNAVAILABLE");
    this.code = `TENCENT_MODERATION_${stage}_FAILED`;
  }
}
const unavailable = (stage: FailureStage = "CONFIG", httpStatus?: number, providerCode?: string) =>
  new ModerationUnavailable(stage, httpStatus, providerCode);
// Only known, fixed error families cross the provider boundary. Never emit
// arbitrary provider strings, messages, request content or credentials.
const providerErrorFamily = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("Code" in error) || typeof error.Code !== "string") return undefined;
  const family = error.Code.split(".")[0];
  return ["AuthFailure", "UnauthorizedOperation", "InvalidParameter", "InvalidParameterValue", "MissingParameter",
    "UnknownParameter", "RequestLimitExceeded", "ResourceUnavailable", "ResourceNotFound", "FailedOperation",
    "InternalError", "UnsupportedOperation", "LimitExceeded", "RequestExpired"].includes(family) ? family : undefined;
};
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
    throw unavailable(response.ok ? "BODY" : "HTTP", response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "", complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { complete = true; break; }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw unavailable("BODY", response.status);
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function tencentModerationRequest(action: Action, payload: Record<string, string>, credentials: Credentials): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stage: FailureStage = "CONFIG";
  let httpStatus: number | undefined;
  try {
    const request = signTencentModerationRequest(action, payload, credentials);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable("TIMEOUT", httpStatus)); }, TENCENT_MODERATION_TIMEOUT_MS);
    });
    const operation = async () => {
      stage = "FETCH";
      // Workers rejects redirect:"error" before sending the request. Manual
      // mode never forwards signed credentials; readResponse rejects all 3xx.
      const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, redirect: "manual", signal: controller.signal });
      httpStatus = response.status;
      stage = "BODY";
      const envelope = await readResponse(response);
      stage = "ENVELOPE";
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw unavailable("ENVELOPE", httpStatus);
      if ("Error" in envelope) throw unavailable("PROVIDER", httpStatus, providerErrorFamily(envelope.Error));
      const data = (envelope as Record<string, unknown>).Response;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable("ENVELOPE", httpStatus);
      if ("Error" in data) throw unavailable("PROVIDER", httpStatus, providerErrorFamily(data.Error));
      return data;
    };
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    // No raw fetch/provider error, request, response or cause crosses this boundary.
    const failure = error instanceof ModerationUnavailable ? error : unavailable(stage, httpStatus);
    console.error("Tencent moderation unavailable", {
      stage: failure.stage, code: failure.code, httpStatus: failure.httpStatus, providerCode: failure.providerCode,
    });
    throw failure;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
