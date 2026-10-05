export interface FileStorage {
  isReadable(path: string): Promise<boolean>;
  /** Removes the file; succeeds silently when it no longer exists. */
  remove(path: string): Promise<void>;
}
