export type ParseErrorCode =
  | 'file_too_large'
  | 'unsupported_format'
  | 'legacy_xls'
  | 'corrupt_file'
  | 'empty_file'
  | 'password_protected'
  | 'zip_limits'
  | 'unsafe_archive'
  | 'timeout'
  | 'sheet_limits';

export class ParseError extends Error {
  constructor(public readonly code: ParseErrorCode) {
    super(code);
    this.name = 'ParseError';
  }
}
