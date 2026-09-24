import { convert } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike',
  'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'wbr',
];

const COMMON_ATTRS = ['style', 'class', 'dir', 'lang', 'title', 'align', 'valign', 'width', 'height', 'bgcolor', 'color'];

/**
 * Sanitizes inbound HTML mail. Scripts, forms, iframes, event handlers and javascript: URLs are removed.
 * Clients additionally render the result in a sandboxed frame / JS-disabled WebView.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': COMMON_ATTRS,
      a: ['href', 'name', 'target', 'rel', ...COMMON_ATTRS],
      img: ['src', 'alt', 'border', ...COMMON_ATTRS],
      font: ['face', 'size', ...COMMON_ATTRS],
      table: ['border', 'cellpadding', 'cellspacing', 'summary', ...COMMON_ATTRS],
      td: ['colspan', 'rowspan', 'nowrap', ...COMMON_ATTRS],
      th: ['colspan', 'rowspan', 'nowrap', 'scope', ...COMMON_ATTRS],
      col: ['span', ...COMMON_ATTRS],
      ol: ['start', 'type', ...COMMON_ATTRS],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
    },
    // Keep text content of dropped wrappers (e.g. <html>, <body>) but discard dangerous blocks entirely.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head', 'iframe', 'object', 'embed', 'svg', 'math'],
  });
}

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  }).trim();
}

/** A one-line preview: skips quoted reply history and collapses whitespace. */
export function makeSnippet(text: string, max = 180): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (line.trimStart().startsWith('>')) continue;
    kept.push(line);
  }
  const flat = kept.join(' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function replySubject(subject: string): string {
  const base = subject.replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}` : 'Re:';
}

/** Collapse CR/LF so user input can never inject extra headers. */
export const singleLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
