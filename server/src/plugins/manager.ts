import type { PluginContext, ToolDef, VoiceAssistantPlugin } from '../types.js';

export type { VoiceAssistantPlugin, PluginContext, ToolDef };

/**
 * 插件管理器：统一应用钩子、聚合工具定义、执行工具调用。
 * 特性：
 *  - 错误隔离：单个插件钩子抛错不影响其他插件与主流程
 *  - 优先级：priority 越大越先执行（默认 0）
 *  - 文本钩子：返回非空字符串才替换原内容，返回空/undefined 保持原样
 */
export class PluginManager {
  private plugins: VoiceAssistantPlugin[] = [];

  constructor(plugins: VoiceAssistantPlugin[]) {
    // 按优先级降序排列（数值大者先执行），同优先级保持注册顺序
    this.plugins = [...plugins].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  get list(): VoiceAssistantPlugin[] {
    return this.plugins;
  }

  /** 替换插件列表（热重载用） */
  setPlugins(plugins: VoiceAssistantPlugin[]): void {
    this.plugins = [...plugins].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /** 安全执行单个钩子：捕获异常，避免一个插件拖垮整条链 */
  private async safeRun<T>(
    plugin: VoiceAssistantPlugin,
    label: string,
    fn: () => Promise<T | void>,
    ctx: PluginContext,
  ): Promise<T | undefined> {
    try {
      return (await fn()) as T | undefined;
    } catch (err) {
      ctx.log(`[plugin:${plugin.name}] ${label} 钩子异常:`, err instanceof Error ? err.message : err);
      return undefined;
    }
  }

  /** 文本改写链：依次应用各插件钩子，返回非空字符串才替换 */
  private async runTextChain(
    hook: 'onUserText' | 'onAssistantText' | 'onBeforeTTS',
    text: string,
    ctx: PluginContext,
  ): Promise<string> {
    let out = text;
    for (const p of this.plugins) {
      const fn = p.hooks?.[hook];
      if (!fn) continue;
      const r = await this.safeRun<string>(p, hook, () => fn(out, ctx), ctx);
      if (typeof r === 'string' && r.trim()) out = r;
    }
    return out;
  }

  async onUserText(text: string, ctx: PluginContext): Promise<string> {
    return this.runTextChain('onUserText', text, ctx);
  }

  async onAssistantText(text: string, ctx: PluginContext): Promise<string> {
    return this.runTextChain('onAssistantText', text, ctx);
  }

  async onBeforeTTS(text: string, ctx: PluginContext): Promise<string> {
    return this.runTextChain('onBeforeTTS', text, ctx);
  }

  async onSessionStart(ctx: PluginContext): Promise<void> {
    for (const p of this.plugins) {
      if (p.hooks?.onSessionStart) await this.safeRun(p, 'onSessionStart', () => p.hooks!.onSessionStart!(ctx), ctx);
    }
  }

  async onSessionEnd(ctx: PluginContext): Promise<void> {
    for (const p of this.plugins) {
      if (p.hooks?.onSessionEnd) await this.safeRun(p, 'onSessionEnd', () => p.hooks!.onSessionEnd!(ctx), ctx);
    }
  }

  async onError(error: unknown, ctx: PluginContext): Promise<void> {
    for (const p of this.plugins) {
      if (p.hooks?.onError) await this.safeRun(p, 'onError', () => p.hooks!.onError!(error, ctx), ctx);
    }
  }

  /** 聚合所有插件声明的工具（按名字去重，高优先级先注册，同名时先注册的生效） */
  get tools(): ToolDef[] {
    const map = new Map<string, ToolDef>();
    for (const p of this.plugins) {
      for (const t of p.tools ?? []) if (!map.has(t.name)) map.set(t.name, t);
    }
    return [...map.values()];
  }

  /** 执行某个插件工具：先走 onToolCall 前置钩子，再执行，再走 onToolResult 后置钩子 */
  async handleTool(name: string, args: Record<string, unknown>, ctx: PluginContext): Promise<string> {
    // onToolCall 前置钩子：允许插件改写参数
    let finalArgs = args;
    for (const p of this.plugins) {
      if (!p.hooks?.onToolCall) continue;
      const r = await this.safeRun<Record<string, unknown>>(p, 'onToolCall', () => p.hooks!.onToolCall!(name, finalArgs, ctx), ctx);
      if (r && typeof r === 'object') finalArgs = r;
    }

    // 找到声明该工具且实现了 handleTool 的插件执行
    let result: string | undefined;
    for (const p of this.plugins) {
      if (p.tools?.some((t) => t.name === name) && p.handleTool) {
        const r = await this.safeRun<string | Record<string, unknown>>(
          p,
          `handleTool:${name}`,
          () => p.handleTool!(name, finalArgs, ctx),
          ctx,
        );
        if (r !== undefined) result = typeof r === 'string' ? r : JSON.stringify(r);
        break;
      }
    }
    if (result === undefined) {
      throw new Error(`没有插件处理工具: ${name}`);
    }

    // onToolResult 后置钩子：允许插件改写工具结果
    let out = result;
    for (const p of this.plugins) {
      if (!p.hooks?.onToolResult) continue;
      const r = await this.safeRun<string>(p, 'onToolResult', () => p.hooks!.onToolResult!(name, finalArgs, out, ctx), ctx);
      if (typeof r === 'string' && r.trim()) out = r;
    }
    return out;
  }
}
