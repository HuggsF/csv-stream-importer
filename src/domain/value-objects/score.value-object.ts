import { InvalidScoreError } from '@domain/errors/invalid-score.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** Plain decimal notation only: no exponents, no thousands separators, no locale commas. */
const DECIMAL_NOTATION = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const FLOAT_TOLERANCE = 1e-9;

export class Score {
  static readonly MIN = 0;
  static readonly MAX = 100;
  static readonly MAX_DECIMAL_PLACES = 2;

  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  /** Accepts a number or its textual form as read from a CSV cell. */
  static create(raw: number | string): Result<Score, InvalidScoreError> {
    const rawText = String(raw);
    const parsed = Score.parse(raw);

    if (parsed === null) {
      return fail(
        new InvalidScoreError(
          rawText,
          typeof raw === 'string' && raw.trim() === ''
            ? 'Score is required'
            : 'Score must be a number',
        ),
      );
    }
    if (parsed < Score.MIN || parsed > Score.MAX) {
      return fail(
        new InvalidScoreError(rawText, `Score must be between ${Score.MIN} and ${Score.MAX}`),
      );
    }

    const scaled = parsed * 10 ** Score.MAX_DECIMAL_PLACES;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > FLOAT_TOLERANCE * Math.max(1, Math.abs(scaled))) {
      return fail(
        new InvalidScoreError(
          rawText,
          `Score must have at most ${Score.MAX_DECIMAL_PLACES} decimal places`,
        ),
      );
    }

    return ok(new Score(rounded / 10 ** Score.MAX_DECIMAL_PLACES));
  }

  private static parse(raw: number | string): number | null {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw : null;
    }
    const trimmed = raw.trim();
    return DECIMAL_NOTATION.test(trimmed) ? Number(trimmed) : null;
  }

  equals(other: Score): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value.toFixed(Score.MAX_DECIMAL_PLACES);
  }
}
