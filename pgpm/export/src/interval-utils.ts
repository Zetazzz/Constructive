/**
 * Interval conversion utilities shared between graphql-naming.ts and tests.
 *
 * NOTE: @pgpmjs/csv-to-pg has its own formatInterval() in parse.ts which
 * performs the same object→string conversion. That is a separate package with
 * its own release cycle, so we do not cross-reference it here. If interval
 * handling needs to be unified across packages, that would require an
 * architectural change (shared dependency or monorepo util package).
 */

/** Shape of a PostGraphile Interval object (OBJECT type in introspection). */
export interface PgInterval {
  years: number | null;
  months: number | null;
  days: number | null;
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
}

/**
 * Convert a PostgreSQL interval object (from GraphQL Interval type) back to a
 * Postgres interval string.
 * e.g. { years: 0, months: 0, days: 0, hours: 1, minutes: 30, seconds: 0 } → '1:30:00'
 */
export const intervalToPostgres = (interval: Record<string, number | null> | null): string | null => {
  if (!interval) return null;
  const parts: string[] = [];
  if (interval.years) parts.push(`${interval.years} year${interval.years !== 1 ? 's' : ''}`);
  if (interval.months) parts.push(`${interval.months} mon${interval.months !== 1 ? 's' : ''}`);
  if (interval.days) parts.push(`${interval.days} day${interval.days !== 1 ? 's' : ''}`);
  if (interval.hours) parts.push(`${interval.hours}:${String(interval.minutes ?? 0).padStart(2, '0')}:${String(interval.seconds ?? 0).padStart(2, '0')}`);
  else if (interval.minutes) parts.push(`00:${String(interval.minutes).padStart(2, '0')}:${String(interval.seconds ?? 0).padStart(2, '0')}`);
  else if (interval.seconds) parts.push(`00:00:${String(interval.seconds).padStart(2, '0')}`);
  return parts.length > 0 ? parts.join(' ') : '00:00:00';
};

/**
 * Parse a PostgreSQL interval string into the object shape that PostGraphile's
 * Interval type returns: { years, months, days, hours, minutes, seconds }.
 *
 * Handles formats like:
 *   '30 days' → { years: 0, months: 0, days: 30, hours: 0, minutes: 0, seconds: 0 }
 *   '1:30:00'  → { years: 0, months: 0, days: 0, hours: 1, minutes: 30, seconds: 0 }
 */
export const parsePgInterval = (value: string): Record<string, number> => {
  const result = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

  // Try HH:MM:SS format
  const timeMatch = value.match(/^(\d+):(\d+):(\d+)/);
  if (timeMatch) {
    result.hours = parseInt(timeMatch[1], 10);
    result.minutes = parseInt(timeMatch[2], 10);
    result.seconds = parseInt(timeMatch[3], 10);
    return result;
  }

  // Try descriptive format: 'N unit N unit ...'
  const parts = value.trim().split(/\s+/);
  for (let i = 0; i < parts.length - 1; i += 2) {
    const num = parseInt(parts[i], 10);
    const unit = parts[i + 1].toLowerCase();
    if (unit.startsWith('year')) result.years = num;
    else if (unit.startsWith('mon')) result.months = num;
    else if (unit.startsWith('day')) result.days = num;
    else if (unit.startsWith('hour')) result.hours = num;
    else if (unit.startsWith('minute')) result.minutes = num;
    else if (unit.startsWith('second')) result.seconds = num;
  }

  return result;
};