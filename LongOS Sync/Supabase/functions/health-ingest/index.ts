import {
  ContractError,
  canonicalPayload,
  databaseBuckets,
  parseHealthIngestRequest,
  sha256Hex,
} from "./domain.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_BODY_BYTES = 256 * 1024;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return response(405, "method_not_allowed");
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SERVICE_ROLE_KEY) {
    return response(503, "service_unavailable");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return response(415, "unsupported_media_type");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response(413, "payload_too_large");
  }

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return response(401, "authentication_required");

  const user = await authenticate(token);
  if (user.kind === "unavailable") return response(503, "auth_unavailable");
  if (user.kind === "invalid") return response(401, "authentication_required");
  if (user.kind === "anonymous") return response(403, "account_required");

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return response(400, "invalid_request");
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return response(413, "payload_too_large");
  }

  try {
    const parsed = parseHealthIngestRequest(JSON.parse(rawBody));
    const hash = await sha256Hex(canonicalPayload(parsed));
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/longos_ingest_health_step_buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        p_user_id: user.userID,
        p_request_id: parsed.requestId,
        p_installation_id: parsed.installationId,
        p_payload_sha256: hash,
        p_buckets: databaseBuckets(parsed),
      }),
    });

    const text = await rpc.text();
    if (!rpc.ok) {
      if (text.includes("REQUEST_ID_CONFLICT")) return response(409, "request_id_conflict");
      return response(503, "storage_unavailable");
    }
    const acknowledgement = JSON.parse(text);
    if (
      acknowledgement?.requestId !== parsed.requestId ||
      acknowledgement?.bucketCount !== parsed.buckets.length
    ) {
      return response(503, "invalid_acknowledgement");
    }
    return new Response(JSON.stringify(acknowledgement), { status: 200, headers });
  } catch (error) {
    if (error instanceof ContractError || error instanceof SyntaxError) {
      return response(400, error instanceof ContractError ? error.code : "invalid_request");
    }
    return response(503, "storage_unavailable");
  }
});

function bearerToken(value: string | null): string | null {
  const match = value?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

async function authenticate(token: string): Promise<
  | { kind: "authenticated"; userID: string }
  | { kind: "anonymous" | "invalid" | "unavailable" }
> {
  try {
    const result = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "apikey": PUBLISHABLE_KEY,
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-store",
      },
    });
    if (!result.ok) return { kind: "invalid" };
    const user = await result.json();
    if (!user?.id) return { kind: "invalid" };
    if (user.is_anonymous === true) return { kind: "anonymous" };
    return { kind: "authenticated", userID: user.id };
  } catch {
    return { kind: "unavailable" };
  }
}

function response(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers });
}
