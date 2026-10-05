import type { ImportStudentsOutput } from '@application/dtos/import-students.dto';

const RULE = '─'.repeat(36);
const LABEL_WIDTH = 18;
const VALUE_WIDTH = 16;

const formatNumber = (value: number): string => value.toLocaleString('en-US');

const line = (label: string, value: string): string =>
  `${`${label}:`.padEnd(LABEL_WIDTH)}${value.padStart(VALUE_WIDTH)}`;

/** Human-readable summary printed by the CLI after an import. */
export const formatImportSummary = (output: ImportStudentsOutput): string => {
  const title = output.aborted ? '⚠️  Import Aborted' : '✅ Import Complete';
  const lines = [
    title,
    RULE,
    line('Total processed', formatNumber(output.totalProcessed)),
    line('Total imported', formatNumber(output.totalImported)),
    line('Total errors', formatNumber(output.totalErrors)),
    line('Duration', `${(output.durationMs / 1000).toFixed(1)}s`),
    line('Peak memory', `${output.peakMemoryMB.toFixed(1)}MB`),
    line('Rows/second', formatNumber(output.rowsPerSecond)),
    RULE,
  ];
  if (output.errorReportPath !== null) {
    lines.push(`Error report: ${output.errorReportPath}`);
  }
  return `${lines.join('\n')}\n`;
};
