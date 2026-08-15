/** 规范化 API 地址：自动补全 http:// 协议、去掉尾部斜杠 */
export function normalizeBaseUrl(url: string): string {
  let u = (url ?? '').trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}
