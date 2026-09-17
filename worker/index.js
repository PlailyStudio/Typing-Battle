import { PROTOCOL, MAX_MESSAGE_BYTES } from '../shared/protocol.js';
export { BattleRoom } from './room.js';

const json = (data, status = 200) => Response.json(data, { status });
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function identity(token, tab) {
  if (!/^[a-f0-9]{64}$/.test(token || '') || !/^[a-f0-9-]{36}$/.test(tab || '')) throw Error('게스트 인증 정보가 올바르지 않습니다.');
  return { userId: await digest(token), playerId: await digest(`${token}:${tab}`) };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (origin && !allowed.includes(origin)) return json({ error: '허용되지 않은 사이트입니다.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin || allowed[0] || '', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tab-Id',
      'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      const url = new URL(request.url);
      if (url.pathname === '/healthcheck') response = json({ ok: true, protocol: PROTOCOL });
      else {
        const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
        const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
        if (upgrade && !protocols.includes(PROTOCOL)) throw Error('게임을 새로고침해주세요.');
        const token = upgrade ? protocols.find(p => p.startsWith('guest.'))?.slice(6) : request.headers.get('Authorization')?.replace(/^Bearer /, '');
        const tab = upgrade ? protocols.find(p => p.startsWith('tab.'))?.slice(4) : request.headers.get('X-Tab-Id');
        const who = await identity(token, tab);
        if (url.pathname === '/rooms' && request.method === 'POST') {
          if (Number(request.headers.get('Content-Length')) > MAX_MESSAGE_BYTES) throw Error('요청이 너무 큽니다.');
          // Bound the body even when Content-Length is absent.
          const reader = request.body?.getReader(); let size = 0, chunks = [];
          if (reader) while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.length;
            if (size > MAX_MESSAGE_BYTES) { await reader.cancel(); throw Error('요청이 너무 큽니다.'); }
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const params = JSON.parse(new TextDecoder().decode(bytes) || '{}');
          if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('방 설정이 올바르지 않습니다.');
          for (let attempt = 0; attempt < 10; attempt++) {
            const code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
            const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
            response = await stub.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ params, code, ...who }) }));
            if (response.status !== 409) break;
          }
        } else {
          const match = url.pathname.match(/^\/rooms\/(\d{6})(\/socket)?$/);
          if (!match || request.method !== 'GET' || (!!match[2] !== upgrade)) response = json({ error: '요청 주소를 확인해주세요.' }, 404);
          else {
            const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
            // Always replace identity headers; public callers cannot choose another user's ID.
            const headers = new Headers(request.headers);
            headers.set('X-Player-Id', who.playerId); headers.set('X-User-Id', who.userId);
            response = await stub.fetch(new Request(`https://room/${upgrade ? 'socket' : 'info'}?name=${encodeURIComponent(url.searchParams.get('name') || '')}`, { headers }));
          }
        }
      }
    } catch (error) {
      response = json({ error: error.message || '요청을 처리하지 못했습니다.' }, 400);
    }
    if (response.status === 101) return response;
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) result.headers.set(key, value);
    return result;
  },
};
