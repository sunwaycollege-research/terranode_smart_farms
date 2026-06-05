import type { ReactNode } from 'react';

export interface Column<Row> {
  /** Header label. */
  header: ReactNode;
  /** Cell renderer for a row. */
  cell: (row: Row, index: number) => ReactNode;
  /** Optional fixed/min width. */
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export interface TableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = 'Nothing here yet.',
}: TableProps<Row>) {
  return (
    <div className="tn-table-wrap">
      <table className="tn-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  width: c.width,
                  textAlign: c.align ?? 'left',
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="tn-table__empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr
                key={rowKey(row, ri)}
                className={onRowClick ? 'tn-table__row--clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c, ci) => (
                  <td key={ci} style={{ textAlign: c.align ?? 'left' }}>
                    {c.cell(row, ri)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
