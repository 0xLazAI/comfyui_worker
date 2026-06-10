import fs from 'fs/promises';
import path from 'path';

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function atomicWriteText(filePath: string, text: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, text, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

export async function writeJsonFileExclusive(filePath: string, payload: unknown): Promise<boolean> {
  await ensureDirectory(path.dirname(filePath));
  try {
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}
