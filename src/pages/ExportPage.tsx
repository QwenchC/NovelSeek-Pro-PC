import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import { ArrowLeft, Download, FileText, ImageOff, X } from 'lucide-react';
import { Button } from '@components/Button';
import { chapterApi, projectApi, systemApi } from '@services/api';
import { useAppStore } from '@store/index';
import type { Chapter, Project, SystemFontOption } from '@typings/index';

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
  includeNovelCover: boolean;
  includeChapterCover: boolean;
  includeParagraphIllustrations: boolean;
  selectedFontKey: string;
  removedIllustrationIds: string[];
}

function getExportProgressStorageKey(projectId: string): string {
  return `novelseek-export-progress:${projectId}`;
}

function loadExportProgress(projectId: string): ExportPageProgress | null {
  try {
    const raw = localStorage.getItem(getExportProgressStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExportPageProgress>;
    return {
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

function isPrologueChapter(chapter: Chapter): boolean {
  return chapter.order_index === 0 || chapter.title.trim() === '序章';
}

function getChapterDisplayTitle(chapter: Chapter): string {
  return isPrologueChapter(chapter) ? '序章' : `第${chapter.order_index}章 ${chapter.title}`;
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

export function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const promoByChapter = useAppStore((state) => state.promoByChapter);

  const [project, setProject] = useState<Project | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [fontOptions, setFontOptions] = useState<SystemFontOption[]>([]);
  const [selectedFontKey, setSelectedFontKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeNovelCover, setIncludeNovelCover] = useState(true);
  const [includeChapterCover, setIncludeChapterCover] = useState(true);
  const [includeParagraphIllustrations, setIncludeParagraphIllustrations] = useState(true);
  const [removedIllustrationIds, setRemovedIllustrationIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [isProgressHydrated, setIsProgressHydrated] = useState(false);

  useEffect(() => {
    if (!id) return;
    const progress = loadExportProgress(id);
    if (progress) {
      setIncludeNovelCover(progress.includeNovelCover);
      setIncludeChapterCover(progress.includeChapterCover);
      setIncludeParagraphIllustrations(progress.includeParagraphIllustrations);
      setRemovedIllustrationIds(new Set(progress.removedIllustrationIds));
      setSelectedFontKey(progress.selectedFontKey);
    } else {
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
          setError('项目不存在');
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
              : (fontError as Error)?.message || '获取系统字体列表失败';
          setFontOptions([]);
          setSelectedFontKey('');
          setError(fontMessage);
        }
      } catch (loadError) {
        const message =
          typeof loadError === 'string' ? loadError : (loadError as Error)?.message || '加载导出数据失败';
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
      includeNovelCover,
      includeChapterCover,
      includeParagraphIllustrations,
      selectedFontKey,
      removedIllustrationIds: [...removedIllustrationIds],
    });
  }, [
    id,
    isProgressHydrated,
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
        displayTitle: getChapterDisplayTitle(chapter),
        isPrologue: isPrologueChapter(chapter),
        summary,
        paragraphs,
        chapterCover,
        illustrations,
      };
    });
  }, [chapters, promoByChapter, removedIllustrationIds]);

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

  const handleExportPdf = async () => {
    if (!project) return;
    setExporting(true);
    setError(null);

    try {
      const fontOption = fontOptions.find((item) => item.key === selectedFontKey) || fontOptions[0];
      if (!fontOption) {
        throw new Error('未找到可用系统字体，请先安装中文字体');
      }

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
          pdf.text(`作者：${project.author}`, pageWidth / 2, coverY, { align: 'center' });
          coverY += 26;
        }

        if (project.genre) {
          pdf.setFontSize(12);
          pdf.text(`类型：${project.genre}`, pageWidth / 2, coverY, { align: 'center' });
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
          const summaryLines = pdf.splitTextToSize(`摘要：${item.summary}`, contentWidth) as string[];
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
          pdf.text('（本章节暂无正文内容）', margin.left, cursorY);
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
        pdf.text('目录', margin.left, tocTitleY);
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
        typeof exportError === 'string' ? exportError : (exportError as Error)?.message || 'PDF 导出失败';
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">正在加载导出数据...</div>;
  }

  if (!project) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error || '项目不存在'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(`/project/${id}`)} className="whitespace-nowrap">
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回章节列表
        </Button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">导出电子书</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0">
        <section className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4 overflow-auto">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">导出格式</h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input type="radio" checked readOnly />
                PDF（A4）
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                <input type="radio" disabled />
                TXT（后续支持）
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                <input type="radio" disabled />
                EPUB（后续支持）
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                <input type="radio" disabled />
                MOBI（后续支持）
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">系统中文字体</h2>
            <select
              value={selectedFontKey}
              onChange={(event) => setSelectedFontKey(event.target.value)}
              disabled={fontOptions.length === 0 || exporting}
              className="w-full rounded-md border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm disabled:opacity-60 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              {fontOptions.length === 0 ? (
                <option value="">未检测到可用字体</option>
              ) : (
                fontOptions.map((font) => (
                  <option key={font.key} value={font.key}>
                    {font.label}
                  </option>
                ))
              )}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400">从系统字体目录读取并嵌入 PDF</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">若导出后中文显示异常，请切换其他字体重试</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">导出内容</h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={includeNovelCover}
                  onChange={(event) => setIncludeNovelCover(event.target.checked)}
                />
                小说封面
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={includeChapterCover}
                  onChange={(event) => setIncludeChapterCover(event.target.checked)}
                />
                章节封面
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={includeParagraphIllustrations}
                  onChange={(event) => setIncludeParagraphIllustrations(event.target.checked)}
                />
                段落插图
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleExportPdf}
              loading={exporting}
              disabled={fontOptions.length === 0}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              导出 PDF
            </Button>
            <Button
              variant="outline"
              onClick={handleResetRemovedIllustrations}
              disabled={removedIllustrationIds.size === 0}
              className="w-full"
            >
              <ImageOff className="w-4 h-4 mr-2" />
              恢复全部已删除插图
            </Button>
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg p-3">
              {error}
            </div>
          )}
        </section>

        <section className="lg:col-span-3 bg-gray-100 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-4 min-h-0 flex flex-col">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">导出预览（可删除个别段落插图）</div>
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-[794px] bg-white text-black rounded-md shadow p-10 space-y-12">
              {includeNovelCover && projectCover && (
                <div className="bg-white rounded space-y-3">
                  <img src={projectCover} alt="小说封面" className="w-full max-h-[1020px] object-contain rounded" />
                </div>
              )}

              <div className="text-center space-y-3 border-b border-gray-200 pb-10">
                <h2 className="text-4xl font-bold text-gray-900">{project.title}</h2>
                {project.author && <p className="text-gray-700">作者：{project.author}</p>}
                {project.genre && <p className="text-gray-700">类型：{project.genre}</p>}
              </div>

              {chapterRenderData.map((item) => (
                <article key={item.chapter.id} className="space-y-5 border-b border-gray-200 pb-12 bg-white">
                  <h3 className="text-2xl font-semibold text-gray-900">{item.displayTitle}</h3>

                  {!item.isPrologue && item.summary && (
                    <p className="text-sm text-gray-700 border-l-2 border-gray-300 pl-3">摘要：{item.summary}</p>
                  )}

                  {includeChapterCover && item.chapterCover && (
                    <img
                      src={item.chapterCover}
                      alt={`${item.displayTitle} 封面`}
                      className="w-full rounded max-h-[420px] object-contain bg-white !mt-1 mb-6"
                    />
                  )}

                  <div className="h-3" />

                  {item.paragraphs.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-gray-500 italic">本章节暂时无正文内容</p>
                      {includeParagraphIllustrations &&
                        item.illustrations.map((illustration) => (
                          <div key={illustration.id} className="border border-gray-200 rounded p-3 space-y-2 mt-1 mb-6">
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => handleRemoveIllustration(illustration.id)}
                                className="inline-flex items-center text-xs text-red-600 hover:text-red-700"
                                title="从导出中移除该插图"
                              >
                                <X className="w-3 h-3 mr-1" />
                                删除插图
                              </button>
                            </div>
                            <img
                              src={illustration.imageBase64}
                              alt="段落插图"
                              className="w-full rounded max-h-[320px] object-contain bg-white"
                            />
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {item.paragraphs.map((paragraph, index) => {
                        const anchor = index + 1;
                        const currentIllustrations = includeParagraphIllustrations
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
                                    title="从导出中移除该插图"
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    删除插图
                                  </button>
                                </div>
                                <img
                                  src={illustration.imageBase64}
                                  alt={`段落 ${anchor} 插图`}
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
                  暂无章节可导出
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
