import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { chapterApi, projectApi, ttsApi, EDGE_TTS_VOICES } from '@services/api';
import type { Chapter } from '@typings/index';
import { ArrowLeft, Headphones, Play, Pause, Square, SkipBack, SkipForward } from 'lucide-react';
import { useSmartBack } from '@utils/useSmartBack';
import { tx } from '@utils/i18n';

const LS_VOICE = 'listenVoice';
const LS_RATE = 'listenRate';
const MAX_SEG_CHARS = 220;

/** Port of AudiobookController.splitSegments: sentence-grouped segments up to MAX_SEG_CHARS chars. */
function splitSegments(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences: string[] = [];
  let sb = '';
  for (const ch of clean) {
    sb += ch;
    if ('。！？!?\n；;'.includes(ch)) {
      const s = sb.trim();
      if (s) sentences.push(s);
      sb = '';
    }
  }
  if (sb.trim()) sentences.push(sb.trim());

  const segments: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_SEG_CHARS) { segments.push(cur); cur = ''; }
    if (s.length > MAX_SEG_CHARS) {
      if (cur) { segments.push(cur); cur = ''; }
      let i = 0;
      while (i < s.length) { const end = Math.min(i + MAX_SEG_CHARS, s.length); segments.push(s.slice(i, end)); i = end; }
    } else {
      cur += s;
    }
  }
  if (cur) segments.push(cur);
  return segments.filter((x) => x.trim());
}

interface ListenChapter { id: string; title: string; order: number; segments: string[] }

