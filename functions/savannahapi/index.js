export default async function handler(req) {
  const origin = req.headers.get('origin') || 'https://joracho.github.io';
  const allowed = origin === 'https://joracho.github.io' || origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:5500';
  const headers = {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://joracho.github.io',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method === 'GET') return new Response(JSON.stringify({ ok: true, service: 'savannahapi', stage: 'neon-staging' }), { status: 200, headers });
  return new Response(JSON.stringify({ error: 'Not implemented yet.' }), { status: 501, headers });
}
