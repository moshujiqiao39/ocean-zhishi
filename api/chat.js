const ALLOWED_HOST = "api.deepseek.com";

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "*";
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST is allowed" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing user API key" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const payload = await req.json();
  const upstream = await fetch(`https://${ALLOWED_HOST}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify(payload),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
    },
  });
}

export const config = { runtime: "edge" };
