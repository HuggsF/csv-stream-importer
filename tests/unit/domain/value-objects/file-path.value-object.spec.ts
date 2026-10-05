import { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import { FilePath } from '@domain/value-objects/file-path.value-object';

describe('FilePath', () => {
  it.each(['./data/students.csv', '/tmp/UPLOAD.CSV', 'C:\\imports\\file.csv'])(
    'accepts %s',
    (raw) => {
      const result = FilePath.create(raw);

      expect(result.success && result.data.value).toBe(raw);
    },
  );

  it('trims surrounding whitespace', () => {
    const result = FilePath.create('  data/students.csv ');

    expect(result.success && result.data.toString()).toBe('data/students.csv');
  });

  it.each([
    ['', 'File path is required'],
    ['   ', 'File path is required'],
    ['data/students.xlsx', 'File must have a .csv extension'],
    ['data/students.csv.exe', 'File must have a .csv extension'],
    ['data/stu\0dents.csv', 'File path contains invalid characters'],
  ])('rejects %p', (raw, message) => {
    const result = FilePath.create(raw);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidFilePathError);
      expect(result.error.message).toBe(message);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    }
  });
});
