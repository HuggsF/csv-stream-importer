import { InvalidScoreError } from '@domain/errors/invalid-score.error';
import { Score } from '@domain/value-objects/score.value-object';

describe('Score', () => {
  it.each([
    [0, 0],
    [100, 100],
    [85.5, 85.5],
    [99.99, 99.99],
    ['0', 0],
    ['100.00', 100],
    [' 72.25 ', 72.25],
    ['85.50', 85.5],
    ['.5', 0.5],
    ['+42', 42],
  ])('accepts %p as %p', (raw, expected) => {
    const result = Score.create(raw);

    expect(result.success && result.data.value).toBe(expected);
  });

  it.each([-0.01, 100.01, -5, 101, '150', '-1'])('rejects out of range value %p', (raw) => {
    const result = Score.create(raw);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidScoreError);
      expect(result.error.message).toBe('Score must be between 0 and 100');
      expect(result.error.field).toBe('score');
    }
  });

  it.each([85.555, '72.123', '0.001'])('rejects more than two decimal places: %p', (raw) => {
    const result = Score.create(raw);

    expect(!result.success && result.error.message).toBe(
      'Score must have at most 2 decimal places',
    );
  });

  it.each(['abc', '12,5', '1e2', '85.5.1', 'NaN'])('rejects non-numeric text %p', (raw) => {
    const result = Score.create(raw);

    expect(!result.success && result.error.message).toBe('Score must be a number');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects non-finite number %p', (raw) => {
    const result = Score.create(raw);

    expect(!result.success && result.error.message).toBe('Score must be a number');
  });

  it('rejects an empty cell as required', () => {
    const result = Score.create('  ');

    expect(!result.success && result.error.message).toBe('Score is required');
  });

  it('keeps the raw value in the error for the report', () => {
    const result = Score.create('-3.5');

    expect(!result.success && result.error.value).toBe('-3.5');
  });

  it('formats with two decimals and compares by value', () => {
    const first = Score.create(7.5);
    const second = Score.create('7.50');

    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.toString()).toBe('7.50');
      expect(first.data.equals(second.data)).toBe(true);
      expect(Object.isFrozen(first.data)).toBe(true);
    }
  });
});
