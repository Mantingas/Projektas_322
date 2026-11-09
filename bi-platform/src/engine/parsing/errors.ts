export type ParseErrorCode =
  | 'file_too_large'
  | 'unsupported_format'
  | 'legacy_xls'
  | 'corrupt_file'
  | 'empty_file'
  | 'password_protected';

export class ParseError extends Error {
  constructor(public readonly code: ParseErrorCode) {
    super(code);
    this.name = 'ParseError';
  }
}
