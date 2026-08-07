const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const noStoreHeaders = { "Cache-Control": "no-store", "Pragma": "no-cache" };

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return fixed(405, "method_not_allowed");
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SERVICE_ROLE_KEY) return fixed(503, "service_unavailable");
  const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/);
  if (!match) return fixed(401, "authentication_required");

  try {
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": PUBLISHABLE_KEY, "Authorization": `Bearer ${match[1]}` },
    });
    if (!auth.ok) return fixed(401, "authentication_required");
    const user = await auth.json();
    if (!user?.id) return fixed(401, "authentication_required");
    if (user.is_anonymous === true) return fixed(403, "account_required");

    const deletion = await fetch(`${SUPABASE_URL}/rest/v1/rpc/longos_delete_health_user_data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: user.id }),
    });
    if (!deletion.ok) return fixed(503, "storage_unavailable");
    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch {
    return fixed(503, "service_unavailable");
  }
});

function fixed(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...noStoreHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
