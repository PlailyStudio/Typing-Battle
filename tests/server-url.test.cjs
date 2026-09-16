const { test } = require('node:test');
const assert = require('node:assert/strict');

test('임시 HTTPS 터널 주소를 Nakama 연결 설정으로 변환한다', async () => {
  const { parseServerOverride } = await import('../src/server-url.js');
  assert.deepEqual(parseServerOverride('quiet-tree.trycloudflare.com'), {
    host: 'quiet-tree.trycloudflare.com',
    port: '443',
    ssl: true,
    parameter: 'quiet-tree.trycloudflare.com',
  });
  assert.deepEqual(parseServerOverride('https://example.com:8443'), {
    host: 'example.com',
    port: '8443',
    ssl: true,
    parameter: 'example.com:8443',
  });
});

test('초대 링크와 방 입장 후 주소에 임시 서버를 유지한다', async () => {
  const { buildInviteUrl, pagePath, parseServerOverride } = await import('../src/server-url.js');
  const location = { origin: 'https://user.github.io', pathname: '/type-battle/' };
  const server = parseServerOverride('quiet-tree.trycloudflare.com');
  assert.equal(
    buildInviteUrl(location, '123456', server),
    'https://user.github.io/type-battle/?room=123456&server=quiet-tree.trycloudflare.com',
  );
  assert.equal(pagePath(location, server), '/type-battle/?server=quiet-tree.trycloudflare.com');
});

test('안전하지 않거나 경로가 포함된 서버 주소는 거부한다', async () => {
  const { parseServerOverride } = await import('../src/server-url.js');
  for (const value of ['', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'not a host']) {
    assert.equal(parseServerOverride(value), null, value);
  }
});
