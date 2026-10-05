export interface HealthIndicator {
  readonly name: string;
  /** Resolves when the dependency is reachable, rejects otherwise. */
  check(): Promise<void>;
}
