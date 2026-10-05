export type ImportJobCommand = {
  readonly jobId: string;
  readonly filePath: string;
  readonly batchSize: number;
};

export type EnqueueOutcome = 'accepted' | 'queue-full' | 'shutting-down';

/** Runs import jobs in the background with bounded concurrency and a bounded backlog. */
export interface ImportJobQueue {
  enqueue(command: ImportJobCommand): EnqueueOutcome;
}
