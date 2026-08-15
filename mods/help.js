/**
 * 示例插件：文本钩子
 *
 * 演示 onUserText / onAssistantText 钩子：
 *  - 用户发送“帮助”时，把这句话改写成让助手介绍自己能力的指令
 *  - 助手回复过长时，追加一句礼貌收尾（可选，展示文本改写能力）
 */
export default {
  name: '帮助指令',
  version: '1.0.0',
  description: '支持“帮助”指令，并演示文本钩子改写能力',

  hooks: {
    async onUserText(text) {
      if (/^(help|帮助|你能做什么|功能)$/i.test(text.trim())) {
        return (
          '请用 3~5 句话介绍你自己的能力：支持语音通话、文字聊天、' +
          '接入 OpenAI/Anthropic 模型、自定义人设和插件，并欢迎用户提问。'
        );
      }
      return text;
    },
    async onAssistantText(text) {
      // 演示：让回复更口语化（去掉多余的 Markdown 符号）
      return text.replace(/[*_`#]/g, '');
    },
  },
};
