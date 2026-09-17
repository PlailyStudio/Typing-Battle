import { DurableObject } from 'cloudflare:workers';
import { createRoom, joinRoom, leaveRoom, handleMessage, advanceTime } from './game.js';
import { OP, PROTOCOL, MAX_MESSAGE_BYTES } from '../shared/protocol.js';

const IDLE_MS = 30 * 60 * 1000;
export class BattleRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get('room');
      if (!this.state) return;
      // Per-player typing updates live in socket attachments, not one DB write per keystroke.
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a?.roomId !== this.state.id || a.roundId !== this.state.roundId) continue;
        const index = this.state.players.findIndex(p => p.id === a.player.id);
        if (index >= 0 && !this.state.players[index].left) this.state.players[index] = a.player;
      }
    });
  }

  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url), now = Date.now();
      if (url.pathname === '/create') {
        if (this.state && (!this.state.emptyUntil || this.state.emptyUntil > now)) return Response.json({ error: '이미 사용 중인 참가 코드입니다.' }, { status: 409 });
        const { params, code, playerId } = await request.json();
        try { this.state = createRoom(params, code, playerId, now); }
        catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
        this.state.lastActivity = now; this.state.emptyUntil = now + 60000;
        await this.checkpoint();
        return Response.json({ code, matchId: code });
      }
      if (!this.state || (this.state.emptyUntil && this.state.emptyUntil <= now)) return Response.json({ error: '방이 없거나 종료되었습니다.' }, { status: 404 });
      if (url.pathname === '/info') return Response.json({ code: this.state.code, matchId: this.state.code });
      if (url.pathname !== '/socket') return new Response('Not found', { status: 404 });
      const id = request.headers.get('X-Player-Id'), userId = request.headers.get('X-User-Id');
      try { joinRoom(this.state, id, userId, url.searchParams.get('name')); }
      catch (error) { return Response.json({ error: error.message }, { status: 409 }); }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ roomId: this.state.id, roundId: this.state.roundId,
        player: this.state.players.find(p => p.id === id), lastSeen: now, windowStart: now, count: 0 });
      this.state.emptyUntil = 0; this.state.lastActivity = now;
      await this.checkpoint();
      server.send(JSON.stringify({ type: 'joined', playerId: id, userId, code: this.state.code }));
      this.broadcast();
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': PROTOCOL } });
    });
  }

  webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (typeof message !== 'string' || new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) { ws.close(1009, 'Message too large'); return; }
      const a = ws.deserializeAttachment();
      if (!this.state || a?.roomId !== this.state.id) { ws.close(1008, 'Room expired'); return; }
      const now = Date.now();
      if (now - a.windowStart >= 1000) { a.windowStart = now; a.count = 0; }
      if (++a.count > 100) { ws.close(1008, 'Too many messages'); return; }
      let event;
      try { event = JSON.parse(message); } catch { ws.close(1007, 'Invalid JSON'); return; }
      if (!event || !Number.isInteger(event.op) || event.op < 2 || event.op > 7 || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) { ws.close(1008, 'Invalid message'); return; }
      const before = this.state.phase;
      const reply = handleMessage(this.state, a.player.id, event.op, event.data, now);
      a.player = this.state.players.find(p => p.id === a.player.id) || a.player;
      a.roundId = this.state.roundId; a.lastSeen = now;
      ws.serializeAttachment(a);
      this.state.lastActivity = now;
      if (event.op !== OP.INPUT || before !== this.state.phase) await this.checkpoint();
      if (reply) ws.send(JSON.stringify(reply));
      this.broadcast();
    });
  }

  webSocketClose(ws, code) { return this.depart(ws, code); }
  webSocketError(ws) { return this.depart(ws, 1011); }
  depart(ws, code = 1000) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const a = ws.deserializeAttachment();
      try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {}
      if (!this.state || a?.roomId !== this.state.id) return;
      leaveRoom(this.state, a.player.id);
      this.state.lastActivity = Date.now();
      if (!this.state.players.some(p => !p.left)) this.state.emptyUntil = Date.now() + 30000;
      await this.checkpoint(); this.broadcast();
    });
  }

  async checkpoint() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      const player = this.state.players.find(p => p.id === a?.player.id);
      if (a?.roomId === this.state.id && player && !player.left) ws.serializeAttachment({ ...a, player, roundId: this.state.roundId });
    }
    await this.ctx.storage.put('room', this.state);
    await this.schedule();
  }
  schedule() {
    const s = this.state;
    const deadline = s.emptyUntil || s.lastActivity + IDLE_MS;
    const phaseAt = s.phase === 'countdown' ? s.startAt : s.phase === 'playing' && s.gameMode === 'timed' ? s.endAt : Infinity;
    return this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(deadline, phaseAt)));
  }
  broadcast() {
    // Results are a server-side storage contract; clients render the public player state.
    const { result, ...state } = this.state;
    const payload = JSON.stringify({ op: OP.STATE, data: { ...state, serverNow: Date.now() } });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.roomId === state.id && state.players.some(p => p.id === a.player.id && !p.left)) {
        try { ws.send(payload); } catch {}
      }
    }
  }
  alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!this.state) return;
      const now = Date.now();
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a?.roomId === this.state.id) this.state.lastActivity = Math.max(this.state.lastActivity, a.lastSeen);
      }
      if ((this.state.emptyUntil && now >= this.state.emptyUntil) || now >= this.state.lastActivity + IDLE_MS) {
        for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room expired');
        this.state = undefined;
        await this.ctx.storage.deleteAll();
        return;
      }
      advanceTime(this.state, now);
      await this.checkpoint(); this.broadcast();
    });
  }
}
