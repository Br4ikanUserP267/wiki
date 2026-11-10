const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const seedPath = path.join(root, 'server', 'seed.json');

const chapters = [
  {
    number: 2,
    file: 'capitulo-02-diagnostico-institucional.docx',
    title: 'Conozcamos nuestra IPS: diagnóstico institucional',
    description: 'Identificar la institución, su población y sus recursos',
  },
  {
    number: 3,
    file: 'capitulo-03-sistema-unico-habilitacion.docx',
    title: 'Sistema Único de Habilitación',
    description: 'Comprender las condiciones mínimas para prestar servicios de salud',
  },
  {
    number: 4,
    file: 'capitulo-04-pamec.docx',
    title: 'PAMEC: mejoramiento continuo de la calidad',
    description: 'Aplicar la auditoría y el ciclo PHVA al mejoramiento institucional',
  },
  {
    number: 5,
    file: 'capitulo-05-sistema-unico-acreditacion.docx',
    title: 'Sistema Único de Acreditación',
    description: 'Avanzar desde el cumplimiento hacia niveles superiores de calidad',
  },
];

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inline(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => alt ? `[Figura: ${alt}]` : '[Figura del documento original]')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableToMarkdown(table) {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell =>
      inline(cell[1]).replace(/\|/g, '\\|').replace(/\n/g, ' ')
    )
  ).filter(row => row.length);

  if (!rows.length) return '';
  const width = Math.max(...rows.map(row => row.length));
  const normalized = rows.map(row => [...row, ...Array(width - row.length).fill('')]);
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function htmlToMarkdown(source) {
  const tables = [];
  let html = source.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, table => {
    tables.push(tableToMarkdown(table));
    return `<p>@@TABLE_${tables.length - 1}@@</p>`;
  });

  html = html
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, list) => {
      let index = 0;
      return [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(item => `${++index}. ${inline(item[1])}`).join('\n');
    })
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, list) =>
      [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(item => `- ${inline(item[1])}`).join('\n')
    )
    .replace(/<p[^>]*><strong>([\s\S]*?)<\/strong><\/p>/gi, (_, text) => `\n### ${inline(text)}\n`)
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, text) => `\n### ${inline(text)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${inline(text)}\n`)
    .replace(/<[^>]+>/g, '');

  html = decodeHtml(html).replace(/@@TABLE_(\d+)@@/g, (_, index) => tables[Number(index)]);
  return html.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitChapter(html, chapterNumber) {
  html = html.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<p><strong>$1</strong></p>');
  const marker = new RegExp(
    `<p[^>]*><strong>(${chapterNumber}\\.(\\d+)\\.?)\\s+([\\s\\S]*?)<\\/strong><\\/p>`,
    'gi'
  );
  const matches = [...html.matchAll(marker)];
  if (!matches.length) throw new Error(`No se encontraron secciones del capítulo ${chapterNumber}.`);

  const introHtml = html.slice(0, matches[0].index)
    .replace(/^<p><strong>CAPÍTULO[\s\S]*?<\/strong><\/p>/i, '')
    .replace(/^<p><strong>Introducción<\/strong><\/p>/i, '');

  const sections = [{
    code: 'Intro',
    title: 'Introducción',
    bullets: [],
    body: htmlToMarkdown(introHtml),
  }];

  matches.forEach((match, index) => {
    const code = match[1].replace(/\.$/, '');
    const title = inline(match[3]);
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? html.length;
    sections.push({ code, title, bullets: [], body: htmlToMarkdown(html.slice(start, end)) });
  });

  return sections;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  for (const chapter of chapters) {
    const filePath = path.join(docsDir, chapter.file);
    if (!fs.existsSync(filePath)) throw new Error(`Falta el documento: docs/${chapter.file}`);
    const result = await mammoth.convertToHtml({ path: filePath });
    const sections = splitChapter(result.value, chapter.number);
    seed[chapter.number - 1] = {
      t: chapter.title,
      d: chapter.description,
      note: '',
      s: sections,
    };
    console.log(`Capítulo ${chapter.number}: ${sections.length} secciones sincronizadas.`);
  }

  fs.writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  console.log('server/seed.json actualizado.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
