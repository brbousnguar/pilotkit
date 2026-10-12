// Jira returns rich text as ADF (Atlassian Document Format) and Confluence as storage-format XHTML.
// Both are turned into short plain text with Markdown-ish marks before they reach the model:
// every character a tool returns is re-sent with every later model call, and billed.

export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  return block(node).replace(/\n{3,}/g, '\n\n').trim();
}

function inline(nodes = []) {
  return nodes.map(inlineNode).join('');
}

function inlineNode(n) {
  switch (n.type) {
    case 'text': {
      const link = n.marks?.find((m) => m.type === 'link')?.attrs?.href;
      const code = n.marks?.some((m) => m.type === 'code');
      let t = n.text ?? '';
      if (code) t = `\`${t}\``;
      return link && link !== t ? `[${t}](${link})` : t;
    }
    case 'hardBreak': return '\n';
    case 'mention': return n.attrs?.text ?? '@someone';
    case 'emoji': return n.attrs?.text ?? n.attrs?.shortName ?? '';
    case 'inlineCard':
    case 'blockCard': return n.attrs?.url ?? '';
    case 'status': return `[${n.attrs?.text ?? ''}]`;
    case 'date': return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : '';
    default: return n.content ? inline(n.content) : (n.text ?? '');
  }
}

function block(n, depth = 0) {
  const kids = (sep = '\n\n') => (n.content ?? []).map((c) => block(c, depth)).filter(Boolean).join(sep);
  switch (n.type) {
    case 'doc': return kids();
    case 'paragraph': return inline(n.content);
    case 'heading': return `${'#'.repeat(n.attrs?.level ?? 2)} ${inline(n.content)}`;
    case 'bulletList':
    case 'orderedList':
      return (n.content ?? []).map((item, i) => {
        const marker = n.type === 'orderedList' ? `${(n.attrs?.order ?? 1) + i}.` : '-';
        const body = (item.content ?? []).map((c) => block(c, depth + 1)).filter(Boolean).join('\n');
        return `${'  '.repeat(depth)}${marker} ${body.trimStart()}`;
      }).join('\n');
    case 'taskList':
      return (n.content ?? []).map((t) => `${'  '.repeat(depth)}- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(t.content)}`).join('\n');
    case 'codeBlock': return `\`\`\`${n.attrs?.language ?? ''}\n${inline(n.content)}\n\`\`\``;
    case 'blockquote': return kids('\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'panel': return kids('\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'rule': return '---';
    case 'table':
      return (n.content ?? []).map((row) => '| ' + (row.content ?? [])
        .map((cell) => (cell.content ?? []).map((c) => block(c, depth)).join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|'))
        .join(' | ') + ' |').join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media': return '[attachment]';
    case 'expand':
    case 'nestedExpand': return [n.attrs?.title, kids()].filter(Boolean).join('\n');
    default: return n.content ? kids() : inlineNode(n);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function storageToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/ac:structured-macro>/g,
    (_, code) => `\n\`\`\`\n${code}\n\`\`\`\n`);
  s = s.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/g, '');
  s = s.replace(/<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>/g, '$1');
  s = s.replace(/<ri:user[^>]*\/>/g, '@someone');
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => {
    const t = text.replace(/<[^>]+>/g, '').trim();
    return t && t !== href ? `[${t}](${href})` : href;
  });
  // A table cell holds paragraphs and line breaks; flatten each cell to one line so rows stay rows.
  s = s.replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g, (_, tag, attrs, inner) =>
    `<${tag}${attrs}>${inner.replace(/<(br|\/p|\/li)[^>]*>/g, ' ').replace(/<(?!\/?(strong|b|code|a)\b)[^>]+>/g, '').replace(/\s+/g, ' ').trim()}</${tag}>`);
  s = s.replace(/<h([1-6])[^>]*>/g, (_, l) => `\n\n${'#'.repeat(Number(l))} `).replace(/<\/h[1-6]>/g, '\n\n');
  s = s.replace(/<li[^>]*>/g, '\n- ').replace(/<\/(ul|ol)>/g, '\n');
  s = s.replace(/<(strong|b)>/g, '**').replace(/<\/(strong|b)>/g, '**');
  s = s.replace(/<code>/g, '`').replace(/<\/code>/g, '`');
  s = s.replace(/<\/t[dh]>\s*<t[dh][^>]*>/g, ' | ').replace(/<tr[^>]*>\s*<t[dh][^>]*>/g, '\n| ').replace(/<\/t[dh]>\s*<\/tr>/g, ' |');
  s = s.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|blockquote|pre|table)>/g, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function clip(s, n) {
  if (s == null) return '';
  return s.length > n ? `${s.slice(0, n)}\n…(cut at ${n} characters; ask for more if you need it)` : s;
}
