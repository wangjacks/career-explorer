/**
 * 本地文件存储实现（#111）：复用现有 `uploads/` 目录。
 * - 私有读写在本地模式下的等价物：应用代理路径 `/api/uploads/{key}`（免签名，行为与现版本完全一致）
 * - 保留路径穿越防护（与 `GET /api/uploads/[...path]` 同策略）
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { validateObjectKey, type StorageAdapter, type StoredObject } from "./storage";

export class LocalStorageAdapter implements StorageAdapter {
  readonly type = "local" as const;

  /** 解析并校验对象落盘路径（防路径穿越） */
  private resolveSafe(key: string): string {
    validateObjectKey(key);
    // 动态路径校验需运行时解析（防穿越），豁免 Turbopack 静态追踪
    const uploadsDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
    const filepath = path.resolve(uploadsDir, key);
    if (!filepath.startsWith(uploadsDir + path.sep)) {
      throw new Error("禁止访问");
    }
    return filepath;
  }

  async upload(key: string, buffer: Buffer, _contentType?: string): Promise<void> {
    // contentType 本地存储无需持久化（服务端直接按扩展名推断 MIME）
    void _contentType;
    const filepath = this.resolveSafe(key);
    await mkdir(path.dirname(filepath), { recursive: true });
    await writeFile(filepath, buffer);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveSafe(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveSafe(key));
    } catch {
      // 对象不存在时静默成功（与 S3 DeleteObject 语义一致）
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveSafe(key));
      return true;
    } catch {
      return false;
    }
  }

  /** 全量枚举（#117）：扁平目录扫描；跳过点文件（.gitkeep/.DS_Store 保护）与子目录 */
  async listObjects(): Promise<StoredObject[]> {
    const uploadsDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
    let entries: string[];
    try {
      entries = await readdir(uploadsDir);
    } catch {
      return []; // 目录不存在视为空
    }
    const objects: StoredObject[] = [];
    for (const name of entries) {
      if (name.startsWith(".")) continue; // .gitkeep / .DS_Store 等保护
      try {
        const info = await stat(path.join(uploadsDir, name));
        if (!info.isFile()) continue;
        objects.push({ key: name, size: info.size, lastModified: info.mtime.toISOString() });
      } catch {
        // 单文件 stat 失败跳过（并发删除竞态）
      }
    }
    return objects;
  }

  async getSignedUrl(key: string): Promise<string> {
    validateObjectKey(key);
    return `/api/uploads/${key}`;
  }
}
