/**
 * SQL builder utilities for bulk mutations.
 *
 * Provides parameterized SQL generation for VALUES clauses, ON CONFLICT
 * clauses, and SET patches. Handles auto-batching when the parameter
 * count would exceed PostgreSQL's 32K limit.
 */

import { PG_MAX_PARAMS } from '../types';

export interface ColumnSpec {
  name: string;
  sqlType: string;
}

export interface InsertBatch {
  text: string;
  values: unknown[];
}

/**
 * Builds parameterized INSERT ... VALUES SQL with optional ON CONFLICT clause.
 * Auto-splits into multiple batches when parameter count exceeds PG_MAX_PARAMS.
 */
export function buildBulkInsertSQL(
  tableName: string,
  columns: ColumnSpec[],
  rows: Record<string, unknown>[],
  onConflict?: {
    constraintName?: string;
    action: 'IGNORE';
  } | {
    constraintName: string;
    action: 'UPDATE';
    updateColumns?: string[];
  }
): InsertBatch[] {
  const colNames = columns.map((c) => `"${c.name}"`);
  const colsPerRow = columns.length;
  const maxRowsPerBatch = Math.floor(PG_MAX_PARAMS / colsPerRow);

  const batches: InsertBatch[] = [];
  for (let offset = 0; offset < rows.length; offset += maxRowsPerBatch) {
    const batchRows = rows.slice(offset, offset + maxRowsPerBatch);
    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];

    for (const row of batchRows) {
      const placeholders: string[] = [];
      for (const col of columns) {
        const val = row[col.name];
        if (val === undefined) {
          placeholders.push('DEFAULT');
        } else if (val === null) {
          placeholders.push('NULL');
        } else {
          values.push(val);
          placeholders.push(`$${values.length}::${col.sqlType}`);
        }
      }
      valuePlaceholders.push(`(${placeholders.join(', ')})`);
    }

    let text = `INSERT INTO ${tableName} (${colNames.join(', ')})\nVALUES ${valuePlaceholders.join(',\n       ')}`;

    if (onConflict) {
      if (onConflict.constraintName) {
        text += `\nON CONFLICT ON CONSTRAINT "${onConflict.constraintName}"`;
      } else {
        text += '\nON CONFLICT';
      }

      if (onConflict.action === 'IGNORE') {
        text += ' DO NOTHING';
      } else if (onConflict.action === 'UPDATE') {
        const setCols =
          onConflict.updateColumns && onConflict.updateColumns.length > 0
            ? onConflict.updateColumns
            : columns.map((c) => c.name);
        const setClause = setCols
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ');
        text += ` DO UPDATE SET ${setClause}`;
      }
    }

    text += '\nRETURNING *';

    batches.push({ text, values });
  }

  return batches;
}

/**
 * Builds a parameterized UPDATE ... SET ... WHERE SQL statement.
 */
export function buildBulkUpdateSQL(
  tableName: string,
  patch: Record<string, unknown>,
  columns: ColumnSpec[],
  whereClause: string,
  whereParams: unknown[]
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const setClauses: string[] = [];

  for (const [fieldName, value] of Object.entries(patch)) {
    const col = columns.find((c) => c.name === fieldName);
    if (!col) continue;
    if (value === undefined) continue;

    values.push(value);
    setClauses.push(`"${col.name}" = $${values.length}::${col.sqlType}`);
  }

  if (setClauses.length === 0) {
    throw new Error('No columns to update in patch');
  }

  // Renumber where params to follow set params
  const offset = values.length;
  const renumberedWhere = whereClause.replace(
    /\$(\d+)/g,
    (_, n) => `$${parseInt(n) + offset}`
  );
  values.push(...whereParams);

  const text = `UPDATE ${tableName}\nSET ${setClauses.join(', ')}\nWHERE ${renumberedWhere}\nRETURNING *`;

  return { text, values };
}

/**
 * Builds a parameterized DELETE ... WHERE SQL statement.
 */
export function buildBulkDeleteSQL(
  tableName: string,
  whereClause: string,
  whereParams: unknown[]
): { text: string; values: unknown[] } {
  const text = `DELETE FROM ${tableName}\nWHERE ${whereClause}\nRETURNING *`;
  return { text, values: [...whereParams] };
}
