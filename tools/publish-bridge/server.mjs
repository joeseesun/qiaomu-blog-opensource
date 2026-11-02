import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const token = () => randomBytes(16).toString('hex');
const targets = { x: 'https://x.com/compose/articles', zhihu: 'https://zhuanlan.zhihu.com/write' };
const extension = /^(chrome|moz|safari-web)-extension:\/\//;
const MAX_BODY = 64 * 1024 * 1024;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('文章和图片合计不能超过 64 MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });

/** Compatible with Clipper's existing one-job loopback protocol. Never fetches remote URLs. */
export function createPublishBridge({ origins = ['https://blog.qiaomu.ai', 'http://localhost:3000', 'http://127.0.0.1:3000'], ttl = 10 * 60_000 } = {}) {
  const jobs = new Map();
  const closeJob = entry => { clearTimeout(entry.timer); entry.server.close(); jobs.delete(entry.control); };
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: 'bad-host' });
    const origin = req.headers.origin;
    if (!origins.includes(origin)) return json(res, 403, { error: 'bad-origin' });
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-private-network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { v: 1 });
      if (req.method === 'POST' && req.url === '/jobs') {
        for (const entry of jobs.values()) if (['done', 'error'].includes(entry.status.state) || entry.cancelAcknowledged) closeJob(entry);
        if (jobs.size >= 3) return json(res, 429, { error: '正在发送的文章过多，请完成或取消后再试' });
        const input = await body(req);
        const { job, assets } = input;
        if (!job || job.v !== 1 || !Object.hasOwn(targets, job.target) || typeof job.title !== 'string' || !job.title.trim() || !Array.isArray(assets) || assets.length > 100 || !job.content || !Array.isArray(job.assets)) throw new Error('文章格式无效');
        if (typeof job.content[job.target === 'x' ? 'markdown' : 'html'] !== 'string') throw new Error('正文格式无效');
        const files = new Map();
        for (const asset of assets) {
          if (!/^[\w-]+$/.test(asset.id) || !/^image\/(png|jpeg|webp|gif)$/.test(asset.mime) || typeof asset.base64 !== 'string' || files.has(asset.id)) throw new Error('图片格式无效');
          const data = Buffer.from(asset.base64, 'base64');
          if (data.length > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB');
          files.set(asset.id, { data, mime: asset.mime });
        }
        if (job.assets.length !== files.size || job.assets.some(a => !files.has(a.id))) throw new Error('图片资源不完整');
        const entry = { createdAt: Date.now(), control: token(), pickup: token(), session: token(), fetched: false, cancel: false, status: { state: 'running', text: '等待 Clipper 取走文章…' }, server: null, timer: null };
        entry.server = http.createServer(async (request, response) => {
          const jobPort = entry.server.address().port;
          if (![`127.0.0.1:${jobPort}`, `localhost:${jobPort}`].includes(request.headers.host) || (request.headers.origin && !extension.test(request.headers.origin))) return json(response, 403, { error: 'forbidden' });
          const auth = request.headers.authorization;
          if (request.method === 'GET' && request.url === '/v1/job') {
            if (auth !== `Bearer ${entry.pickup}`) return json(response, 401, {});
            if (entry.fetched || entry.status.state !== 'running') return json(response, 410, {});
            entry.fetched = true; return json(response, 200, { v: 1, session: entry.session, job });
          }
          if (!entry.fetched || auth !== `Bearer ${entry.session}`) return json(response, 401, {});
          const match = /^\/v1\/asset\/([\w-]+)$/.exec(request.url);
          if (request.method === 'GET' && match) {
            const file = files.get(match[1]); if (!file) return json(response, 404, {});
            response.writeHead(200, { 'content-type': file.mime, 'cache-control': 'no-store' }); return response.end(file.data);
          }
          if (request.method === 'POST' && request.url === '/v1/status') {
            try {
              const status = await body(request);
              if (!['running', 'done', 'error', 'cancelled'].includes(status.state)) throw new Error('bad-state');
              if (entry.cancel && status.state === 'cancelled') entry.cancelAcknowledged = true;
              if (entry.status.state === 'running') entry.status = status.state === 'running' ? { ...entry.status, ...status } : status;
              return json(response, 200, { ok: true, cancel: entry.cancel });
            } catch { return json(response, 400, {}); }
          }
          json(response, 404, {});
        });
        const jobPort = await listen(entry.server);
        entry.timer = setTimeout(() => closeJob(entry), ttl); entry.timer.unref();
        jobs.set(entry.control, entry);
        return json(res, 201, { control: entry.control, url: `${targets[job.target]}#qp=${jobPort}.${entry.pickup}` });
      }
      const entry = jobs.get(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!entry) return json(res, 401, { error: '任务已过期，请重新发送' });
      if (req.url === '/job' && req.method === 'GET') {
        if (!entry.fetched && entry.status.state === 'running' && Date.now() - entry.createdAt > 30_000) entry.status = { state: 'error', text: '没有检测到 Clipper 取走文章，请确认扩展已启用并登录目标平台后重试。' };
        return json(res, 200, entry.status);
      }
      if (req.url === '/job' && req.method === 'DELETE') { entry.cancel = true; entry.status = { state: 'cancelled', text: '已停止；平台可能已保留部分草稿，请检查。' }; return json(res, 200, entry.status); }
      json(res, 404, {});
    } catch (error) { json(res, 400, { error: error.message || '请求无效' }); }
  });
  server.on('close', () => { for (const entry of jobs.values()) closeJob(entry); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = process.env.PUBLISH_ORIGINS?.split(',');
  const server = createPublishBridge(origins ? { origins } : {});
  server.listen(19876, '127.0.0.1', () => console.log('发布桥接已启动，可回到博客发送 X / 知乎草稿。'));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
