import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.env.VIBEZONE_WWWROOT ?? '/home/site/wwwroot';
const apiOrigin = new URL(process.env.VIBEZONE_API_ORIGIN ?? '');
const requiresAuth = process.env.VIBEZONE_API_REQUIRES_AUTH === 'true';
const port = Number(process.env.PORT || 8080);
const maxBodyBytes = 10 * 1024 * 1024;
const requestHeaders = ['accept','content-type','if-match','if-none-match','if-modified-since','x-correlation-id'];
const responseHeaders = ['cache-control','content-disposition','content-language','content-type','etag','last-modified','location','retry-after','x-correlation-id'];
const contentTypes = {
  '.css':'text/css; charset=utf-8', '.gif':'image/gif', '.html':'text/html; charset=utf-8',
  '.ico':'image/x-icon', '.jpeg':'image/jpeg', '.jpg':'image/jpeg', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.map':'application/json; charset=utf-8', '.png':'image/png',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.woff':'font/woff', '.woff2':'font/woff2',
};

function json(response,status,body) {
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('request body too large'),{statusCode:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxy(request,response) {
  const token = request.headers['x-ms-token-aad-access-token'];
  if (requiresAuth && typeof token !== 'string') {
    return json(response,401,{error:'The authenticated API session is unavailable. Sign out and sign in again.'});
  }
  const target = new URL(request.url,apiOrigin);
  const headers = {};
  for (const name of requestHeaders) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (typeof token === 'string') headers.authorization = `Bearer ${token}`;
  try {
    const upstream = await fetch(target,{
      method:request.method,
      headers,
      body:await requestBody(request),
      redirect:'manual',
      signal:AbortSignal.timeout(30_000),
    });
    const outgoing = {};
    for (const name of responseHeaders) {
      const value = upstream.headers.get(name);
      if (value !== null) outgoing[name] = value;
    }
    response.writeHead(upstream.status,outgoing);
    if (request.method === 'HEAD' || !upstream.body) return response.end();
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 502;
    json(response,status,{error:status === 413 ? 'Request body exceeds the 10 MB API limit.' : 'The API backend is unavailable.'});
  }
}

function safeFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (!relative || relative.startsWith('..') || relative.startsWith('.vibezone')) return undefined;
  return join(root,relative);
}

async function serveFile(request,response,file) {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) return false;
  response.writeHead(200,{
    'content-type':contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length':String(info.size),
    'cache-control':file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options':'nosniff',
  });
  if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
  return true;
}

createServer(async (request,response) => {
  const url = new URL(request.url ?? '/',`http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(request,response);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response,405,{error:'Method not allowed.'});
  const file = safeFile(url.pathname);
  if (file && await serveFile(request,response,file)) return;
  if (extname(url.pathname)) return json(response,404,{error:'Not found.'});
  if (await serveFile(request,response,join(root,'index.html'))) return;
  json(response,503,{error:'The frontend deployment artifact is incomplete.'});
}).listen(port,() => console.log(`VibeZone BFF listening on ${port}`));
