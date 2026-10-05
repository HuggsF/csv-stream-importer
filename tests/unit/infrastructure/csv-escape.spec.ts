import { escapeCsvValue } from '@infrastructure/filesystem/csv-error-report-writer';

describe('escapeCsvValue', () => {
  it.each([
    ['plain', 'plain'],
    [42, '42'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['multi\nline', '"multi\nline"'],
    ['-3', '-3'],
    ['85.5', '85.5'],
  ])('escapes %p as %p', (value, expected) => {
    expect(escapeCsvValue(value)).toBe(expected);
  });

  it.each(['=HYPERLINK("http://evil")', '+SUM(A1)', '@cmd', '-2+3'])(
    'neutralises spreadsheet formulas (CSV injection): %p',
    (value) => {
      expect(escapeCsvValue(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );
});
