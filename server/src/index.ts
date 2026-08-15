import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { SERVER_VERSION, WEB_DIST_DIR } from './config.js';
import { PersonaRegistry } from './personas.js';
import { loadPlugins } from './plugins/loader.js';
import { PluginManager } from './plugins/manager.js';
import { attachWs } from './ws.js';
import { registerApiRoutes } from './routes/api.js';

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  await app.register(cors, { origin: true });

  const personas = new PersonaRegistry();
  const plugins = new PluginManager(await loadPlugins());

  registerApiRoutes(app, { personas, plugins, version: SERVER_VERSION });

  // 生产模式：托管 web 构建产物，单端口即可访问
  if (fs.existsSync(WEB_DIST_DIR)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST_DIR,
      wildcard: false,
      cacheControl: false, // 关闭内置缓存头，由下方 setHeaders 统一控制
      setHeaders(res, path) {
        // index.html 一律不缓存（避免浏览器继续引用已清理的旧 JS 导致白屏）
        if (path.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          // 带 hash 的资源：短缓存即可（本地应用，性能无影响，规避陈旧缓存组合）
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    });
    // fastify-static 自动注册 GET /（index.html）；其余路径回退到 SPA
    // 注意：JS/CSS 等资源请求 404 时返回真正的 404（而不是 HTML），避免模块脚本 MIME 错误导致白屏
    const RESOURCE_EXT = /\.(js|mjs|css|json|png|jpe?g|svg|ico|woff2?|webmanifest|map)$/i;
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !RESOURCE_EXT.test(req.url ?? '')) {
        void reply.sendFile('index.html');
      } else {
        reply.status(404).send({ error: 'Not Found' });
      }
    });
  } else {
    console.log('[web] 未找到 web/dist（前端未构建）。开发模式请用 npm run dev，或先执行 npm run build。');
  }

  attachWs(app.server, { personas, plugins });

  const port = Number(process.env.PORT || 3210);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });

  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│        AI 语音通话已启动 🎙️                  │');
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  本机访问:  http://localhost:${port}${' '.repeat(Math.max(1, 19 - String(port).length))}│`);
  console.log('│  手机/平板: 同一 Wi-Fi 下访问 http://<本机IP>:' + port + '  │');
  console.log('└──────────────────────────────────────────────┘');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
