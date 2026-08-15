/**
 * 示例插件：工具调用（function calling）
 *
 * 演示：
 *  1. tools —— 向 LLM 注册可调用的工具（OpenAI / Anthropic 会自动转换格式）
 *  2. handleTool —— 执行工具并返回结果，LLM 会基于结果组织回复
 *  3. hooks —— 会话开始/结束的日志钩子
 *
 * 用户对助手说“现在几点”即可触发 get_current_time 工具。
 */
export default {
  name: '示例工具',
  version: '1.1.0',
  description: '提供当前时间查询等示例工具，演示插件工具调用',
  priority: 10, // 优先级：数值越大越先执行（默认 0）

  hooks: {
    async onSessionStart(ctx) {
      ctx.log(`[工具插件] 会话开始，人设: ${ctx.persona?.name ?? '默认'}`);
    },
    async onSessionEnd(ctx) {
      ctx.log('[工具插件] 会话结束');
    },
  },

  tools: [
    {
      name: 'get_current_time',
      description: '获取服务器当前日期和时间（用于回答“现在几点”“今天几号”等问题）',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'calculate',
      description: '执行简单的数学计算',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '数学表达式，如 "12*7+3"' },
        },
        required: ['expression'],
      },
    },
  ],

  async handleTool(name, args, ctx) {
    if (name === 'get_current_time') {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'full',
        timeStyle: 'medium',
      });
      return { time: fmt.format(now), iso: now.toISOString() };
    }
    if (name === 'calculate') {
      const expr = String(args.expression ?? '').replace(/[^0-9+\-*/().\s]/g, '');
      if (!expr) return { error: '表达式为空' };
      // eslint-disable-next-line no-eval
      const result = Function(`"use strict"; return (${expr});`)();
      return { expression: expr, result: Number(result) };
    }
    throw new Error(`未知工具: ${name}`);
  },
};
