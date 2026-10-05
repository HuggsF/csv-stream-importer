import type { ImportStudentsOutput } from '@application/dtos/import-students.dto';
import { formatImportSummary } from '@presentation/cli/import-summary.formatter';

const output: ImportStudentsOutput = {
  totalProcessed: 500_000,
  totalImported: 475_074,
  totalErrors: 24_926,
  errors: [],
  durationMs: 59_029,
  peakMemoryMB: 78.7,
  rowsPerSecond: 8470,
  errorReportPath: 'output/errors-2026.csv',
  aborted: false,
};

describe('formatImportSummary', () => {
  it('renders a readable summary with thousands separators', () => {
    const text = formatImportSummary(output);

    expect(text).toContain('✅ Import Complete');
    expect(text).toMatch(/Total processed:\s+500,000/);
    expect(text).toMatch(/Total imported:\s+475,074/);
    expect(text).toMatch(/Duration:\s+59\.0s/);
    expect(text).toMatch(/Peak memory:\s+78\.7MB/);
    expect(text).toMatch(/Rows\/second:\s+8,470/);
    expect(text).toContain('Error report: output/errors-2026.csv');
  });

  it('flags aborted imports and omits the report line when there were no errors', () => {
    const text = formatImportSummary({ ...output, aborted: true, errorReportPath: null });

    expect(text).toContain('Import Aborted');
    expect(text).not.toContain('Error report');
  });
});
