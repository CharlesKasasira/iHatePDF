import { Injectable, OnModuleInit } from "@nestjs/common";
import { createReadStream, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env.js";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly storageRoot = resolve(env.STORAGE_DIR);

  async onModuleInit(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
  }

  createDownloadUrl(fileId: string): string {
    return `${env.API_PUBLIC_URL}/api/files/${fileId}/download`;
  }

  async saveFileStream(
    fileName: string,
    mimeType: string,
    input: NodeJS.ReadableStream,
    prefix = "uploads"
  ): Promise<{
    objectKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const safeName = this.sanitizeFileName(fileName);
    const objectKey = `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
    const path = this.resolveObjectPath(objectKey);
    let sizeBytes = 0;

    await mkdir(dirname(path), { recursive: true });

    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        callback(null, chunk);
      }
    });

    try {
      await pipeline(input, counter, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }

    return {
      objectKey,
      fileName: safeName,
      mimeType,
      sizeBytes
    };
  }

  async saveFile(
    fileName: string,
    mimeType: string,
    data: Buffer,
    prefix = "uploads"
  ): Promise<{
    objectKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const safeName = this.sanitizeFileName(fileName);
    const objectKey = `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
    const path = this.resolveObjectPath(objectKey);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);

    return {
      objectKey,
      fileName: safeName,
      mimeType,
      sizeBytes: data.byteLength
    };
  }

  async readObjectBuffer(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveObjectPath(objectKey));
  }

  async openObjectReadStream(objectKey: string): Promise<{
    stream: NodeJS.ReadableStream;
    sizeBytes: number;
  }> {
    const path = this.resolveObjectPath(objectKey);
    const fileStat = await stat(path);

    return {
      stream: createReadStream(path),
      sizeBytes: fileStat.size
    };
  }

  private sanitizeFileName(fileName: string): string {
    const safe = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return safe.length > 0 ? safe : `file-${randomUUID()}.pdf`;
  }

  private resolveObjectPath(objectKey: string): string {
    const absolutePath = resolve(this.storageRoot, objectKey);

    if (absolutePath !== this.storageRoot && !absolutePath.startsWith(`${this.storageRoot}${sep}`)) {
      throw new Error("Invalid object key path traversal attempt.");
    }

    return absolutePath;
  }
}
