/**
 * 示例插件：TTS 发音纠正（onBeforeTTS 钩子）
 *
 * 演示新增钩子 onBeforeTTS：在语音合成前改写文本，用于纠正 TTS 读音。
 * 例如把英文单词替换成中文谐音，避免 TTS 读错。
 *
 * 插件系统的文本钩子规则：返回非空字符串才替换原内容。
 */
export default {
  name: 'TTS 发音纠正',
  version: '1.0.0',
  description: '语音合成前纠正读音（英文→中文谐音示例）',
  priority: 100, // 高优先级，先于其他文本钩子执行

  hooks: {
    async onBeforeTTS(text, ctx) {
      // 示例：把常见英文术语替换成 TTS 容易读对的中文谐音
      const replacements = [
        [/Python/gi, '派森'],
        [/API/g, 'A P I'],
        [/AI(?![a-zA-Z])/g, 'A I'],
      ];
      let out = text;
      for (const [pattern, sub] of replacements) {
        out = out.replace(pattern, sub);
      }
      if (out !== text) ctx.log('[发音纠正] 已纠正文本');
      return out;
    },
  },
};
