import { PROTOCOL } from '../shared/protocol.js';

export function serverBase(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('멀티플레이 서버 주소를 확인해주세요.');
  return url.origin;
}

function guestToken(base) {
  // Scope the credential to the server; invite overrides never receive another server's credential.
  const key = `tb-guest:${base}`;
  let token;
  try { token = localStorage.getItem(key); } catch {}
  if (!/^[a-f0-9]{64}$/.test(token || '')) {
    token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(key, token); } catch {}
  }
  return token;
}

export async function createMultiplayer(env, override) {
  if (env.VITE_MULTIPLAYER_BACKEND === 'cloudflare' || (!env.VITE_MULTIPLAYER_BACKEND && env.VITE_MULTIPLAYER_URL)) {
    const base = serverBase(override ? `https://${override.parameter}` : env.VITE_MULTIPLAYER_URL || 'http://127.0.0.1:8787');
    const token = guestToken(base), tab = crypto.randomUUID();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${token}:${tab}`));
    const session = { user_id: [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('') };
    const socket = new CloudflareSocket(base, token, tab);
    const request = async (path, data) => {
      const response = await fetch(`${base}${path}`, {
        method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, 'X-Tab-Id': tab, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || '서버 요청에 실패했습니다.');
      return body;
    };
    const client = { async rpc(_session, method, data) {
      if (method === 'create_battle') return { payload: await request('/rooms', data) };
      if (!/^\d{6}$/.test(data.code || '')) throw Error('참가 코드 숫자 6자리를 입력해주세요.');
      return { payload: await request(`/rooms/${data.code}`) };
    } };
    return { client, socket, session };
  }
  // Retain the known working deployment until the Cloudflare server has been deployed.
  const { Client } = await import('@heroiclabs/nakama-js');
  const ssl = override?.ssl ?? env.VITE_NAKAMA_SSL === 'true';
  const client = new Client(env.VITE_NAKAMA_KEY || 'defaultkey', override?.host || env.VITE_NAKAMA_HOST || location.hostname, override?.port || env.VITE_NAKAMA_PORT || '7350', ssl);
  client.timeout = 6000;
  let device = sessionStorage.getItem('tb-device');
  if (!device) { device = crypto.randomUUID(); sessionStorage.setItem('tb-device', device); }
  return { client, session: await client.authenticateDevice(device, true), socket: client.createSocket(ssl, false) };
}

export class CloudflareSocket {
  constructor(base, token, tab) { Object.assign(this, { base, token, tab }); }
  async connect() {} // Cloudflare authenticates when joining a particular room.
  joinMatch(code, _unused, metadata) {
    if (!/^\d{6}$/.test(code)) return Promise.reject(Error('참가 코드 숫자 6자리를 입력해주세요.'));
    return new Promise((resolve, reject) => {
      const url = new URL(`/rooms/${code}/socket`, this.base);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('name', metadata.name);
      const ws = this.ws = new WebSocket(url, [PROTOCOL, `guest.${this.token}`, `tab.${this.tab}`]);
      let joined = false;
      const fail = () => { clearTimeout(timer); reject(Error('방 연결에 실패했습니다. 경기 중이거나 방이 가득 찼을 수 있습니다.')); };
      const timer = setTimeout(() => { fail(); ws.close(); }, 10000);
      ws.onmessage = event => {
        try {
          const packet = JSON.parse(event.data);
          if (packet.type === 'joined') { joined = true; clearTimeout(timer); resolve({ match_id: packet.code }); return; }
          this.onmatchdata?.({ op_code: packet.op, data: new TextEncoder().encode(JSON.stringify(packet.data)) });
        } catch (error) { console.error('Invalid multiplayer message', error); }
      };
      ws.onerror = () => { if (!joined) fail(); };
      ws.onclose = () => { clearTimeout(timer); if (!joined) fail(); else this.ondisconnect?.(); };
    });
  }
  async sendMatchState(_matchId, op, bytes) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw Error('서버 연결이 끊겼습니다.');
    this.ws.send(JSON.stringify({ op, data: JSON.parse(new TextDecoder().decode(bytes)) }));
  }
  async leaveMatch() { this.disconnect(); }
  disconnect() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}
