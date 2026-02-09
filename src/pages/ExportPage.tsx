import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import { ArrowLeft, Download, FileText, ImageOff, X } from 'lucide-react';
import { Button } from '@components/Button';
import { chapterApi, projectApi, systemApi } from '@services/api';
import { useAppStore } from '@store/index';
import type { Chapter, Project, SystemFontOption } from '@typings/index';
import { tx } from '@utils/i18n';

interface CoverImageItem {
  id: string;
  imageBase64: string;
}

interface IllustrationItem {
  id: string;
  anchorIndex: number;
  imageBase64: string;
}

interface ChapterRenderData {
  chapter: Chapter;
  displayTitle: string;
  isPrologue: boolean;
  summary: string | null;
  paragraphs: string[];
  chapterCover: string | null;
  illustrations: IllustrationItem[];
}

interface TocItem {
  label: string;
  page: number;
}

interface PageMargin {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ImageMeta {
  width: number;
  height: number;
  format: 'PNG' | 'JPEG';
}

type PdfWithLink = jsPDF & {
  link: (x: number, y: number, width: number, height: number, options: { pageNumber: number; top: number }) => void;
};

const fontBase64Cache = new Map<string, string>();

interface ExportPageProgress {
  exportFormat: ExportFormat;
  includeNovelCover: boolean;
  includeChapterCover: boolean;
  includeParagraphIllustrations: boolean;
  selectedFontKey: string;
  removedIllustrationIds: string[];
}

type ExportFormat = 'pdf' | 'txt' | 'epub' | 'mobi';

function getExportProgressStorageKey(projectId: string): string {
  return `novelseek-export-progress:${projectId}`;
}

function loadExportProgress(projectId: string): ExportPageProgress | null {
  try {
    const raw = localStorage.getItem(getExportProgressStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExportPageProgress>;
    const exportFormat =
      parsed.exportFormat === 'txt' || parsed.exportFormat === 'epub' || parsed.exportFormat === 'mobi'
        ? parsed.exportFormat
        : 'pdf';
    return {
      exportFormat,
      includeNovelCover: parsed.includeNovelCover !== false,
      includeChapterCover: parsed.includeChapterCover !== false,
      includeParagraphIllustrations: parsed.includeParagraphIllustrations !== false,
      selectedFontKey: typeof parsed.selectedFontKey === 'string' ? parsed.selectedFontKey : '',
      removedIllustrationIds: Array.isArray(parsed.removedIllustrationIds)
        ? parsed.removedIllustrationIds.filter((item): item is string => typeof item === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function saveExportProgress(projectId: string, progress: ExportPageProgress): void {
  try {
    localStorage.setItem(getExportProgressStorageKey(projectId), JSON.stringify(progress));
  } catch {
    // Ignore storage write failures to avoid blocking export flow.
  }
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function uint16LE(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function downloadBytes(fileName: string, bytes: Uint8Array, mimeType: string): void {
  const normalized = new Uint8Array(bytes.length);
  normalized.set(bytes);
  const blob = new Blob([normalized.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInputFile {
  path: string;
  data: Uint8Array;
}

function buildStoredZip(files: ZipInputFile[]): Uint8Array {
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const fileNameBytes = encodeUtf8(file.path);
    const checksum = crc32(file.data);

    const localHeader = concatBytes([
      uint32LE(0x04034b50),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(checksum),
      uint32LE(file.data.length),
      uint32LE(file.data.length),
      uint16LE(fileNameBytes.length),
      uint16LE(0),
      fileNameBytes,
      file.data,
    ]);
    localRecords.push(localHeader);

    const centralHeader = concatBytes([
      uint32LE(0x02014b50),
      uint16LE(20),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(checksum),
      uint32LE(file.data.length),
      uint32LE(file.data.length),
      uint16LE(fileNameBytes.length),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(0),
      uint32LE(offset),
      fileNameBytes,
    ]);
    centralRecords.push(centralHeader);

    offset += localHeader.length;
  }

  const centralDirectory = concatBytes(centralRecords);
  const endRecord = concatBytes([
    uint32LE(0x06054b50),
    uint16LE(0),
    uint16LE(0),
    uint16LE(files.length),
    uint16LE(files.length),
    uint32LE(centralDirectory.length),
    uint32LE(offset),
    uint16LE(0),
  ]);

  return concatBytes([...localRecords, centralDirectory, endRecord]);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim();
}

function splitParagraphs(text?: string | null): string[] {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCoverImages(raw: string | null | undefined): CoverImageItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => {
        if (typeof item === 'string') {
          return {
            id: `cover-${index + 1}`,
            imageBase64: item,
          };
        }
        if (!item || typeof item !== 'object') return null;
        const rawItem = item as Record<string, unknown>;
        const imageBase64 =
          (rawItem.imageBase64 as string | undefined) ||
          (rawItem.image_base64 as string | undefined) ||
          (rawItem.image as string | undefined) ||
          (rawItem.base64 as string | undefined);
        if (!imageBase64 || typeof imageBase64 !== 'string') return null;
        return {
          id: typeof rawItem.id === 'string' && rawItem.id ? rawItem.id : `cover-${index + 1}`,
          imageBase64,
        };
      })
      .filter(Boolean) as CoverImageItem[];
  } catch {
    return [];
  }
}

function parseIllustrations(raw: string | null | undefined, chapterId: string): IllustrationItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const rawItem = item as Record<string, unknown>;
        const imageBase64 = typeof rawItem.imageBase64 === 'string' ? rawItem.imageBase64 : '';
        if (!imageBase64) return null;
        const anchorIndex = Number(rawItem.anchorIndex) || 1;
        return {
          id:
            typeof rawItem.id === 'string' && rawItem.id
              ? `${chapterId}:${rawItem.id}`
              : `${chapterId}:illustration-${index + 1}`,
          anchorIndex: Math.max(1, anchorIndex),
          imageBase64,
        };
      })
      .filter(Boolean) as IllustrationItem[];
  } catch {
    return [];
  }
}

function toSafeFileName(name: string): string {
  const normalized = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return normalized || 'novel';
}

function getContentLanguage(project: Project | null | undefined): 'zh' | 'en' {
  return project?.language === 'en' ? 'en' : 'zh';
}

function isPrologueChapter(chapter: Chapter): boolean {
  const normalizedTitle = chapter.title.trim().toLowerCase();
  return chapter.order_index === 0 || chapter.title.trim() === '序章' || normalizedTitle === 'prologue';
}

function getChapterDisplayTitle(chapter: Chapter, contentLanguage: 'zh' | 'en'): string {
  if (isPrologueChapter(chapter)) {
    return contentLanguage === 'en' ? 'Prologue' : '序章';
  }
  return contentLanguage === 'en'
    ? `Chapter ${chapter.order_index} ${chapter.title}`
    : `第${chapter.order_index}章 ${chapter.title}`;
}

function ensureDataImage(image: string): string {
  if (!image) return image;
  if (image.startsWith('data:image/')) return image;
  return `data:image/png;base64,${image}`;
}

async function getFontBase64(fileName: string): Promise<string> {
  const cached = fontBase64Cache.get(fileName);
  if (cached) return cached;
  const base64 = await systemApi.getSystemFontBase64(fileName);
  fontBase64Cache.set(fileName, base64);
  return base64;
}

function fillPageWhite(pdf: jsPDF, pageWidth: number, pageHeight: number): void {
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');
}

function normalizeImageFormat(fileType: string | undefined): 'PNG' | 'JPEG' {
  const normalized = (fileType || '').toUpperCase();
  if (normalized.includes('JP')) return 'JPEG';
  return 'PNG';
}

function getImageMeta(pdf: jsPDF, image: string): ImageMeta | null {
  try {
    const properties = pdf.getImageProperties(image);
    const width = Number(properties.width || 0);
    const height = Number(properties.height || 0);
    if (!width || !height) return null;
    return {
      width,
      height,
      format: normalizeImageFormat(properties.fileType),
    };
  } catch {
    return null;
  }
}

function drawContainedImage(
  pdf: jsPDF,
  image: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number
): number {
  const meta = getImageMeta(pdf, image);
  if (!meta) return 0;

  const widthScale = maxWidth / meta.width;
  const heightScale = maxHeight / meta.height;
  const scale = Math.min(widthScale, heightScale, 1);
  const renderWidth = meta.width * scale;
  const renderHeight = meta.height * scale;
  const renderX = x + (maxWidth - renderWidth) / 2;

  pdf.addImage(image, meta.format, renderX, y, renderWidth, renderHeight, undefined, 'FAST');
  return renderHeight;
}

function truncateByWidth(pdf: jsPDF, text: string, maxWidth: number): string {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  const ellipsis = '…';
  let truncated = text;
  while (truncated.length > 1 && pdf.getTextWidth(`${truncated}${ellipsis}`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}${ellipsis}`;
}

function buildDottedLeader(pdf: jsPDF, width: number): string {
  const dot = '.';
  const dotWidth = Math.max(1, pdf.getTextWidth(dot));
  const count = Math.max(0, Math.floor(width / dotWidth));
  return dot.repeat(count);
}

function getTocEntriesPerPage(pageHeight: number, startY: number, lineHeight: number, bottomMargin: number): number {
  const usableHeight = pageHeight - startY - bottomMargin;
  return Math.max(1, Math.floor(usableHeight / lineHeight));
}

function getNormalizedSummary(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const cleaned = stripMarkdown(summary).trim();
  return cleaned || null;
}

function getDisplayPageNumber(realPage: number, tocStartPage: number): number {
  return Math.max(1, realPage - tocStartPage + 1);
}

const FORBIDDEN_LINE_START_PUNCTUATION = new Set([
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  '）',
  '】',
  '》',
  '」',
  '』',
  '”',
  '’',
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '%',
  '‰',
  '…',
]);

function normalizeParagraphForWrap(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+/g, '').trim();
}

function getCharWrapUnit(char: string): number {
  if (char === ' ') return 0.3;
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(char)) return 1;
  if (/[A-Za-z0-9]/.test(char)) return 0.55;
  if (FORBIDDEN_LINE_START_PUNCTUATION.has(char)) return 0.7;
  return 0.9;
}

function estimateLineUnitLimit(pdf: jsPDF, maxWidth: number): number {
  const measuredWidth = pdf.getTextWidth('汉');
  if (Number.isFinite(measuredWidth) && measuredWidth > 2 && measuredWidth < 24) {
    const estimated = Math.floor(maxWidth / measuredWidth);
    if (estimated >= 24 && estimated <= 140) {
      return estimated;
    }
  }
  return Math.max(24, Math.floor(maxWidth / 7));
}

function wrapParagraphForPdf(pdf: jsPDF, text: string, maxWidth: number): string[] {
  const content = normalizeParagraphForWrap(text);
  const indent = '　　';
  if (!content) return [indent];

  const lineUnitLimit = estimateLineUnitLimit(pdf, maxWidth);
  const lines: string[] = [];
  let currentLine = indent;
  let currentUnits = 2;

  for (const char of content) {
    if (char === '\r' || char === '\n') continue;
    const unit = getCharWrapUnit(char);

    if (currentUnits + unit <= lineUnitLimit) {
      currentLine += char;
      currentUnits += unit;
      continue;
    }

    if (FORBIDDEN_LINE_START_PUNCTUATION.has(char)) {
      currentLine += char;
      lines.push(currentLine);
      currentLine = '';
      currentUnits = 0;
      continue;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    if (char === ' ') {
      currentLine = '';
      currentUnits = 0;
    } else {
      currentLine = char;
      currentUnits = unit;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [indent];
}

function buildTextExportContent(
  project: Project,
  chapters: ChapterRenderData[],
  contentLanguage: 'zh' | 'en'
): string {
  const lines: string[] = [];
  lines.push(project.title);
  if (project.author) lines.push(contentLanguage === 'en' ? `Author: ${project.author}` : `作者：${project.author}`);
  if (project.genre) lines.push(contentLanguage === 'en' ? `Genre: ${project.genre}` : `类型：${project.genre}`);
  lines.push('');
  lines.push('====================');
  lines.push('');

  if (chapters.length === 0) {
    lines.push(contentLanguage === 'en' ? '(No chapters to export)' : '（暂无可导出章节）');
    return lines.join('\n');
  }

  for (const item of chapters) {
    lines.push(item.displayTitle);
    if (!item.isPrologue && item.summary) {
      lines.push(contentLanguage === 'en' ? `Summary: ${item.summary}` : `摘要：${item.summary}`);
    }
    lines.push('');

    if (item.paragraphs.length === 0) {
      lines.push(contentLanguage === 'en' ? '(No chapter content yet)' : '（本章节暂无正文内容）');
      lines.push('');
      continue;
    }

    for (const paragraph of item.paragraphs) {
      lines.push(paragraph);
      lines.push('');
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function buildEpubBinary(
  project: Project,
  chapters: ChapterRenderData[],
  contentLanguage: 'zh' | 'en'
): Uint8Array {
  const identifier = escapeXml(project.id || `novelseek-${Date.now()}`);
  const title = escapeXml(project.title || (contentLanguage === 'en' ? 'Untitled Novel' : '未命名小说'));
  const author = escapeXml(project.author?.trim() || (contentLanguage === 'en' ? 'Unknown Author' : '未知作者'));
  const genre = project.genre?.trim() ? escapeXml(project.genre.trim()) : '';
  const langCode = contentLanguage === 'en' ? 'en-US' : 'zh-CN';
  const authorLabel = contentLanguage === 'en' ? 'Author' : '作者';
  const genreLabel = contentLanguage === 'en' ? 'Genre' : '类型';
  const summaryLabel = contentLanguage === 'en' ? 'Summary' : '摘要';
  const noContentLabel = contentLanguage === 'en' ? '(No chapter content yet)' : '（本章节暂无正文内容）';
  const bookInfoLabel = contentLanguage === 'en' ? 'Book Info' : '书籍信息';
  const tocLabel = contentLanguage === 'en' ? 'Contents' : '目录';
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const chapterFiles = chapters.map((item, index) => {
    const chapterTitle = escapeXml(item.displayTitle);
    const summaryBlock = !item.isPrologue && item.summary
      ? `<p class="summary">${summaryLabel}: ${escapeXml(item.summary)}</p>`
      : '';
    const bodyParagraphs =
      item.paragraphs.length === 0
        ? `<p>${noContentLabel}</p>`
        : item.paragraphs.map((paragraph) => `<p>${escapeXml(paragraph)}</p>`).join('\n');
    const fileName = `chapter-${index + 1}.xhtml`;

    const content = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${langCode}" lang="${langCode}">
  <head>
    <meta charset="utf-8" />
    <title>${chapterTitle}</title>
    <style>
      body { margin: 6%; line-height: 1.85; font-size: 1em; }
      h1 { margin: 0 0 1.5em 0; font-size: 1.45em; }
      p { margin: 0 0 1em 0; text-indent: 2em; }
      .summary { text-indent: 0; font-size: 0.95em; color: #444; margin-bottom: 1.5em; }
    </style>
  </head>
  <body>
    <h1>${chapterTitle}</h1>
    ${summaryBlock}
    ${bodyParagraphs}
  </body>
</html>`;

    return {
      id: `chapter-${index + 1}`,
      href: fileName,
      title: item.displayTitle,
      content,
    };
  });

  const titlePage = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${langCode}" lang="${langCode}">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { margin: 10% 8%; text-align: center; line-height: 1.8; }
      h1 { font-size: 2em; margin-bottom: 1.5em; }
      p { margin: 0.45em 0; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${authorLabel}: ${author}</p>
    ${genre ? `<p>${genreLabel}: ${genre}</p>` : ''}
  </body>
</html>`;

  const navEntries = [
    `<li><a href="title.xhtml">${bookInfoLabel}</a></li>`,
    ...chapterFiles.map((item) => `<li><a href="${item.href}">${escapeXml(item.title)}</a></li>`),
  ].join('\n');

  const navDocument = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}" lang="${langCode}">
  <head>
    <meta charset="utf-8" />
    <title>${tocLabel}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${tocLabel}</h1>
      <ol>
        ${navEntries}
      </ol>
    </nav>
  </body>
</html>`;

  const navPoints = [
    `<navPoint id="navpoint-title" playOrder="1">
  <navLabel><text>${bookInfoLabel}</text></navLabel>
  <content src="title.xhtml"/>
</navPoint>`,
    ...chapterFiles.map(
      (item, index) => `<navPoint id="navpoint-${index + 2}" playOrder="${index + 2}">
  <navLabel><text>${escapeXml(item.title)}</text></navLabel>
  <content src="${item.href}"/>
</navPoint>`
    ),
  ].join('\n');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${identifier}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;

  const manifestItems = [
    '<item id="title-page" href="title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    ...chapterFiles.map(
      (item) => `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n    ');

  const spineItems = [
    '<itemref idref="title-page"/>',
    ...chapterFiles.map((item) => `<itemref idref="${item.id}"/>`),
  ].join('\n    ');

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="${langCode}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${langCode}</dc:language>
    <meta property="dcterms:modified">${generatedAt}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const files: ZipInputFile[] = [
    { path: 'mimetype', data: encodeUtf8('application/epub+zip') },
    { path: 'META-INF/container.xml', data: encodeUtf8(containerXml) },
    { path: 'OEBPS/content.opf', data: encodeUtf8(contentOpf) },
    { path: 'OEBPS/toc.ncx', data: encodeUtf8(tocNcx) },
    { path: 'OEBPS/nav.xhtml', data: encodeUtf8(navDocument) },
    { path: 'OEBPS/title.xhtml', data: encodeUtf8(titlePage) },
    ...chapterFiles.map((item) => ({
      path: `OEBPS/${item.href}`,
      data: encodeUtf8(item.content),
    })),
  ];

  return buildStoredZip(files);
}

export function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { uiLanguage, promoByChapter } = useAppStore((state) => ({
    uiLanguage: state.uiLanguage,
    promoByChapter: state.promoByChapter,
  }));

  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [fontOptions, setFontOptions] = useState<SystemFontOption[]>([]);
  const [selectedFontKey, setSelectedFontKey] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeNovelCover, setIncludeNovelCover] = useState(true);
  const [includeChapterCover, setIncludeChapterCover] = useState(true);
  const [includeParagraphIllustrations, setIncludeParagraphIllustrations] = useState(true);
  const [removedIllustrationIds, setRemovedIllustrationIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [isProgressHydrated, setIsProgressHydrated] = useState(false);
  const contentLanguage = useMemo(() => getContentLanguage(project), [project]);

  useEffect(() => {
    if (!id) return;
    const progress = loadExportProgress(id);
    if (progress) {
      setExportFormat(progress.exportFormat);
      setIncludeNovelCover(progress.includeNovelCover);
      setIncludeChapterCover(progress.includeChapterCover);
      setIncludeParagraphIllustrations(progress.includeParagraphIllustrations);
      setRemovedIllustrationIds(new Set(progress.removedIllustrationIds));
      setSelectedFontKey(progress.selectedFontKey);
    } else {
      setExportFormat('pdf');
      setIncludeNovelCover(true);
      setIncludeChapterCover(true);
      setIncludeParagraphIllustrations(true);
      setRemovedIllustrationIds(new Set());
      setSelectedFontKey('');
    }

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setIsProgressHydrated(false);
      try {
        const [projectData, chapterData] = await Promise.all([
          projectApi.getById(id),
          chapterApi.getByProject(id),
        ]);
        if (!projectData) {
          setError(tx(uiLanguage, '项目不存在', 'Project not found'));
          setProject(null);
          setChapters([]);
          return;
        }
        setProject(projectData);
        setChapters([...chapterData].sort((a, b) => a.order_index - b.order_index));

        try {
          const fonts = await systemApi.listSystemFonts();
          setFontOptions(fonts);
          setSelectedFontKey((previousKey) => {
            const preferred = progress?.selectedFontKey || previousKey;
            if (preferred && fonts.some((font) => font.key === preferred)) return preferred;
            return fonts[0]?.key || '';
          });
        } catch (fontError) {
          const fontMessage =
            typeof fontError === 'string'
              ? fontError
              : (fontError as Error)?.message || tx(uiLanguage, '获取系统字体列表失败', 'Failed to load system font list');
          setFontOptions([]);
          setSelectedFontKey('');
          setError(fontMessage);
        }
      } catch (loadError) {
        const message =
          typeof loadError === 'string'
            ? loadError
            : (loadError as Error)?.message || tx(uiLanguage, '加载导出数据失败', 'Failed to load export data');
        setError(message);
      } finally {
        setLoading(false);
        setIsProgressHydrated(true);
      }
    };

    loadData();
  }, [id]);

  useEffect(() => {
    if (!id || !isProgressHydrated) return;
    saveExportProgress(id, {
      exportFormat,
      includeNovelCover,
      includeChapterCover,
      includeParagraphIllustrations,
      selectedFontKey,
      removedIllustrationIds: [...removedIllustrationIds],
    });
  }, [
    id,
    isProgressHydrated,
    exportFormat,
    includeNovelCover,
    includeChapterCover,
    includeParagraphIllustrations,
    selectedFontKey,
    removedIllustrationIds,
  ]);

  const projectCover = useMemo(() => {
    if (!project) return null;
    const covers = normalizeCoverImages(project.cover_images);
    if (covers.length === 0) return null;
    if (project.default_cover_id) {
      const found = covers.find((item) => item.id === project.default_cover_id);
      if (found) return ensureDataImage(found.imageBase64);
    }
    return ensureDataImage(covers[0].imageBase64);
  }, [project]);

  const chapterRenderData = useMemo<ChapterRenderData[]>(() => {
    return chapters.map((chapter) => {
      const promo = promoByChapter[chapter.id];
      const summary = !isPrologueChapter(chapter) ? getNormalizedSummary(promo?.summary) : null;
      const chapterCover = promo?.imageBase64 ? ensureDataImage(promo.imageBase64) : null;
      const paragraphs = splitParagraphs(chapter.final_text || chapter.draft_text);
      const paragraphCount = Math.max(1, paragraphs.length);
      const illustrations = parseIllustrations(chapter.illustrations, chapter.id)
        .filter((item) => !removedIllustrationIds.has(item.id))
        .map((item) => ({
          ...item,
          anchorIndex: Math.min(item.anchorIndex, paragraphCount),
          imageBase64: ensureDataImage(item.imageBase64),
        }));

      return {
        chapter,
        displayTitle: getChapterDisplayTitle(chapter, contentLanguage),
        isPrologue: isPrologueChapter(chapter),
        summary,
        paragraphs,
        chapterCover,
        illustrations,
      };
    });
  }, [chapters, promoByChapter, removedIllustrationIds, contentLanguage]);

  const isTextOnlyFormat = exportFormat !== 'pdf';

  useEffect(() => {
    if (chapters.length === 0) return;
    const validIds = new Set<string>();
    for (const chapter of chapters) {
      const illustrations = parseIllustrations(chapter.illustrations, chapter.id);
      for (const illustration of illustrations) {
        validIds.add(illustration.id);
      }
    }

    setRemovedIllustrationIds((previous) => {
      const filtered = [...previous].filter((idItem) => validIds.has(idItem));
      if (filtered.length === previous.size) return previous;
      return new Set(filtered);
    });
  }, [chapters]);

  const handleRemoveIllustration = (illustrationId: string) => {
    setRemovedIllustrationIds((prev) => {
      const next = new Set(prev);
      next.add(illustrationId);
      return next;
    });
  };

  const handleResetRemovedIllustrations = () => {
    setRemovedIllustrationIds(new Set());
  };

  const exportTextOnlyFile = async (targetFormat: 'txt' | 'mobi') => {
    if (!project) return;
    setExporting(true);
    setError(null);
    try {
      const content = buildTextExportContent(project, chapterRenderData, contentLanguage);
      const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const bytes = concatBytes([utf8Bom, encodeUtf8(content)]);
      const fileName = `${toSafeFileName(project.title)}_export.${targetFormat}`;
      const mimeType =
        targetFormat === 'txt' ? 'text/plain;charset=utf-8' : 'application/x-mobipocket-ebook;charset=utf-8';
      downloadBytes(fileName, bytes, mimeType);
    } catch (exportError) {
      const message =
        typeof exportError === 'string'
          ? exportError
          : (exportError as Error)?.message || tx(uiLanguage, `${targetFormat.toUpperCase()} 导出失败`, `${targetFormat.toUpperCase()} export failed`);
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportEpub = async () => {
    if (!project) return;
    setExporting(true);
    setError(null);
    try {
      const epubBytes = buildEpubBinary(project, chapterRenderData, contentLanguage);
      const fileName = `${toSafeFileName(project.title)}_export.epub`;
      downloadBytes(fileName, epubBytes, 'application/epub+zip');
    } catch (exportError) {
      const message =
        typeof exportError === 'string'
          ? exportError
          : (exportError as Error)?.message || tx(uiLanguage, 'EPUB 导出失败', 'EPUB export failed');
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!project) return;
    setExporting(true);
    setError(null);

    try {
      const fontOption = fontOptions.find((item) => item.key === selectedFontKey) || fontOptions[0];
      if (!fontOption) {
        throw new Error(tx(uiLanguage, '未找到可用系统字体，请先安装中文字体', 'No usable system font found. Install a font and retry.'));
      }
      const authorLabel = contentLanguage === 'en' ? 'Author' : '作者';
      const genreLabel = contentLanguage === 'en' ? 'Genre' : '类型';
      const summaryLabel = contentLanguage === 'en' ? 'Summary' : '摘要';
      const noChapterContentLabel = contentLanguage === 'en' ? '(No chapter content yet)' : '（本章节暂无正文内容）';
      const tocLabel = contentLanguage === 'en' ? 'Contents' : '目录';

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: 'a4',
        compress: true,
        putOnlyUsedFonts: true,
      });

      const fontBase64 = await getFontBase64(fontOption.fileName);
      pdf.addFileToVFS(fontOption.fileName, fontBase64);
      pdf.addFont(fontOption.fileName, fontOption.pdfFamily, 'normal');
      pdf.setFont(fontOption.pdfFamily, 'normal');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin: PageMargin = {
        left: 56,
        right: 56,
        top: 64,
        bottom: 60,
      };
      const contentWidth = pageWidth - margin.left - margin.right;

      const hasCoverPage = includeNovelCover && !!projectCover;
      const tocLineHeight = 24;
      const tocTitleY = margin.top;
      const tocListStartY = tocTitleY + 44;
      const tocEntriesPerPage = getTocEntriesPerPage(pageHeight, tocListStartY, tocLineHeight, margin.bottom);
      const tocItemCount = chapterRenderData.length;
      const tocPageCount = Math.max(1, Math.ceil(Math.max(1, tocItemCount) / tocEntriesPerPage));

      let tocStartPage = 1;

      fillPageWhite(pdf, pageWidth, pageHeight);
      if (hasCoverPage) {
        let coverY = margin.top;

        pdf.setFontSize(30);
        const titleLines = pdf.splitTextToSize(project.title, contentWidth) as string[];
        pdf.text(titleLines, pageWidth / 2, coverY, { align: 'center' });
        coverY += titleLines.length * 36 + 8;

        if (project.author) {
          pdf.setFontSize(14);
          pdf.text(`${authorLabel}: ${project.author}`, pageWidth / 2, coverY, { align: 'center' });
          coverY += 26;
        }

        if (project.genre) {
          pdf.setFontSize(12);
          pdf.text(`${genreLabel}: ${project.genre}`, pageWidth / 2, coverY, { align: 'center' });
          coverY += 22;
        }

        const imageMaxHeight = Math.max(120, pageHeight - margin.bottom - coverY);
        if (projectCover && imageMaxHeight > 0) {
          drawContainedImage(pdf, projectCover, margin.left, coverY, contentWidth, imageMaxHeight);
        }

        pdf.addPage('a4', 'p');
        tocStartPage = 2;
      }

      pdf.setPage(tocStartPage);
      fillPageWhite(pdf, pageWidth, pageHeight);
      for (let i = 1; i < tocPageCount; i += 1) {
        pdf.addPage('a4', 'p');
      }

      const chapterStartPage = new Map<string, number>();
      let cursorY = margin.top;

      const startNewContentPage = () => {
        pdf.addPage('a4', 'p');
        pdf.setPage(pdf.getNumberOfPages());
        fillPageWhite(pdf, pageWidth, pageHeight);
        cursorY = margin.top;
      };

      const ensureSpace = (neededHeight: number) => {
        if (cursorY + neededHeight > pageHeight - margin.bottom) {
          startNewContentPage();
        }
      };

      for (const item of chapterRenderData) {
        startNewContentPage();
        chapterStartPage.set(item.chapter.id, pdf.getNumberOfPages());

        pdf.setFontSize(22);
        const chapterTitleLines = pdf.splitTextToSize(item.displayTitle, contentWidth) as string[];
        pdf.text(chapterTitleLines, margin.left, cursorY);
        cursorY += chapterTitleLines.length * 30 + 8;

        if (!item.isPrologue && item.summary) {
          pdf.setFontSize(12);
          const summaryLines = pdf.splitTextToSize(`${summaryLabel}: ${item.summary}`, contentWidth) as string[];
          ensureSpace(summaryLines.length * 20 + 1);
          pdf.text(summaryLines, margin.left, cursorY);
          cursorY += summaryLines.length * 20 + 1;
        }

        let hasChapterCover = false;
        if (includeChapterCover && item.chapterCover) {
          const preferredHeight = 230;
          ensureSpace(preferredHeight + 14);
          const renderedHeight = drawContainedImage(pdf, item.chapterCover, margin.left, cursorY, contentWidth, preferredHeight);
          if (renderedHeight > 0) {
            cursorY += renderedHeight + 8;
            hasChapterCover = true;
          }
        }

        if (hasChapterCover) {
          ensureSpace(40);
          cursorY += 30;
        } else {
          ensureSpace(12);
          cursorY += 8;
        }

        if (item.paragraphs.length === 0) {
          ensureSpace(24);
          pdf.setFontSize(12);
          pdf.text(noChapterContentLabel, margin.left, cursorY);
          cursorY += 22;
        } else {
          for (let index = 0; index < item.paragraphs.length; index += 1) {
            const anchor = index + 1;
            const paragraph = item.paragraphs[index];
            const paragraphLines = wrapParagraphForPdf(pdf, paragraph, contentWidth);
            const paragraphLineHeight = 20;

            ensureSpace(paragraphLines.length * paragraphLineHeight + 8);
            pdf.setFontSize(12);
            pdf.text(paragraphLines, margin.left, cursorY);
            cursorY += paragraphLines.length * paragraphLineHeight + 10;

            if (includeParagraphIllustrations) {
              const anchorImages = item.illustrations.filter((illustration) => illustration.anchorIndex === anchor);
              for (const imageItem of anchorImages) {
                ensureSpace(288);
                cursorY += 2;
                const imageHeight = drawContainedImage(
                  pdf,
                  imageItem.imageBase64,
                  margin.left,
                  cursorY,
                  contentWidth,
                  250
                );
                if (imageHeight > 0) {
                  cursorY += imageHeight + 28;
                }
              }
            }
          }
        }
      }

      const tocItems: TocItem[] = [];
      for (const item of chapterRenderData) {
        const page = chapterStartPage.get(item.chapter.id);
        if (!page) continue;
        tocItems.push({
          label: item.displayTitle,
          page,
        });
      }

      for (let tocPageIndex = 0; tocPageIndex < tocPageCount; tocPageIndex += 1) {
        const tocPage = tocStartPage + tocPageIndex;
        pdf.setPage(tocPage);
        fillPageWhite(pdf, pageWidth, pageHeight);

        pdf.setFontSize(24);
        pdf.text(tocLabel, margin.left, tocTitleY);
        pdf.setFontSize(12);

        const start = tocPageIndex * tocEntriesPerPage;
        const end = Math.min(start + tocEntriesPerPage, tocItems.length);
        for (let i = start; i < end; i += 1) {
          const item = tocItems[i];
          const y = tocListStartY + (i - start) * tocLineHeight;
          const displayPageText = String(getDisplayPageNumber(item.page, tocStartPage));
          const pageTextWidth = pdf.getTextWidth(displayPageText);
          const labelMaxWidth = contentWidth - pageTextWidth - 28;
          const label = truncateByWidth(pdf, item.label, labelMaxWidth);
          const labelWidth = pdf.getTextWidth(label);
          const dotsStart = margin.left + labelWidth + 6;
          const dotsEnd = pageWidth - margin.right - pageTextWidth - 6;
          const dots = dotsEnd > dotsStart ? buildDottedLeader(pdf, dotsEnd - dotsStart) : '';

          pdf.text(label, margin.left, y);
          if (dots) {
            pdf.text(dots, dotsStart, y);
          }
          pdf.text(displayPageText, pageWidth - margin.right, y, { align: 'right' });
          (pdf as PdfWithLink).link(margin.left, y - 12, contentWidth, tocLineHeight, {
            pageNumber: item.page,
            top: 0,
          });
        }
      }

      const totalPages = pdf.getNumberOfPages();
      for (let page = tocStartPage; page <= totalPages; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text(String(getDisplayPageNumber(page, tocStartPage)), pageWidth / 2, pageHeight - 24, { align: 'center' });
      }
      pdf.setTextColor(0, 0, 0);

      const fileName = `${toSafeFileName(project.title)}_export.pdf`;
      pdf.save(fileName);
    } catch (exportError) {
      const message =
        typeof exportError === 'string'
          ? exportError
          : (exportError as Error)?.message || tx(uiLanguage, 'PDF 导出失败', 'PDF export failed');
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = async () => {
    if (exportFormat === 'pdf') {
      await handleExportPdf();
      return;
    }
    if (exportFormat === 'epub') {
      await handleExportEpub();
      return;
    }
    await exportTextOnlyFile(exportFormat);
  };

  const canExportCurrentFormat = exportFormat === 'pdf' ? fontOptions.length > 0 : true;

  const exportButtonLabel = (() => {
    switch (exportFormat) {
      case 'txt':
        return tx(uiLanguage, '导出 TXT', 'Export TXT');
      case 'epub':
        return tx(uiLanguage, '导出 EPUB', 'Export EPUB');
      case 'mobi':
        return tx(uiLanguage, '导出 MOBI', 'Export MOBI');
      default:
        return tx(uiLanguage, '导出 PDF', 'Export PDF');
    }
  })();

  if (loading) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">{tx(uiLanguage, '正在加载导出数据...', 'Loading export data...')}</div>;
  }

  if (!project) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error || tx(uiLanguage, '项目不存在', 'Project not found')}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          {tx(uiLanguage, '返回首页', 'Back to Home')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(`/project/${id}`)} className="whitespace-nowrap">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tx(uiLanguage, '返回章节列表', 'Back to Chapter List')}
        </Button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{tx(uiLanguage, '导出电子书', 'Export Ebook')}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0">
        <section className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4 overflow-auto">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{tx(uiLanguage, '导出格式', 'Export Format')}</h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="export-format"
                  value="pdf"
                  checked={exportFormat === 'pdf'}
                  onChange={() => setExportFormat('pdf')}
                  disabled={exporting}
                />
                {tx(uiLanguage, 'PDF（A4，支持图片）', 'PDF (A4, supports images)')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="export-format"
                  value="txt"
                  checked={exportFormat === 'txt'}
                  onChange={() => setExportFormat('txt')}
                  disabled={exporting}
                />
                {tx(uiLanguage, 'TXT（纯文本）', 'TXT (Plain Text)')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="export-format"
                  value="epub"
                  checked={exportFormat === 'epub'}
                  onChange={() => setExportFormat('epub')}
                  disabled={exporting}
                />
                {tx(uiLanguage, 'EPUB（纯文本）', 'EPUB (Plain Text)')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="export-format"
                  value="mobi"
                  checked={exportFormat === 'mobi'}
                  onChange={() => setExportFormat('mobi')}
                  disabled={exporting}
                />
                {tx(uiLanguage, 'MOBI（纯文本）', 'MOBI (Plain Text)')}
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{tx(uiLanguage, '系统中文字体', 'System Fonts')}</h2>
            <select
              value={selectedFontKey}
              onChange={(event) => setSelectedFontKey(event.target.value)}
              disabled={fontOptions.length === 0 || exporting || exportFormat !== 'pdf'}
              className="w-full rounded-md border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm disabled:opacity-60 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              {fontOptions.length === 0 ? (
                <option value="">{tx(uiLanguage, '未检测到可用字体', 'No available font detected')}</option>
              ) : (
                fontOptions.map((font) => (
                  <option key={font.key} value={font.key}>
                    {font.label}
                  </option>
                ))
              )}
            </select>
            {exportFormat === 'pdf' ? (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400">{tx(uiLanguage, '从系统字体目录读取并嵌入 PDF', 'Read and embed font from system directory')}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{tx(uiLanguage, '若导出后中文显示异常，请切换其他字体重试', 'If exported text renders incorrectly, switch font and retry')}</p>
              </>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{tx(uiLanguage, '当前格式为文本导出，不依赖字体嵌入', 'Current format is text-only export and does not require font embedding')}</p>
            )}
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{tx(uiLanguage, '导出内容', 'Export Content')}</h2>
            <div className="space-y-2">
              <label className={`flex items-center gap-2 text-sm ${isTextOnlyFormat ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                <input
                  type="checkbox"
                  checked={includeNovelCover}
                  onChange={(event) => setIncludeNovelCover(event.target.checked)}
                  disabled={isTextOnlyFormat || exporting}
                />
                {tx(uiLanguage, '小说封面', 'Novel Cover')}
              </label>
              <label className={`flex items-center gap-2 text-sm ${isTextOnlyFormat ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                <input
                  type="checkbox"
                  checked={includeChapterCover}
                  onChange={(event) => setIncludeChapterCover(event.target.checked)}
                  disabled={isTextOnlyFormat || exporting}
                />
                {tx(uiLanguage, '章节封面', 'Chapter Cover')}
              </label>
              <label className={`flex items-center gap-2 text-sm ${isTextOnlyFormat ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                <input
                  type="checkbox"
                  checked={includeParagraphIllustrations}
                  onChange={(event) => setIncludeParagraphIllustrations(event.target.checked)}
                  disabled={isTextOnlyFormat || exporting}
                />
                {tx(uiLanguage, '段落插图', 'Paragraph Illustrations')}
              </label>
            </div>
            {isTextOnlyFormat && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{tx(uiLanguage, '当前格式不支持图片，仅导出文本内容', 'Current format does not support images, only text will be exported')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleExport}
              loading={exporting}
              disabled={!canExportCurrentFormat}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              {exportButtonLabel}
            </Button>
            <Button
              variant="outline"
              onClick={handleResetRemovedIllustrations}
              disabled={removedIllustrationIds.size === 0}
              className="w-full"
            >
              <ImageOff className="w-4 h-4 mr-2" />
              {tx(uiLanguage, '恢复全部已删除插图', 'Restore All Removed Illustrations')}
            </Button>
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg p-3">
              {error}
            </div>
          )}
        </section>

        <section className="lg:col-span-3 bg-gray-100 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-4 min-h-0 flex flex-col">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {isTextOnlyFormat
              ? tx(uiLanguage, '导出预览（文本导出，图片不会导出）', 'Export Preview (Text-only, images not exported)')
              : tx(uiLanguage, '导出预览（可删除个别段落插图）', 'Export Preview (You can remove specific illustrations)')}
          </div>
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-[794px] bg-white text-black rounded-md shadow p-10 space-y-12">
              {!isTextOnlyFormat && includeNovelCover && projectCover && (
                <div className="bg-white rounded space-y-3">
                  <img src={projectCover} alt={tx(uiLanguage, '小说封面', 'Novel Cover')} className="w-full max-h-[1020px] object-contain rounded" />
                </div>
              )}

              <div className="text-center space-y-3 border-b border-gray-200 pb-10">
                <h2 className="text-4xl font-bold text-gray-900">{project.title}</h2>
                {project.author && (
                  <p className="text-gray-700">{contentLanguage === 'en' ? `Author: ${project.author}` : `作者：${project.author}`}</p>
                )}
                {project.genre && (
                  <p className="text-gray-700">{contentLanguage === 'en' ? `Genre: ${project.genre}` : `类型：${project.genre}`}</p>
                )}
              </div>

              {chapterRenderData.map((item) => (
                <article key={item.chapter.id} className="space-y-5 border-b border-gray-200 pb-12 bg-white">
                  <h3 className="text-2xl font-semibold text-gray-900">{item.displayTitle}</h3>

                  {!item.isPrologue && item.summary && (
                    <p className="text-sm text-gray-700 border-l-2 border-gray-300 pl-3">
                      {contentLanguage === 'en' ? `Summary: ${item.summary}` : `摘要：${item.summary}`}
                    </p>
                  )}

                  {!isTextOnlyFormat && includeChapterCover && item.chapterCover && (
                    <img
                      src={item.chapterCover}
                      alt={`${item.displayTitle} ${tx(uiLanguage, '封面', 'Cover')}`}
                      className="w-full rounded max-h-[420px] object-contain bg-white !mt-1 mb-6"
                    />
                  )}

                  <div className="h-3" />

                  {item.paragraphs.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-gray-500 italic">
                        {contentLanguage === 'en' ? 'No chapter content yet' : '本章节暂时无正文内容'}
                      </p>
                      {!isTextOnlyFormat &&
                        includeParagraphIllustrations &&
                        item.illustrations.map((illustration) => (
                          <div key={illustration.id} className="border border-gray-200 rounded p-3 space-y-2 mt-1 mb-6">
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => handleRemoveIllustration(illustration.id)}
                                className="inline-flex items-center text-xs text-red-600 hover:text-red-700"
                                title={tx(uiLanguage, '从导出中移除该插图', 'Remove this illustration from export')}
                              >
                                <X className="w-3 h-3 mr-1" />
                                {tx(uiLanguage, '删除插图', 'Remove Illustration')}
                              </button>
                            </div>
                            <img
                              src={illustration.imageBase64}
                              alt={tx(uiLanguage, '段落插图', 'Paragraph Illustration')}
                              className="w-full rounded max-h-[320px] object-contain bg-white"
                            />
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {item.paragraphs.map((paragraph, index) => {
                        const anchor = index + 1;
                        const currentIllustrations = !isTextOnlyFormat && includeParagraphIllustrations
                          ? item.illustrations.filter((illustration) => illustration.anchorIndex === anchor)
                          : [];
                        return (
                          <div key={`${item.chapter.id}-paragraph-${anchor}`} className="space-y-3">
                            <p className="leading-8 text-[15px] text-gray-900">{paragraph}</p>
                            {currentIllustrations.map((illustration) => (
                              <div key={illustration.id} className="border border-gray-200 rounded p-3 space-y-2 mt-1 mb-6">
                                <div className="flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveIllustration(illustration.id)}
                                    className="inline-flex items-center text-xs text-red-600 hover:text-red-700"
                                    title={tx(uiLanguage, '从导出中移除该插图', 'Remove this illustration from export')}
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    {tx(uiLanguage, '删除插图', 'Remove Illustration')}
                                  </button>
                                </div>
                                <img
                                  src={illustration.imageBase64}
                                  alt={tx(uiLanguage, `段落 ${anchor} 插图`, `Paragraph ${anchor} Illustration`)}
                                  className="w-full rounded max-h-[320px] object-contain bg-white"
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              ))}

              {chapterRenderData.length === 0 && (
                <div className="text-center text-gray-500 py-10">
                  <FileText className="w-6 h-6 mx-auto mb-2" />
                  {tx(uiLanguage, '暂无章节可导出', 'No chapters to export')}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
