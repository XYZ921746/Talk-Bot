import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODS_DIR, PLUGIN_DIR } from '../config.js';
import type { VoiceAssistantPlugin } from '../types.js';

/**
 * 加载插件目录下的所有插件。
 * 插件放在项目根目录的 `mods/` 文件夹（也兼容旧版 `server/plugins/`）。
 * 每个插件是一个 .js / .mjs / .ts 文件，默认导出插件对象：
 *   export default { name, hooks: {...}, tools: [...], handleTool }
 * @param bustCache 为 true 时附加时间戳查询参数破除 Node 模块缓存（热重载用）
 */
export async function loadPlugins(bustCache = false): Promise<VoiceAssistantPlugin[]> {
  const plugins: VoiceAssistantPlugin[] = [];
  const seen = new Set<string>();
  const cacheBust = bustCache ? `?t=${Date.now()}` : '';

  for (const dir of [MODS_DIR, PLUGIN_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(js|mjs|ts)$/.test(f))
      .sort();

    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const mod = (await import(pathToFileURL(full).href + cacheBust)) as {
          default?: VoiceAssistantPlugin;
        };
        const plugin = mod.default;
        if (!plugin || typeof plugin !== 'object' || !plugin.name) {
          console.warn(`[plugins] 跳过无效插件文件: ${file}（需要 default 导出 { name, ... }）`);
          continue;
        }
        if (seen.has(plugin.name)) {
          console.warn(`[plugins] 插件名重复，跳过: ${plugin.name} (${file})`);
          continue;
        }
        seen.add(plugin.name);
        plugins.push(plugin);
        console.log(`[plugins] 已加载: ${plugin.name}${plugin.version ? ` v${plugin.version}` : ''} (${path.relative(process.cwd(), full)})`);
      } catch (err) {
        console.warn(`[plugins] 加载失败 ${file}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return plugins;
}