export function ListenPage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const { uiLanguage, currentProject, setCurrentProject } = useAppStore();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [voice, setVoice] = useState<string>(() => localStorage.getItem(LS_VOICE) || EDGE_TTS_VOICES[0].id);
  const [rate, setRate] = useState<number>(() => Number(localStorage.getItem(LS_RATE)) || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState('');
  const [pos, setPos] = useState<{ ci: number; si: number }>({ ci: 0, si: 0 });

  const playlist: ListenChapter[] = useMemo(
    () =>
      [...chapters]
        .sort((a, b) => a.order_index - b.order_index)
        .map((c) => ({ id: c.id, title: c.title, order: c.order_index, segments: splitSegments(c.final_text || c.draft_text || '') }))
        .filter((c) => c.segments.length > 0),
    [chapters]
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef(playlist);
  const stoppedRef = useRef(true);
  const runIdRef = useRef(0);
  const voiceRef = useRef(voice);
  const rateRef = useRef(rate);
  const resolveRef = useRef<(() => void) | null>(null);
  const prefetchRef = useRef<{ ci: number; si: number; voice: string; rate: number; p: Promise<string | null> } | null>(null);

  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { voiceRef.current = voice; localStorage.setItem(LS_VOICE, voice); prefetchRef.current = null; }, [voice]);
  useEffect(() => { rateRef.current = rate; localStorage.setItem(LS_RATE, String(rate)); prefetchRef.current = null; }, [rate]);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return () => { stoppedRef.current = true; audioRef.current?.pause(); };
  }, []);

  useEffect(() => {
    if (!id) return;
    projectApi.getById(id).then(setCurrentProject);
    chapterApi.getByProject(id).then(setChapters).catch(() => setChapters([]));
  }, [id]);

  const synth = (text: string): Promise<string | null> =>
    ttsApi.synthesize(text, voiceRef.current, rateRef.current).catch((e) => {
      setStatus(tx(uiLanguage, `朗读失败：${String(e)}`, `TTS failed: ${String(e)}`));
      return null;
    });

  const obtainSegment = async (ci: number, si: number, text: string): Promise<string | null> => {
    const pf = prefetchRef.current;
    if (pf && pf.ci === ci && pf.si === si && pf.voice === voiceRef.current && pf.rate === rateRef.current) {
      prefetchRef.current = null;
      const r = await pf.p;
      if (r) return r;
    }
    return synth(text);
  };

  const launchPrefetch = (ci: number, si: number, text: string) => {
    prefetchRef.current = { ci, si, voice: voiceRef.current, rate: rateRef.current, p: synth(text) };
  };

  const playAudio = (b64: string): Promise<void> =>
    new Promise((resolve) => {
      const audio = audioRef.current!;
      resolveRef.current = resolve;
      audio.onended = () => { audio.onended = null; audio.onerror = null; resolveRef.current = null; resolve(); };
      audio.onerror = () => { audio.onended = null; audio.onerror = null; resolveRef.current = null; resolve(); };
      audio.src = `data:audio/mpeg;base64,${b64}`;
      audio.playbackRate = 1;
      audio.play().catch(() => {});
    });

  const saveProgress = (ci: number, si: number) => {
    if (!id) return;
    const ch = playlistRef.current[ci];
    if (ch) localStorage.setItem(`listenProgress:${id}`, JSON.stringify({ chapterId: ch.id, seg: si }));
  };

  async function runFrom(ci0: number, si0: number) {
    const myRun = ++runIdRef.current;
    stoppedRef.current = false;
    setIsPlaying(true);
    setIsPaused(false);
    setStatus('');
    let ci = ci0;
    let si = si0;
    while (!stoppedRef.current && runIdRef.current === myRun) {
      const list = playlistRef.current;
      const ch = list[ci];
      if (!ch || si >= (ch?.segments.length ?? 0)) {
        if (ci + 1 >= list.length) { stop(); return; }
        ci += 1; si = 0; continue;
      }
      setPos({ ci, si });
      saveProgress(ci, si);
      setPreparing(true);
      const b64 = await obtainSegment(ci, si, ch.segments[si]);
      setPreparing(false);
      if (stoppedRef.current || runIdRef.current !== myRun) return;
      if (!b64) { setIsPlaying(false); return; }
      if (si + 1 < ch.segments.length) launchPrefetch(ci, si + 1, ch.segments[si + 1]);
      await playAudio(b64);
      if (stoppedRef.current || runIdRef.current !== myRun) return;
      si += 1;
    }
  }

  const play = () => {
    if (playlist.length === 0) return;
    // Resume if merely paused mid-segment.
    if (isPaused && audioRef.current && audioRef.current.src) {
      audioRef.current.play().catch(() => {});
      setIsPaused(false); setIsPlaying(true);
      return;
    }
    // Restore saved progress on first play.
    let ci = pos.ci, si = pos.si;
    const saved = id ? localStorage.getItem(`listenProgress:${id}`) : null;
    if (saved && !isPlaying) {
      try { const o = JSON.parse(saved); const idx = playlist.findIndex((c) => c.id === o.chapterId); if (idx >= 0) { ci = idx; si = Math.min(o.seg || 0, playlist[idx].segments.length - 1); } } catch { /* ignore */ }
    }
    runFrom(ci, si);
  };
  const pause = () => { audioRef.current?.pause(); setIsPaused(true); setIsPlaying(false); };
  const stop = () => {
    stoppedRef.current = true;
    runIdRef.current += 1;
    audioRef.current?.pause();
    if (audioRef.current) { audioRef.current.onended = null; audioRef.current.onerror = null; }
    resolveRef.current?.(); resolveRef.current = null;
    prefetchRef.current = null;
    setIsPlaying(false); setIsPaused(false); setPreparing(false);
  };

  const jumpChapter = (delta: number) => {
    const next = Math.max(0, Math.min(playlist.length - 1, pos.ci + delta));
    stop();
    setPos({ ci: next, si: 0 });
    setTimeout(() => runFrom(next, 0), 0);
  };
  const startChapter = (ci: number) => { stop(); setPos({ ci, si: 0 }); setTimeout(() => runFrom(ci, 0), 0); };

  if (!id) return null;
  const cur = playlist[pos.ci];

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={smartBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Headphones className="w-5 h-5 text-purple-600" />
            {tx(uiLanguage, '听书', 'Listen')}
          </h1>
          {currentProject && <p className="text-sm text-gray-500">{currentProject.title}</p>}
        </div>
      </div>

      {/* Now playing + transport */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <p className="text-xs text-gray-400">{tx(uiLanguage, '正在朗读（Edge 神经网络音色）', 'Now reading (Edge neural voice)')}</p>
        <p className="text-lg font-semibold text-gray-900 dark:text-white mt-0.5">
          {cur ? tx(uiLanguage, `第${cur.order}章 ${cur.title}`, `Ch.${cur.order} ${cur.title}`) : tx(uiLanguage, '（无可朗读章节）', '(nothing to read)')}
        </p>
        {cur && (
          <p className="text-xs text-gray-400 mt-0.5">
            {tx(uiLanguage, `片段 ${pos.si + 1} / ${cur.segments.length}`, `Segment ${pos.si + 1} / ${cur.segments.length}`)}
            {preparing ? tx(uiLanguage, ' · 合成中…', ' · synthesizing…') : ''}
          </p>
        )}
        {cur && cur.segments[pos.si] && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3 leading-relaxed">{cur.segments[pos.si]}</p>
        )}

        <div className="flex items-center justify-center gap-3 mt-5">
          <button onClick={() => jumpChapter(-1)} disabled={pos.ci <= 0} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-30" title={tx(uiLanguage, '上一章', 'Previous chapter')}>
            <SkipBack className="w-5 h-5" />
          </button>
          {!isPlaying ? (
            <button onClick={play} disabled={playlist.length === 0} className="w-14 h-14 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center disabled:opacity-40" title={tx(uiLanguage, '播放', 'Play')}>
              <Play className="w-6 h-6 ml-0.5" />
            </button>
          ) : (
            <button onClick={pause} className="w-14 h-14 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center" title={tx(uiLanguage, '暂停', 'Pause')}>
              <Pause className="w-6 h-6" />
            </button>
          )}
          <button onClick={stop} disabled={!isPlaying && !isPaused} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-30" title={tx(uiLanguage, '停止', 'Stop')}>
            <Square className="w-5 h-5" />
          </button>
          <button onClick={() => jumpChapter(1)} disabled={pos.ci >= playlist.length - 1} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-30" title={tx(uiLanguage, '下一章', 'Next chapter')}>
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {status && <p className="text-xs text-red-500 text-center mt-3">{status}</p>}

        {/* Voice + rate */}
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3 mt-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '音色', 'Voice')}</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {EDGE_TTS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {tx(uiLanguage, `语速 ${rate >= 0 ? '+' : ''}${rate}%`, `Rate ${rate >= 0 ? '+' : ''}${rate}%`)}
            </label>
            <input type="range" min={-50} max={100} step={10} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full accent-purple-600 mt-2" />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          {tx(uiLanguage, '使用微软 Edge 在线神经网络音色（需联网）。切换音色/语速会在下一片段生效。', 'Uses Microsoft Edge online neural voices (requires internet). Voice/rate changes apply from the next segment.')}
        </p>
      </div>

      {/* Chapter list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 max-h-[40vh] overflow-y-auto">
        {playlist.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">{tx(uiLanguage, '还没有可朗读的章节正文', 'No chapter text to read yet')}</p>
        ) : (
          playlist.map((c, ci) => (
            <button key={c.id} onClick={() => startChapter(ci)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${ci === pos.ci ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}>
              <span className="text-xs text-gray-400 w-6 flex-shrink-0">{c.order}</span>
              <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{c.title}</span>
              {ci === pos.ci && isPlaying && <span className="text-xs text-purple-600 dark:text-purple-400">{tx(uiLanguage, '朗读中', 'reading')}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
