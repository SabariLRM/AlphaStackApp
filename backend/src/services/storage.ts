import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class TooLargeError extends Error {}

export interface Storage {
  readonly root: string;
  /** Streams to disk, aborting (and cleaning up) once maxBytes is exceeded. */
  saveStream(kind: 'attachments' | 'avatars', input: Readable, maxBytes: number): Promise<{ key: string; size: number }>;
  saveBuffer(kind: 'attachments' | 'avatars', data: Buffer): Promise<string>;
  open(key: string): Readable;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

export function createStorage(root: string): Storage {
  const absRoot = path.resolve(root);

  const resolveKey = (key: string) => {
    const full = path.resolve(absRoot, key);
    if (!full.startsWith(absRoot + path.sep)) throw new Error('invalid storage key');
    return full;
  };

  const newKey = async (kind: string) => {
    const id = randomUUID();
    const key = `${kind}/${id.slice(0, 2)}/${id}`;
    await mkdir(path.dirname(resolveKey(key)), { recursive: true });
    return key;
  };

  return {
    root: absRoot,
    async saveStream(kind, input, maxBytes) {
      const key = await newKey(kind);
      const target = resolveKey(key);
      let size = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          if (size > maxBytes) cb(new TooLargeError(`file exceeds ${maxBytes} bytes`));
          else cb(null, chunk);
        },
      });
      try {
        await pipeline(input, limiter, createWriteStream(target));
      } catch (err) {
        await rm(target, { force: true });
        throw err;
      }
      return { key, size };
    },
    async saveBuffer(kind, data) {
      const key = await newKey(kind);
      await writeFile(resolveKey(key), data);
      return key;
    },
    open(key) {
      return createReadStream(resolveKey(key));
    },
    async exists(key) {
      try {
        await stat(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },
  };
}
