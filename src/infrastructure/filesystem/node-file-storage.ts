import { constants } from 'node:fs';
import { access, rm, stat } from 'node:fs/promises';
import type { FileStorage } from '@application/interfaces/file-storage';

export class NodeFileStorage implements FileStorage {
  async isReadable(path: string): Promise<boolean> {
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        return false;
      }
      await access(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }
}
