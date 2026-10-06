import { v4 as uuidv4 } from 'uuid';
import { UuidV7IdGenerator } from '@infrastructure/system/uuid-v7-id-generator';

describe('UUID v7 vs UUID v4 — Technical Properties & Monotonicity', () => {
  const generator = new UuidV7IdGenerator();

  describe('Lexicographical Monotonicity (B+ Tree Appending)', () => {
    it('guarantees strictly monotonic or non-decreasing chronological order for UUID v7', async () => {
      const count = 2000;
      const v7Ids: string[] = [];

      for (let i = 0; i < count; i++) {
        v7Ids.push(generator.generate());
        // Periodically tick time slightly to simulate sequential batch arrival
        if (i % 200 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }

      let v7Inversions = 0;
      for (let i = 0; i < v7Ids.length - 1; i++) {
        const current = v7Ids[i]!;
        const next = v7Ids[i + 1]!;
        if (current > next) {
          v7Inversions++;
        }
      }

      // UUID v7 must have ZERO order inversions: each key is >= preceding key
      expect(v7Inversions).toBe(0);
    });

    it('demonstrates that UUID v4 has near ~50% random order inversions (causing page splitting)', () => {
      const count = 2000;
      const v4Ids: string[] = [];

      for (let i = 0; i < count; i++) {
        v4Ids.push(uuidv4());
      }

      let v4Inversions = 0;
      for (let i = 0; i < v4Ids.length - 1; i++) {
        const current = v4Ids[i]!;
        const next = v4Ids[i + 1]!;
        if (current > next) {
          v4Inversions++;
        }
      }

      // In a uniform random distribution, approx 50% of consecutive pairs are inversions.
      // E.g., ~1,000 inversions out of 2,000 items.
      const inversionRate = v4Inversions / (count - 1);
      expect(inversionRate).toBeGreaterThan(0.4);
      expect(inversionRate).toBeLessThan(0.6);
    });
  });

  describe('RFC 9562 48-bit Unix Timestamp Encoding', () => {
    it('embeds the exact Unix epoch millisecond into the first 48 bits of UUID v7', () => {
      const beforeMs = Date.now();
      const id = generator.generate();
      const afterMs = Date.now();

      // Extract 48-bit timestamp from hexadecimal prefix (first 12 hex digits)
      const hexPrefix = id.replace(/-/g, '').slice(0, 12);
      const embeddedTimestampMs = parseInt(hexPrefix, 16);

      expect(embeddedTimestampMs).toBeGreaterThanOrEqual(beforeMs);
      expect(embeddedTimestampMs).toBeLessThanOrEqual(afterMs);
    });

    it('reflects temporal order: IDs generated in later moments are strictly greater', async () => {
      const firstId = generator.generate();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondId = generator.generate();

      expect(firstId < secondId).toBe(true);
    });
  });

  describe('High-frequency Generation & Uniqueness (Zero Database Round-trips)', () => {
    it('generates 10,000 unique IDs in the application without collisions or locks', () => {
      const count = 10_000;
      const ids = new Set<string>();

      for (let i = 0; i < count; i++) {
        ids.add(generator.generate());
      }

      expect(ids.size).toBe(count);
    });

    it('allows concurrent workers to generate non-colliding ordered IDs without coordination', async () => {
      const workerCount = 5;
      const perWorker = 1000;

      const results = await Promise.all(
        Array.from({ length: workerCount }, async () => {
          await Promise.resolve();
          const workerIds: string[] = [];
          for (let i = 0; i < perWorker; i++) {
            workerIds.push(generator.generate());
          }
          return workerIds;
        }),
      );

      const allIds = results.flat();
      const uniqueIds = new Set(allIds);

      expect(uniqueIds.size).toBe(workerCount * perWorker);
    });
  });
});
