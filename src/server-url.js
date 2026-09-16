export function parseServerOverride(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let source = value.trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) source = `https://${source}`;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return {
      host: url.hostname,
      port: url.port || '443',
      ssl: true,
      parameter: url.host,
    };
  } catch {
    return null;
  }
}

export function buildInviteUrl(location, code, server) {
  if (!code) return '';
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('room', code);
  if (server) url.searchParams.set('server', server.parameter);
  return url.toString();
}

export function pagePath(location, server) {
  if (!server) return location.pathname;
  return `${location.pathname}?server=${encodeURIComponent(server.parameter)}`;
}
