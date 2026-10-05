import { performance } from 'node:perf_hooks';
import type { PerformanceMonitor } from '@application/interfaces/performance-monitor';

const BYTES_PER_MB = 1024 * 1024;

export class ProcessPerformanceMonitor implements PerformanceMonitor {
  nowMs(): number {
    return performance.now();
  }

  memoryUsageMB(): number {
    return process.memoryUsage.rss() / BYTES_PER_MB;
  }
}
