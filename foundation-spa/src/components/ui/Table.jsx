import { useState, useCallback } from 'react';

export default function Table({
  columns,
  data,
  sortable = true,
  defaultSort,
  defaultSortDir = 'asc',
  onRowClick,
  emptyMessage = 'No data',
  mobileCardRender,
  className = '',
}) {
  const [sortKey, setSortKey] = useState(defaultSort || null);
  const [sortDir, setSortDir] = useState(defaultSortDir);

  const handleSort = useCallback((key) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey, sortable]);

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : data;

  return (
    <>
      <div className={`rso-table-wrap${className ? ` ${className}` : ''}`}>
        {sorted.length === 0 ? (
          <div className="rso-empty">
            <div className="rso-empty-icon">📋</div>
            <div className="rso-empty-sub">{emptyMessage}</div>
          </div>
        ) : (
          <table className="rso-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`${sortable && col.sortable !== false ? 'sortable' : ''}${col.sticky ? ' sticky' : ''}`}
                    onClick={sortable && col.sortable !== false ? () => handleSort(col.key) : undefined}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.label}
                    {sortable && col.sortable !== false && (
                      <span className={`sort-arrow${sortKey === col.key ? ' active' : ''}`}>
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.id || i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.sticky ? 'sticky' : ''}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile card fallback */}
      <div className="rso-table-cards">
        {sorted.length === 0 ? (
          <div className="rso-empty">
            <div className="rso-empty-sub">{emptyMessage}</div>
          </div>
        ) : (
          sorted.map((row, i) =>
            mobileCardRender ? (
              <div key={row.id || i} className="rso-table-card" onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {mobileCardRender(row)}
              </div>
            ) : (
              <div key={row.id || i} className="rso-table-card" onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((col) => (
                  <div key={col.key} className="rso-table-card-row">
                    <span className="rso-table-card-label">{col.label}</span>
                    <span>{col.render ? col.render(row[col.key], row) : row[col.key]}</span>
                  </div>
                ))}
              </div>
            )
          )
        )}
      </div>
    </>
  );
}
