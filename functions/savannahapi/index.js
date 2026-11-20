const ALLOWED_ORIGINS = new Set([
  "https://joracho.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://joracho.github.io",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

function decodeClaims(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid bearer token.");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
  return JSON.parse(atob(padded));
}

async function dataApi(path, token, options = {}) {
  const base = process.env.NEON_DATA_API_URL;
  if (!base) throw new Error("Neon Data API is not configured.");
  const response = await fetch(base.replace(/\/$/, "") + path, {
    ...options,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  return { response, data };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("origin") || "";
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "savannahapi", stage: "neon-staging", version: 2 }, 200, headers);
    }

    if (request.method !== "POST" || url.pathname !== "/profile/ensure") {
      return json({ error: "Not found." }, 404, headers);
    }

    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Sign in is required." }, 401, headers);

    try {
      const token = match[1].trim();
      const claims = decodeClaims(token);
      if (typeof claims.sub !== "string" || !/^[0-9a-f-]{36}$/i.test(claims.sub)) {
        return json({ error: "The session token is invalid." }, 401, headers);
      }

      // The Data API validates the JWT signature and applies the table's RLS policies.
      const existing = await dataApi(
        "/profiles?select=id,email,full_name,company_name,phone,role&limit=1",
        token
      );
      if (!existing.response.ok) {
        return json({ error: "Unable to verify your Savannah profile.", details: existing.data }, existing.response.status, headers);
      }
      if (Array.isArray(existing.data) && existing.data.length) {
        return json({ success: true, profile: existing.data[0], created: false }, 200, headers);
      }

      const body = await request.json().catch(() => ({}));
      const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";
      const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase().slice(0, 254) : null;
      const inserted = await dataApi("/profiles", token, {
        method: "POST",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify({
          id: claims.sub,
          email,
          full_name: fullName || null,
          role: "client"
        })
      });
      if (!inserted.response.ok) {
        // A simultaneous first request may have inserted the same profile.
        if (inserted.response.status === 409) {
          const retry = await dataApi("/profiles?select=id,email,full_name,company_name,phone,role&limit=1", token);
          if (retry.response.ok && Array.isArray(retry.data) && retry.data.length) {
            return json({ success: true, profile: retry.data[0], created: false }, 200, headers);
          }
        }
        return json({ error: "Profile could not be created. Confirm the account email is verified and try again.", details: inserted.data }, inserted.response.status, headers);
      }
      return json({ success: true, profile: Array.isArray(inserted.data) ? inserted.data[0] : inserted.data, created: true }, 201, headers);
    } catch (error) {
      console.error("profile ensure failed", error);
      return json({ error: "Unable to initialize your Savannah profile." }, 500, headers);
    }
  }
};
