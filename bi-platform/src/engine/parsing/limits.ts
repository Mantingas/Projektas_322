/** Hard limits applied to untrusted input. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS_PER_SHEET = 200_000;
export const MAX_COLUMNS = 200;
export const MAX_SHEETS = 50;
export const MAX_CELL_CHARS = 2000;
export const MAX_CELLS_PER_SHEET = 4_000_000;
/** Consecutive blank rows tolerated inside a sheet before the rest is treated as junk. */
export const MAX_ROW_GAP = 10_000;
