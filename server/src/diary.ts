import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const DIARY_DIR = process.env.DIARY_DIR || path.join(ROOT_DIR, 'diaries');

interface DiaryEntry {
  time: string;
  text: string;
}

interface DiaryFile {
  personaId: string;
  entries: DiaryEntry[];
  updatedAt: number;
}

function filePath(personaId: string): string {
  return path.join(DIARY_DIR, `${personaId}.json`);
}

function read(personaId: string): DiaryFile {
  const fp = filePath(personaId);
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as DiaryFile;
      return { personaId, entries: raw.entries ?? [], updatedAt: raw.updatedAt ?? 0 };
    }
  } catch {
    /* 损坏则重建 */
  }
  return { personaId, entries: [], updatedAt: 0 };
}

function write(data: DiaryFile): void {
  if (!fs.existsSync(DIARY_DIR)) fs.mkdirSync(DIARY_DIR, { recursive: true });
  fs.writeFileSync(filePath(data.personaId), JSON.stringify(data, null, 2), 'utf8');
}

/** 获取某个人设的历史日记全文（多篇拼接），无则空串 */
export function getDiary(personaId: string): string {
  const data = read(personaId);
  if (!data.entries.length) return '';
  return data.entries.map((e) => `## ${e.time}\n${e.text}`).join('\n\n');
}

/** 追加一篇日记并持久化 */
export function appendDiary(personaId: string, text: string): void {
  const data = read(personaId);
  data.entries.push({ time: new Date().toLocaleString('zh-CN'), text });
  data.updatedAt = Date.now();
  write(data);
}

/** 删除某个人设的全部日记 */
export function clearDiary(personaId: string): void {
  write({ personaId, entries: [], updatedAt: Date.now() });
}