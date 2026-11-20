const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '•',
  copy: '©',
  hellip: '…',
  gt: '>',
  ldquo: '“',
  lt: '<',
  lsquo: '‘',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  trade: '™',
};

function decodeEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === '#') {
        const hex = name[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/** Convert source HTML, including escaped or double-escaped markup, to safe text. */
export function plainText(value: string | null | undefined, maxLength = 12_000): string {
  if (!value) return '';
  const text = decodeEntities(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|section|article|h[1-6]|ul|ol|blockquote)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

export function excerpt(value: string | null | undefined, maxLength: number): string {
  const text = plainText(value);
  if (text.length <= maxLength) return text;
  const prefix = text.slice(0, maxLength - 1);
  const boundary = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, boundary > maxLength * 0.4 ? boundary : prefix.length).trimEnd()}…`;
}
