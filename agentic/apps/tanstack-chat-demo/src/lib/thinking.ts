const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export function splitThinking(raw: string): { thinking: string; answer: string } {
  if (!raw.includes(THINK_OPEN)) return { thinking: '', answer: raw };

  let thinking = '';
  let answer = '';
  let cursor = 0;

  while (cursor < raw.length) {
    const openAt = raw.indexOf(THINK_OPEN, cursor);
    if (openAt === -1) {
      answer += raw.slice(cursor);
      break;
    }
    answer += raw.slice(cursor, openAt);
    const contentStart = openAt + THINK_OPEN.length;
    const closeAt = raw.indexOf(THINK_CLOSE, contentStart);
    if (closeAt === -1) {
      if (thinking) thinking += '\n';
      thinking += raw.slice(contentStart);
      cursor = raw.length;
      break;
    }
    if (thinking) thinking += '\n';
    thinking += raw.slice(contentStart, closeAt);
    cursor = closeAt + THINK_CLOSE.length;
  }

  return {
    thinking: thinking.trim(),
    answer: answer.replace(/^\s+/, ''),
  };
}
