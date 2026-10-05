/** A CSV record exactly as read from the file: untrusted strings, validated later by the Domain. */
export type RawStudentRow = {
  /** 1-based line in the source file (line 1 is the header). */
  readonly lineNumber: number;
  readonly name?: string;
  readonly email?: string;
  readonly enrollmentDate?: string;
  readonly courseId?: string;
  readonly score?: string;
};

export interface CsvStreamReader {
  /**
   * Streams rows on demand. Consumers MUST iterate with `for await...of` so that a slow
   * consumer pauses the underlying file stream (backpressure) instead of buffering the file.
   */
  read(filePath: string): AsyncIterable<RawStudentRow>;
}
