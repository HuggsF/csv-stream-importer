export interface PerformanceMonitor {
  /** Monotonic clock in milliseconds, suitable for measuring durations. */
  nowMs(): number;
  /** Current resident set size (RSS) of the process in megabytes. */
  memoryUsageMB(): number;
}
