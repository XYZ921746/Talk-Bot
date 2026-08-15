import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg } from './types.js';
import { VoiceSession } from './voice/session.js';
import { PersonaRegistry } from './personas.js';
import { PluginManager } from './plugins/manager.js';
import { loadDefaults, mergeSessionConfig } from './config.js';

interface WsDeps {
  personas: PersonaRegistry;
  plugins: PluginManager;
}

const HEARTBEAT_MS = 30_000;

/** 挂载 /ws WebSocket 端点（语音流 + 文本聊天） */
export function attachWs(server: Server, deps: WsDeps): void {
  const wss = new WebSocketServer({ noServer: true });
  const defaults = loadDefaults();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let session: VoiceSession | null = null;

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on('message', (data, isBinary) => {
      if (session && isBinary) {
        session.handleAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        return;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'init': {
          if (session) session.dispose();
          const config = mergeSessionConfig(defaults, msg.config);
          const persona = deps.personas.get(msg.personaId);
          // 会话级插件开关：按客户端配置过滤启用的插件
          const disabled = new Set(msg.disabledPlugins ?? []);
          const activePlugins = deps.plugins.list.filter((p) => !disabled.has(p.name));
          const sessionPlugins = new PluginManager(activePlugins);
          session = new VoiceSession(
            { ws, plugins: sessionPlugins },
            config,
            persona,
            msg.mode ?? 'text',
          );
          void session.start();
          break;
        }
        case 'text':
          if (session) void session.handleTextMessage(msg.text);
          break;
        case 'compress':
          if (session) void session.handleCompress(msg.pressure, msg.dialog);
          break;
        case 'ping':
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
          }
          break;
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      session?.dispose();
    });
    ws.on('error', () => {
      /* 忽略单个连接的传输错误 */
    });
  });
}
