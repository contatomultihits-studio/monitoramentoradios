import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download,
  TrendingUp, Sparkles, Filter, Megaphone, Activity,
  Trophy, X, Youtube, CalendarDays, ChevronDown,
  TrendingDown, Volume2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const REFRESH_INTERVAL_MS = 30000;

const SHIFT_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos os períodos', shortLabel: 'Todos' },
  { value: '06-10', label: '06h às 10h', shortLabel: '06h–10h', start: 6, end: 10 },
  { value: '10-14', label: '10h às 14h', shortLabel: '10h–14h', start: 10, end: 14 },
  { value: '14-18', label: '14h às 18h', shortLabel: '14h–18h', start: 14, end: 18 },
  { value: '18-22', label: '18h às 22h', shortLabel: '18h–22h', start: 18, end: 22 },
  { value: '22-02', label: '22h às 02h', shortLabel: '22h–02h', start: 22, end: 2 },
  { value: '02-06', label: '02h às 06h', shortLabel: '02h–06h', start: 2, end: 6 },
];

const isHourInShift = (time: string, shift: string): boolean => {
  if (shift === 'all') return true;
  const option = SHIFT_FILTER_OPTIONS.find(o => o.value === shift);
  if (!option || option.start === undefined || option.end === undefined) return true;
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return true;
  return option.start < option.end
    ? hour >= option.start && hour < option.end
    : hour >= option.start || hour < option.end;
};

const getShiftLabel = (shift: string): string => SHIFT_FILTER_OPTIONS.find(o => o.value === shift)?.label || 'Todos os períodos';

const LASTFM_API_KEY = '2a416b64ded1827a7e82e61d9a87b2e0';
const REPEAT_THRESHOLD = 2;
const PAGE_SIZE = 1000;
const getSupabaseClient = () => (window as any)._supabaseClient;

// ─────────────────────────────────────────────────────────────
// Aguarda o Supabase estar pronto (evento 'supabase-ready')
// ─────────────────────────────────────────────────────────────
function waitForSupabase(): Promise<void> {
  return new Promise(resolve => {
    if ((window as any)._supabaseReady) { resolve(); return; }
    const handler = () => { window.removeEventListener('supabase-ready', handler); resolve(); };
    window.addEventListener('supabase-ready', handler);
  });
}

// ─────────────────────────────────────────────────────────────
// TIMEZONE HELPER
// ─────────────────────────────────────────────────────────────
function getBrasiliaOffsetMs(date: Date = new Date()): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const brStr  = date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  return new Date(brStr).getTime() - new Date(utcStr).getTime();
}

function brasiliaLocalToUTC(isoLocal: string): string {
  const local = new Date(isoLocal + 'Z');
  const offset = getBrasiliaOffsetMs(local);
  return new Date(local.getTime() - offset).toISOString();
}

// Retorna a data atual em Brasília no formato YYYY-MM-DD
function getTodayBrasilia(): string {
  const now = new Date();
  const str = now.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const [day, month, year] = str.split('/');
  return `${year}-${month}-${day}`;
}

// ─────────────────────────────────────────────────────────────
// BLOQUEIO
// ─────────────────────────────────────────────────────────────
const BLOCKED_TRACKS: { artista?: string; musica?: string; radio?: string }[] = [
  { musica: 'SP' },
  { musica: 'O melhor Mix do Brasil' },
  { musica: 'Mix Rio FM' },
  { radio: 'Dumont FM', artista: 'TUDO O QUE VOCE GOSTA', musica: '104.3 MHz' },
];
const isBlocked = (artista: string, musica: string, radio?: string): boolean =>
  BLOCKED_TRACKS.some(b => {
    const matchRadio = !b.radio || (!!radio && b.radio.trim().toLowerCase() === radio.trim().toLowerCase());
    const matchArtista = !b.artista || b.artista === '*' || b.artista.trim().toLowerCase() === artista.trim().toLowerCase();
    const matchMusica  = !b.musica  || b.musica  === '*' || b.musica.trim().toLowerCase()  === musica.trim().toLowerCase();
    return matchRadio && matchArtista && matchMusica;
  });

const GENRE_COLORS: Record<string, string> = {
  'Sertanejo': '#5279FF', 'Pop': '#EA7F9F', 'Rock': '#0D0056',
  'MPB': '#7895FF', 'Funk': '#B75B85', 'Pagode': '#405FD4',
  'Rap/Hip Hop': '#24106F', 'Eletrônica': '#8BA3FF', 'Gospel': '#D0FF03',
  'Samba': '#312083', 'Forró': '#A8B8FF', 'Reggae': '#A7CC02',
  'Jazz': '#180B4F', 'Desconhecido': '#CBD0E4', 'Outros': '#9DA8D7'
};

const ytURL = (artista: string, musica: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`"${artista}" "${musica}"`)}` ;

const RADIO_STREAM_URLS: Record<string, string> = {
  'Metropolitana FM': 'https://ice.fabricahost.com.br/metropolitana985sp',
  'Dumont FM': 'https://8402.brasilstream.com.br/stream?origem=cadenaandroid',
  'Forbes Radio': 'https://9176.brasilstream.com.br/stream',
  'MIX Rio FM': 'https://playerservices.streamtheworld.com/api/livestream-redirect/MIXRIOAAC.aac',
};

// ─────────────────────────────────────────────────────────────
// parseTocouEm — UTC → Brasília
// ─────────────────────────────────────────────────────────────
const parseTocouEm = (tocouEm: string) => {
  const raw = tocouEm.endsWith('Z') || tocouEm.includes('+') || /[+-]\d{2}:\d{2}$/.test(tocouEm)
    ? tocouEm
    : tocouEm + 'Z';
  const utcDate = new Date(raw);
  const str = utcDate.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const [datePart, timePart] = str.split(', ');
  const [day, month, year] = datePart.split('/');
  return { data: `${year}-${month}-${day}`, hora: timePart, timestamp: utcDate.getTime() };
};

const formatDateBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// ─────────────────────────────────────────────────────────────
// BOTÃO YT
// ─────────────────────────────────────────────────────────────
const YTButton = ({ artista, musica, size = 'sm' }: { artista: string; musica: string; size?: 'sm' | 'md' | 'lg' }) => {
  const cls = { sm: 'px-2.5 py-1.5 text-[10px] gap-1', md: 'px-4 py-2 text-xs gap-1.5', lg: 'px-5 py-3 text-sm gap-2' };
  return (
    <a href={ytURL(artista, musica)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      className={`flex items-center ${cls[size]} bg-red-500 hover:bg-red-600 active:scale-95 rounded-full font-black text-white transition-all shadow-md hover:shadow-lg flex-shrink-0`}
      title={`Buscar "${artista} - ${musica}" no YouTube`}>
      <Youtube size={size === 'lg' ? 16 : size === 'md' ? 13 : 11} />
      {size === 'lg' ? 'Ver no YouTube' : size === 'md' ? 'YouTube' : 'YT'}
    </a>
  );
};

const formatAudioTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

const RadioStreamPlayer = ({ radio, streamUrl }: { radio: string; streamUrl: string }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    setIsBuffering(true);
    audio.play().catch(err => {
      console.error('Erro ao reproduzir stream:', err);
      setIsBuffering(false);
      setIsPlaying(false);
    });
  };

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0D0056] via-[#17116d] to-[#5279FF] p-6 shadow-2xl shadow-[#0D0056]/25">
      <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[#D0FF03]/20 blur-3xl" />
      <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-[#EA7F9F]/20 blur-3xl" />
      <div className="relative z-10 flex h-full flex-col justify-between gap-6">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-[#D0FF03]">
            <span className={`h-2 w-2 rounded-full bg-[#D0FF03] shadow-[0_0_0_5px_rgba(208,255,3,0.18)] ${isPlaying ? 'animate-pulse' : ''}`} />
            Ao vivo
          </div>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Radio size={24} className="text-[#D0FF03]" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D0FF03]">Ouça agora</p>
              <h3 className="text-xl font-black uppercase leading-tight text-white">{radio}</h3>
            </div>
          </div>
          <p className="text-xs font-bold leading-relaxed text-slate-300">
            Aperte o play para acompanhar a transmissão da rádio enquanto monitora a programação.
          </p>
        </div>

        <div className="rounded-2xl bg-white/95 p-3 shadow-xl shadow-slate-950/20">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border-2 border-slate-900 bg-white text-lg font-black text-slate-900 transition-all hover:scale-105 active:scale-95"
              aria-label={isPlaying ? 'Pausar transmissão' : 'Ouvir transmissão'}
            >
              {isBuffering ? <Loader2 size={19} className="animate-spin" /> : isPlaying ? 'Ⅱ' : '▶'}
            </button>
            <div className="min-w-[38px] text-xs font-bold text-slate-700">{formatAudioTime(currentTime)}</div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full rounded-full bg-slate-900 transition-all duration-500 ${isPlaying ? 'w-2/3 animate-pulse' : currentTime > 0 ? 'w-1/3' : 'w-0'}`} />
            </div>
            <Volume2 size={19} className="flex-shrink-0 text-slate-900" />
          </div>
        </div>

        <audio
          ref={audioRef}
          preload="none"
          src={streamUrl}
          className="hidden"
          onPlay={() => { setIsPlaying(true); setIsBuffering(false); }}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime || 0)}
        >
          Seu navegador não suporta reprodução de áudio.
        </audio>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// LAST.FM CACHE
// ─────────────────────────────────────────────────────────────
const artistPhotoCache: Record<string, string> = {};
const fetchArtistPhoto = async (artistName: string): Promise<string> => {
  if (artistPhotoCache[artistName] !== undefined) return artistPhotoCache[artistName];
  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_API_KEY}&format=json`);
    const json = await res.json();
    const images: any[] = json?.artist?.image || [];
    const img = images.find((i: any) => i.size === 'extralarge') || images.find((i: any) => i.size === 'large');
    const photoUrl = img?.['#text'] || '';
    artistPhotoCache[artistName] = photoUrl.includes('2a96cbd8b46e442fc41c2b86b821562f') ? '' : photoUrl;
  } catch { artistPhotoCache[artistName] = ''; }
  return artistPhotoCache[artistName];
};

// ─────────────────────────────────────────────────────────────
// TOOLTIP GÊNEROS
// ─────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-white p-4 rounded-xl shadow-2xl border border-slate-100">
        <p className="font-black text-slate-800 uppercase text-xs mb-1">{d.name}</p>
        <p className="font-bold text-[#5279FF] text-xs">{d.value} músicas ({d.percentage}%)</p>
        {d.subGenres && (
          <div className="mt-2 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Inclui:</p>
            <p className="text-[10px] text-slate-600 leading-tight">{d.subGenres.join(', ')}</p>
          </div>
        )}
      </div>
    );
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// MODAL DE EXECUÇÕES
// ─────────────────────────────────────────────────────────────
interface ExecucaoItem {
  data: string;
  hora: string;
  tocou_em: string;
}

const TrackExecutionsModal = ({
  artista, musica, capa, execucoes, periodLabel = 'ÚLTIMOS 7 DIAS', onClose
}: {
  artista: string;
  musica: string;
  capa: string;
  execucoes: ExecucaoItem[];
  periodLabel?: string;
  onClose: () => void;
}) => {
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const porDia = useMemo(() => {
    const map: Record<string, string[]> = {};
    execucoes.forEach(e => {
      if (!map[e.data]) map[e.data] = [];
      map[e.data].push(e.hora);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [execucoes]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-4 p-5 bg-gradient-to-r from-[#5279FF] to-[#0D0056] rounded-t-3xl">
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-white/30 shadow-lg">
            {capa
              ? <img src={capa} alt={musica} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center bg-white/20"><Music size={24} className="text-white" /></div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-base text-white leading-tight truncate">{musica}</h2>
            <p className="text-[#dbe3ff] text-xs font-bold truncate">{artista}</p>
            <p className="text-white/80 text-[10px] font-bold mt-0.5">
              {execucoes.length} execução{execucoes.length !== 1 ? 'ões' : ''} • {periodLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-all"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {porDia.length === 0 ? (
            <p className="text-center text-slate-400 font-bold py-8">Nenhuma execução encontrada</p>
          ) : (
            porDia.map(([dia, horarios]) => (
              <div key={dia} className="bg-slate-50 rounded-2xl p-4">
                <p className="font-black text-slate-700 text-sm mb-2 flex items-center gap-2">
                  <CalendarDays size={14} className="text-[#5279FF]" />
                  {formatDateBR(dia)}
                  <span className="ml-auto px-2 py-0.5 bg-[#5279FF]/15 text-[#0D0056] rounded-full text-[10px] font-black">
                    {horarios.length}x
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {horarios.sort().map((h, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded-full text-[11px] font-bold text-slate-600 shadow-sm"
                    >
                      <Clock size={9} className="text-[#5279FF]" />
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-slate-100">
          <YTButton artista={artista} musica={musica} size="lg" />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MODAL — playlist do artista
// ─────────────────────────────────────────────────────────────
const ArtistModal = ({ artist, tracks, photo, periodLabel, onClose }: { artist: string; tracks: any[]; photo: string; periodLabel: string; onClose: () => void }) => {
  const grouped = useMemo(() => {
    const map: Record<string, { track: any; count: number; horarios: string[] }> = {};
    tracks.forEach(t => {
      if (!map[t.musica]) map[t.musica] = { track: t, count: 0, horarios: [] };
      map[t.musica].count++;
      map[t.musica].horarios.push(t.hora);
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [tracks]);
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={handleBackdrop}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-4 p-6 bg-gradient-to-r from-[#5279FF] to-[#0D0056] rounded-t-3xl">
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-white/30 shadow-lg">
            {photo ? <img src={photo} alt={artist} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-white/20"><Music size={24} className="text-white" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-xl text-white uppercase leading-tight truncate">{artist}</h2>
            <p className="text-[#dbe3ff] text-xs font-bold mt-0.5">{tracks.length} execuções • {grouped.length} música{grouped.length !== 1 ? 's' : ''} diferente{grouped.length !== 1 ? 's' : ''}</p>
            <p className="text-[#dbe3ff] text-[10px] font-bold mt-0.5 uppercase">{periodLabel}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-all"><X size={20} className="text-white" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {grouped.map(({ track: t, count, horarios }) => (
            <div key={t.musica} className="flex items-center gap-3 bg-slate-50 hover:bg-[#5279FF]/10 rounded-2xl p-3 transition-all group">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-slate-200 shadow">
                {t.capa ? <img src={t.capa} alt="Capa" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-400"><Music size={16} /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-slate-800 text-sm truncate leading-tight">{t.musica}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {t.genero && t.genero !== 'Desconhecido' && <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase text-white" style={{ backgroundColor: GENRE_COLORS[t.genero] || '#5279FF' }}>{t.genero}</span>}
                  <span className="text-[10px] font-bold text-slate-400">{horarios.slice(0, 3).join(' • ')}{horarios.length > 3 ? ` +${horarios.length - 3}` : ''}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {count > 1 && <span className="px-2.5 py-1 bg-[#D0FF03]/25 text-[#0D0056] rounded-full text-[10px] font-black">{count}x</span>}
                <a href={ytURL(artist, t.musica)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-2 bg-red-500 hover:bg-red-600 rounded-full transition-all opacity-0 group-hover:opacity-100"><Youtube size={12} className="text-white" /></a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// NOW PLAYING CARD
// ─────────────────────────────────────────────────────────────
const NowPlayingCard = ({ track }: { track: any }) => (
  <div className="relative overflow-hidden bg-gradient-to-br from-[#0D0056] via-[#20137f] to-[#5279FF] p-6 sm:p-8 rounded-[2rem] shadow-2xl shadow-[#0D0056]/30 border border-white/10">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(82,121,255,0.30),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(234,127,159,0.28),transparent_32%)] animate-pulse" />
    <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#EA7F9F]/20 blur-3xl" />
    <div className="absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-[#D0FF03]/20 blur-3xl" />
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-5">
        <span className="flex h-3 w-3"><span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-[#D0FF03] opacity-75" /><span className="relative inline-flex rounded-full h-3 w-3 bg-[#EA7F9F]" /></span>
        <span className="text-[#D0FF03] font-black text-sm uppercase tracking-[0.25em] flex items-center gap-2"><Sparkles size={16} /> ÚLTIMA EXECUÇÃO</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="flex-shrink-0"><div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl overflow-hidden shadow-2xl ring-4 ring-white/20">{track.capa ? <img src={track.capa} alt="Capa" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-white/10"><Music size={48} className="text-white/40" /></div>}</div></div>
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-3xl sm:text-4xl text-white mb-2 leading-tight drop-shadow-lg">{track.musica}</h2>
          <p className="font-bold text-xl sm:text-2xl text-[#f9d7e2] mb-4 drop-shadow-md">{track.artista}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 backdrop-blur-sm rounded-full"><Clock size={16} className="text-[#D0FF03]" /><span className="font-bold text-white text-sm">{track.hora}</span></div>
            {track.genero && track.genero !== 'Desconhecido' && <span className="px-4 py-2 rounded-full text-sm font-black uppercase text-white shadow-lg" style={{ backgroundColor: GENRE_COLORS[track.genero] || '#5279FF' }}>{track.genero}</span>}
            {track.bpm && <div className="flex items-center gap-2 px-4 py-2 bg-[#5279FF] rounded-full shadow-lg shadow-[#0D0056]/30"><Activity size={16} className="text-white" /><span className="font-black text-white text-sm">{track.bpm} BPM</span></div>}
            {track.ano_lancamento && (
              <div
                className="flex items-center gap-2 px-4 py-2 bg-[#EA7F9F] rounded-full shadow-lg shadow-[#0D0056]/25 relative group/ano cursor-default"
                title="ANO DO LANÇAMENTO"
              >
                <CalendarDays size={16} className="text-white" />
                <span className="font-black text-white text-sm">{track.ano_lancamento}</span>
                <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-900 text-white text-[10px] font-black uppercase px-2 py-1 rounded-lg shadow-lg opacity-0 group-hover/ano:opacity-100 transition-opacity duration-150 z-10">
                  ANO DO LANÇAMENTO
                </span>
              </div>
            )}
            <YTButton artista={track.artista} musica={track.musica} size="lg" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// MUSIC CARD
// ─────────────────────────────────────────────────────────────
const MusicCard = ({
  track,
  repeatCount,
  weeklyExecs,
  onCapaClick
}: {
  track: any;
  repeatCount?: number;
  weeklyExecs: ExecucaoItem[];
  onCapaClick: () => void;
}) => (
  <div className={`bg-white/95 backdrop-blur border rounded-3xl p-4 hover:shadow-xl hover:shadow-[#0D0056]/10 hover:-translate-y-1 transition-all duration-300 ${
    repeatCount && repeatCount >= REPEAT_THRESHOLD ? 'border-[#D0FF03] bg-[#D0FF03]/10 shadow-[#D0FF03]/20' : 'border-slate-200/80'
  }`}>
    <div className="flex items-center gap-4">
      <button
        onClick={onCapaClick}
        className="flex-shrink-0 w-16 h-16 rounded-2xl overflow-hidden bg-slate-100 shadow-md relative group cursor-pointer"
        title="Ver execuções desta música nos últimos 7 dias"
      >
        {track.capa
          ? <img src={track.capa} alt="Capa" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-slate-300"><Music size={20} /></div>
        }
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center">
          <Clock size={16} className="text-white opacity-0 group-hover:opacity-100 drop-shadow-lg transition-opacity" />
        </div>
        {weeklyExecs.length > 0 && (
          <div className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#5279FF] text-white rounded-full text-[9px] font-black flex items-center justify-center shadow-md">
            {weeklyExecs.length}
          </div>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <h3 className="font-black text-slate-900 text-base truncate leading-tight mb-1">{track.musica}</h3>
        <p className="font-bold text-[#0D0056] text-sm truncate mb-2">{track.artista}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-full">
            <Clock size={10} className="text-slate-500" />
            <span className="font-bold text-[10px] text-slate-600">{track.hora}</span>
          </div>
          {track.genero && track.genero !== 'Desconhecido' && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase text-white" style={{ backgroundColor: GENRE_COLORS[track.genero] || '#5279FF' }}>{track.genero}</span>
          )}
          {track.bpm && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-[#5279FF] rounded-full shadow-sm shadow-[#5279FF]/15">
              <Activity size={10} className="text-white" />
              <span className="font-black text-[10px] text-white">{track.bpm} BPM</span>
            </div>
          )}
          {track.ano_lancamento && (
            <div
              className="relative group/ano flex items-center gap-1 px-2.5 py-1 bg-[#EA7F9F] rounded-full cursor-default shadow-sm shadow-pink-100"
            >
              <CalendarDays size={10} className="text-white" />
              <span className="font-black text-[10px] text-white">{track.ano_lancamento}</span>
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-900 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-md shadow-lg opacity-0 group-hover/ano:opacity-100 transition-opacity duration-150 z-10">
                ANO DO LANÇAMENTO
              </span>
            </div>
          )}
          {repeatCount && repeatCount >= REPEAT_THRESHOLD && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-[#D0FF03] rounded-full">
              <span className="font-black text-[10px] text-[#0D0056]">🔁 {repeatCount}x hoje</span>
            </div>
          )}
          {weeklyExecs.length > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-[#5279FF]/10 border border-[#5279FF]/25 rounded-full">
              <TrendingUp size={9} className="text-[#5279FF]" />
              <span className="font-black text-[10px] text-[#0D0056]">{weeklyExecs.length}x semana</span>
            </div>
          )}
        </div>
      </div>
      <YTButton artista={track.artista} musica={track.musica} size="md" />
    </div>
  </div>
);


const MetricCard = ({ icon: Icon, label, value, detail, accent = 'cyan', onClick }: { icon: any; label: string; value: string | number; detail: string; accent?: 'cyan' | 'fuchsia' | 'emerald' | 'amber' | 'violet' | 'blue'; onClick?: () => void }) => {
  const styles: Record<string, { shell: string; icon: string; text: string; glow: string }> = {
    cyan: { shell: 'from-[#D0FF03]/15 to-white border-[#D0FF03]/40', icon: 'from-[#D0FF03] to-[#5279FF]', text: 'text-[#0D0056]', glow: 'shadow-[#D0FF03]/20' },
    fuchsia: { shell: 'from-[#EA7F9F]/20 to-white border-[#EA7F9F]/35', icon: 'from-[#EA7F9F] to-[#0D0056]', text: 'text-[#0D0056]', glow: 'shadow-[#EA7F9F]/20' },
    emerald: { shell: 'from-[#5279FF]/10 to-white border-[#5279FF]/25', icon: 'from-[#5279FF] to-[#0D0056]', text: 'text-[#0D0056]', glow: 'shadow-[#5279FF]/20' },
    amber: { shell: 'from-[#5279FF]/10 to-white border-[#5279FF]/25', icon: 'from-[#5279FF] to-[#0D0056]', text: 'text-[#0D0056]', glow: 'shadow-[#5279FF]/20' },
    violet: { shell: 'from-[#0D0056]/10 to-white border-[#0D0056]/20', icon: 'from-[#0D0056] to-[#5279FF]', text: 'text-[#0D0056]', glow: 'shadow-[#0D0056]/15' },
    blue: { shell: 'from-[#5279FF]/10 to-white border-[#5279FF]/25', icon: 'from-[#5279FF] to-[#0D0056]', text: 'text-[#0D0056]', glow: 'shadow-[#5279FF]/20' },
  };
  const current = styles[accent];

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-[1.6rem] border bg-gradient-to-br ${current.shell} p-4 text-left shadow-lg ${current.glow} ${onClick ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98]' : ''}`}
    >
      <div className="absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/70 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${current.text}`}>{label}</p>
          <p className="mt-2 text-2xl font-black leading-none text-slate-950">{value}</p>
          <p className="mt-2 text-[11px] font-bold uppercase leading-snug text-slate-400">{detail}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${current.icon} text-white shadow-lg`}>
          <Icon size={20} />
        </div>
      </div>
    </Component>
  );
};

const MusicMetricsPanel = ({ metrics, onOpenUnique, onOpenRepeated }: { metrics: {
  totalExecutions: number;
  uniqueSongs: number;
  dominantGenre: string;
  repeatedSongs: number;
  topArtist: string;
  topTrack: string;
}; onOpenUnique: () => void; onOpenRepeated: () => void }) => (
  <section className="mb-8 rounded-[2rem] border border-white/80 bg-white/85 p-5 shadow-xl shadow-[#5279FF]/15 backdrop-blur">
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#EA7F9F]">Resumo musical</p>
        <h2 className="text-xl font-black uppercase tracking-tight text-slate-950">RAIO-X DA PROGRAMAÇÃO</h2>
      </div>
      <p className="max-w-xl text-xs font-bold uppercase leading-relaxed text-slate-400">Métricas calculadas com os filtros atuais, sem alterar consultas, banco ou funcionamento existente.</p>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard icon={Activity} label="Execuções" value={metrics.totalExecutions} detail="Registros no filtro atual" accent="cyan" />
      <MetricCard icon={Music} label="Músicas únicas" value={metrics.uniqueSongs} detail={metrics.uniqueSongs ? "Clique para ver a lista" : "Faixas diferentes tocadas"} accent="fuchsia" onClick={onOpenUnique} />
      <MetricCard icon={Trophy} label="Gênero dominante" value={metrics.dominantGenre} detail="Maior presença na seleção" accent="amber" />
      <MetricCard icon={RefreshCw} label="Repetidas" value={metrics.repeatedSongs} detail={metrics.repeatedSongs ? "Clique para ver a lista" : "Músicas com mais de 1 execução"} accent="violet" onClick={onOpenRepeated} />
      <div className="relative overflow-hidden rounded-[1.6rem] border border-[#D0FF03]/50 bg-gradient-to-br from-[#0D0056] via-[#20137f] to-[#5279FF] p-4 text-white shadow-lg shadow-[#5279FF]/20 sm:col-span-2">
        <div className="absolute -right-10 -top-14 h-32 w-32 rounded-full bg-[#D0FF03]/35 blur-3xl" />
        <div className="absolute -bottom-16 left-8 h-28 w-28 rounded-full bg-[#5279FF]/30 blur-3xl" />
        <div className="relative flex h-full items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D0FF03]">Artista mais executado</p>
            <p className="mt-2 text-xl font-black uppercase leading-tight text-white">{metrics.topArtist}</p>
            <p className="mt-2 text-[11px] font-bold uppercase text-neutral-300">Mesmo tipo de conta do ranking de artistas</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#D0FF03] ring-1 ring-white/10">
            <Trophy size={22} />
          </div>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-[1.6rem] border border-[#EA7F9F]/60 bg-gradient-to-br from-[#EA7F9F] via-[#EA7F9F] to-[#D0FF03] p-4 text-white shadow-lg shadow-pink-200/70 sm:col-span-2">
        <div className="absolute -right-10 -top-14 h-32 w-32 rounded-full bg-white/30 blur-3xl" />
        <div className="absolute -bottom-16 left-8 h-28 w-28 rounded-full bg-[#EA7F9F]/35 blur-3xl" />
        <div className="relative flex h-full items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#0D0056]">Música mais executada</p>
            <p className="mt-2 text-xl font-black uppercase leading-tight text-white">{metrics.topTrack}</p>
            <p className="mt-2 text-[11px] font-bold uppercase text-[#0D0056]/70">Faixa individual com maior repetição</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#0D0056] ring-1 ring-white/10">
            <TrendingUp size={22} />
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ProgrammingVarietyPanel = ({ metrics }: { metrics: {
  varietyIndex: number;
  uniqueSongs: number;
  totalExecutions: number;
  repetitionRate: number;
  repeatedExecutions: number;
  topTenConcentration: number;
  topTenExecutions: number;
  artistDiversity: number;
} }) => {
  const indicators = [
    {
      label: 'ÍNDICE DE VARIEDADE',
      value: `${metrics.varietyIndex}%`,
      detail: `${metrics.uniqueSongs} músicas únicas em ${metrics.totalExecutions} execuções`,
      bar: 'bg-[#D0FF03]',
      shell: 'border-[#D0FF03]/45 bg-[#D0FF03]/10',
      text: 'text-[#0D0056]',
    },
    {
      label: 'TAXA DE REPETIÇÃO',
      value: `${metrics.repetitionRate}%`,
      detail: `${metrics.repeatedExecutions} execuções pertencem a faixas repetidas`,
      bar: 'bg-[#EA7F9F]',
      shell: 'border-[#EA7F9F]/40 bg-[#EA7F9F]/10',
      text: 'text-[#0D0056]',
    },
    {
      label: 'CONCENTRAÇÃO TOP 10',
      value: `${metrics.topTenConcentration}%`,
      detail: `${metrics.topTenExecutions} execuções estão nas 10 mais tocadas`,
      bar: 'bg-[#5279FF]',
      shell: 'border-[#5279FF]/35 bg-[#5279FF]/10',
      text: 'text-[#0D0056]',
    },
    {
      label: 'DIVERSIDADE DE ARTISTAS',
      value: metrics.artistDiversity,
      detail: 'artistas diferentes no período selecionado',
      bar: 'bg-[#0D0056]',
      shell: 'border-[#0D0056]/20 bg-[#0D0056]/5',
      text: 'text-[#0D0056]',
    },
  ];

  return (
    <section className="mb-8 rounded-[2rem] border border-[#0D0056]/15 bg-white/85 p-5 shadow-xl shadow-[#5279FF]/15 backdrop-blur">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#5279FF]">Inteligência da programação</p>
          <h2 className="text-xl font-black uppercase tracking-tight text-slate-950">VARIEDADE E CONCENTRAÇÃO</h2>
        </div>
        <p className="max-w-xl text-xs font-bold uppercase leading-relaxed text-slate-400">Leitura calculada apenas com as músicas do filtro atual.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {indicators.map(indicator => (
          <div key={indicator.label} className={`rounded-[1.5rem] border p-4 ${indicator.shell}`}>
            <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${indicator.text}`}>{indicator.label}</p>
            <p className="mt-2 text-3xl font-black leading-none text-slate-950">{indicator.value}</p>
            <p className="mt-2 min-h-8 text-[11px] font-bold uppercase leading-snug text-slate-500">{indicator.detail}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
              <div className={`h-full rounded-full ${indicator.bar}`} style={{ width: `${indicator.label === 'DIVERSIDADE DE ARTISTAS' ? Math.min(100, (metrics.artistDiversity / Math.max(metrics.totalExecutions, 1)) * 100) : Number(String(indicator.value).replace('%', ''))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const UniqueTracksModal = ({ tracks, onClose }: { tracks: { artista: string; musica: string; count: number }[]; onClose: () => void }) => (
  <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#0D0056]/75 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/15 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 bg-gradient-to-r from-[#EA7F9F] to-[#5279FF] p-6 text-white">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D0FF03]">Músicas únicas</p>
          <h3 className="mt-1 text-2xl font-black uppercase tracking-tight">Faixas diferentes tocadas</h3>
          <p className="mt-2 text-xs font-bold uppercase text-white/75">Lista calculada com os filtros atuais</p>
        </div>
        <button onClick={onClose} className="rounded-2xl bg-white/10 p-3 text-white transition hover:bg-white/20" aria-label="Fechar lista de músicas únicas">
          <X size={18} />
        </button>
      </div>
      <div className="max-h-[58vh] overflow-y-auto p-4">
        {tracks.length ? (
          <div className="space-y-2">
            {tracks.map((track, index) => (
              <div key={`${track.artista}-${track.musica}`} className="flex items-center justify-between gap-4 rounded-2xl border border-[#5279FF]/10 bg-slate-50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#EA7F9F] to-[#5279FF] text-xs font-black text-white">#{index + 1}</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase text-[#0D0056]">{track.musica}</p>
                    <p className="truncate text-xs font-bold uppercase text-slate-400">{track.artista}</p>
                  </div>
                </div>
                <div className="shrink-0 rounded-full bg-[#D0FF03]/25 px-3 py-1.5 text-xs font-black uppercase text-[#0D0056]">{track.count}x</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-14 text-center">
            <p className="text-lg font-black uppercase text-slate-300">Nenhuma música encontrada</p>
            <p className="mt-2 text-sm font-bold text-slate-400">Os filtros atuais não têm faixas para exibir.</p>
          </div>
        )}
      </div>
    </div>
  </div>
);

const RepeatedTracksModal = ({ tracks, onClose }: { tracks: { artista: string; musica: string; count: number }[]; onClose: () => void }) => (
  <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#0D0056]/75 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/15 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 bg-[#0D0056] p-6 text-white">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#D0FF03]">Repetidas</p>
          <h3 className="mt-1 text-2xl font-black uppercase tracking-tight">Músicas com repetição</h3>
          <p className="mt-2 text-xs font-bold uppercase text-slate-400">Lista calculada com os filtros atuais</p>
        </div>
        <button onClick={onClose} className="rounded-2xl bg-white/10 p-3 text-white transition hover:bg-white/20" aria-label="Fechar lista de repetidas">
          <X size={18} />
        </button>
      </div>
      <div className="max-h-[58vh] overflow-y-auto p-4">
        {tracks.length ? (
          <div className="space-y-2">
            {tracks.map((track, index) => (
              <div key={`${track.artista}-${track.musica}`} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5279FF] to-[#EA7F9F] text-xs font-black text-white">#{index + 1}</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase text-slate-900">{track.musica}</p>
                    <p className="truncate text-xs font-bold uppercase text-slate-400">{track.artista}</p>
                  </div>
                </div>
                <div className="shrink-0 rounded-full bg-[#5279FF]/15 px-3 py-1.5 text-xs font-black uppercase text-[#0D0056]">{track.count}x</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-14 text-center">
            <p className="text-lg font-black uppercase text-slate-300">Nenhuma música repetida</p>
            <p className="mt-2 text-sm font-bold text-slate-400">Os filtros atuais não têm faixas com mais de uma execução.</p>
          </div>
        )}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// TIPOS DO SELETOR DE PERÍODO — ARTISTAS MAIS EXECUTADOS
// ─────────────────────────────────────────────────────────────
type TopPeriod = 'today' | '7d' | '30d' | '3m' | '1y';

const TOP_PERIOD_OPTIONS: { value: TopPeriod; label: string; shortLabel: string; emoji: string }[] = [
  { value: 'today', label: 'Hoje',     shortLabel: 'Hoje',   emoji: '☀️' },
  { value: '7d',    label: '7 dias',   shortLabel: '7d',     emoji: '📅' },
  { value: '30d',   label: '30 dias',  shortLabel: '30d',    emoji: '🗓️' },
  { value: '3m',    label: '3 meses',  shortLabel: '3m',     emoji: '📆' },
  { value: '1y',    label: '1 ano',    shortLabel: '1a',     emoji: '🏆' },
];

function getPeriodCutoff(period: TopPeriod): string {
  const now = new Date();
  if (period === 'today') {
    const today = getTodayBrasilia();
    return brasiliaLocalToUTC(`${today}T00:00:00`);
  }
  const daysMap: Record<TopPeriod, number> = { today: 0, '7d': 7, '30d': 30, '3m': 90, '1y': 365 };
  const days = daysMap[period];
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - days);
  return cutoff.toISOString();
}

// ─────────────────────────────────────────────────────────────
// loadTracksForPeriod — busca execuções do período
// ─────────────────────────────────────────────────────────────
async function loadTracksForPeriod(radio: string, period: TopPeriod): Promise<any[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const cutoff = getPeriodCutoff(period);
  const { data: rows, error } = await supabase
    .from('radio_airplay')
    .select('artista, musica, capa, genero, tocou_em, bpm')
    .eq('radio', radio)
    .gte('tocou_em', cutoff)
    .order('tocou_em', { ascending: false });
  if (error) return [];
  return (rows || [])
    .map((t: any) => {
      const { data: d, hora, timestamp } = parseTocouEm(t.tocou_em);
      return { artista: t.artista || 'Desconhecido', musica: t.musica || 'Sem Título', capa: t.capa, genero: t.genero || 'Desconhecido', data: d, hora, timestamp, bpm: t.bpm, tocou_em: t.tocou_em };
    })
    .filter((t: any) => !isBlocked(t.artista, t.musica, radio));
}

const topArtistsCache: Record<string, any[]> = {};

// ─────────────────────────────────────────────────────────────
// ARTISTAS MAIS EXECUTADOS — com seletor de período próprio
// ─────────────────────────────────────────────────────────────
const TOP_PER_COL = 5;

const TopArtistsCard = ({ radio }: { radio: string }) => {
  const [period, setPeriod] = useState<TopPeriod>('today');
  const [periodData, setPeriodData] = useState<any[]>([]);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photosLoading, setPhotosLoading] = useState(false);
  const [modalArtist, setModalArtist] = useState<string | null>(null);
  const [visibleTop, setVisibleTop] = useState(TOP_PER_COL);

  const fetchPeriodData = useCallback(async (r: string, p: TopPeriod) => {
    const cacheKey = `${r}___${p}`;
    if (p !== 'today' && topArtistsCache[cacheKey]) {
      setPeriodData(topArtistsCache[cacheKey]);
      return;
    }
    setLoadingPeriod(true);
    try {
      const rows = await loadTracksForPeriod(r, p);
      if (p !== 'today') topArtistsCache[cacheKey] = rows;
      setPeriodData(rows);
    } catch (err) { console.error('Erro loadTracksForPeriod:', err); }
    finally { setLoadingPeriod(false); }
  }, []);

  useEffect(() => {
    setVisibleTop(TOP_PER_COL);
    fetchPeriodData(radio, period);
  }, [radio, period, fetchPeriodData]);

  const topArtists = useMemo(() => {
    const counts: Record<string, { count: number; genero: string; capa: string; musica: string }> = {};
    periodData.forEach(t => {
      if (!counts[t.artista]) counts[t.artista] = { count: 0, genero: t.genero, capa: t.capa || '', musica: t.musica };
      counts[t.artista].count++;
      if (!counts[t.artista].capa && t.capa) counts[t.artista].capa = t.capa;
    });
    return Object.entries(counts)
      .map(([artista, info]) => ({ artista, ...info }))
      .sort((a, b) => b.count - a.count);
  }, [periodData]);

  useEffect(() => {
    if (!topArtists.length) return;
    const toLoad = topArtists.slice(0, visibleTop);
    const needLoad = toLoad.filter(a => artistPhotoCache[a.artista] === undefined);
    if (!needLoad.length) {
      const map: Record<string, string> = {};
      toLoad.forEach(a => { map[a.artista] = artistPhotoCache[a.artista] || ''; });
      setPhotos(prev => ({ ...prev, ...map }));
      return;
    }
    setPhotosLoading(true);
    Promise.all(toLoad.map(async a => ({ artista: a.artista, photo: await fetchArtistPhoto(a.artista) })))
      .then(results => {
        setPhotos(prev => {
          const map = { ...prev };
          results.forEach(r => { map[r.artista] = r.photo; });
          return map;
        });
        setPhotosLoading(false);
      });
  }, [topArtists, visibleTop]);

  const periodLabel = TOP_PERIOD_OPTIONS.find(o => o.value === period)?.label || '';

  const modalArtistData = modalArtist
    ? { tracks: periodData.filter(t => t.artista === modalArtist), photo: photos[modalArtist] || topArtists.find(a => a.artista === modalArtist)?.capa || '' }
    : null;

  const visible = topArtists.slice(0, visibleTop);
  const hasMore = visibleTop < topArtists.length;

  return (
    <>
      {modalArtist && modalArtistData && (
        <ArtistModal
          artist={modalArtist}
          tracks={modalArtistData.tracks}
          photo={modalArtistData.photo}
          periodLabel={periodLabel}
          onClose={() => setModalArtist(null)}
        />
      )}
      <div className="bg-gradient-to-br from-[#D0FF03]/10 via-white to-[#EA7F9F]/15 p-8 rounded-[2rem] shadow-xl shadow-[#EA7F9F]/20 mb-8 border border-[#EA7F9F]/25">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-[#D0FF03] via-[#EA7F9F] to-[#5279FF] p-4 rounded-2xl shadow-lg shadow-pink-200/70">
              <Trophy className="text-white" size={28} />
            </div>
            <div>
              <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">OS ARTISTAS MAIS EXECUTADOS DA RÁDIO</h2>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">
                {period === 'today' ? 'ATUALIZADO HOJE • DESDE A MEIA-NOITE' : `ATUALIZADO ÚLTIMOS ${periodLabel.toUpperCase()}`} • TOQUE NA FOTO DO ARTISTA PARA VER AS MÚSICAS
              </p>
            </div>
          </div>
          {loadingPeriod && (
            <Loader2 size={20} className="animate-spin text-[#5279FF] flex-shrink-0 mt-1" />
          )}
        </div>

        <div className="flex gap-2 flex-wrap mb-6">
          {TOP_PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl font-black text-xs uppercase tracking-wide transition-all ${
                period === opt.value
                  ? 'bg-[#0D0056] text-[#D0FF03] shadow-lg shadow-[#5279FF]/25 scale-105'
                  : 'bg-white/90 text-[#0D0056] border border-[#5279FF]/25 hover:border-[#EA7F9F] hover:text-[#0D0056]'
              }`}
            >
              <span>{opt.emoji}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {loadingPeriod ? (
          <div className="flex items-center justify-center gap-3 py-12 text-[#5279FF]">
            <Loader2 size={28} className="animate-spin" />
            <span className="font-black uppercase text-sm">CARREGANDO OS ARTISTAS MAIS EXECUTADOS DA RÁDIO...</span>
          </div>
        ) : topArtists.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🎵</div>
            <p className="font-black text-slate-400 uppercase">Nenhum dado disponível</p>
            <p className="text-slate-400 text-sm mt-1">Tente outro período</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3">
              {visible.map((artist, idx) => {
                const photo = photos[artist.artista] || artist.capa || '';
                const rank = idx + 1;
                return (
                  <div key={artist.artista} className="flex flex-col items-center text-center group">
                    <div className="relative mb-3">
                      <div className={`absolute -top-2 -left-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-md ${
                        rank===1?'bg-[#D0FF03] text-[#0D0056]':rank===2?'bg-[#5279FF] text-white':rank===3?'bg-[#EA7F9F] text-[#0D0056]':'bg-[#0D0056]/10 text-[#0D0056]'
                      }`}>
                        {rank <= 3 ? ['1°','2°','3°'][rank-1] : `${rank}°`}
                      </div>
                      <button
                        onClick={() => setModalArtist(artist.artista)}
                        className={`relative block w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden shadow-lg ring-4 transition-all group-hover:scale-105 cursor-pointer ${
                          rank===1?'ring-[#D0FF03]':rank===2?'ring-[#5279FF]':rank===3?'ring-[#EA7F9F]':'ring-[#0D0056]/15'
                        }`}
                        title={`Ver playlist de ${artist.artista} — ${periodLabel}`}
                      >
                        {photo
                          ? <img src={photo} alt={artist.artista} className="w-full h-full object-cover" onError={(e)=>{(e.target as HTMLImageElement).style.display='none';}}/>
                          : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#D0FF03]/20 to-[#EA7F9F]/25"><Music size={24} className="text-[#5279FF]" /></div>
                        }
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-1">
                            <Music size={16} className="text-white drop-shadow-lg" />
                            <span className="text-white text-[9px] font-black drop-shadow-lg">PLAYLIST</span>
                          </div>
                        </div>
                      </button>
                      {photosLoading && !photo && (
                        <div className="absolute inset-0 rounded-2xl bg-white/60 flex items-center justify-center">
                          <Loader2 size={16} className="animate-spin text-[#5279FF]" />
                        </div>
                      )}
                    </div>
                    <p className="font-black text-slate-800 text-xs leading-tight truncate w-full">{artist.artista}</p>
                    <p className="font-bold text-[#0D0056] text-[10px] mt-1 flex items-center gap-1 justify-center">
                      <TrendingUp size={9} />
                      {artist.count} exec{artist.count !== 1 ? 'uções' : 'ução'}
                    </p>
                    {artist.genero && artist.genero !== 'Desconhecido' && (
                      <span className="mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase text-white" style={{ backgroundColor: GENRE_COLORS[artist.genero] || '#5279FF' }}>
                        {artist.genero}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <button
                onClick={() => setVisibleTop(v => v + TOP_PER_COL)}
                className="mt-6 w-full py-3 bg-white/90 border-2 border-[#5279FF]/25 hover:border-[#EA7F9F] text-[#0D0056] rounded-2xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all hover:shadow-md"
              >
                <Plus size={14} /> Ver mais artistas ({topArtists.length - visibleTop} restantes)
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// MÚSICAS MAIS EXECUTADAS — com seletor de período próprio
// ─────────────────────────────────────────────────────────────
const topTracksCache: Record<string, any[]> = {};
const TOP_TRACK_LIMITS = [5, 10, 20];

const TopTracksCard = ({ radio }: { radio: string }) => {
  const [period, setPeriod] = useState<TopPeriod>('today');
  const [periodData, setPeriodData] = useState<any[]>([]);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(5);
  const [selectedTrack, setSelectedTrack] = useState<{ artista: string; musica: string; capa: string; execucoes: ExecucaoItem[] } | null>(null);

  const fetchPeriodData = useCallback(async (r: string, p: TopPeriod) => {
    const cacheKey = `${r}___${p}`;
    if (p !== 'today' && topTracksCache[cacheKey]) {
      setPeriodData(topTracksCache[cacheKey]);
      return;
    }
    setLoadingPeriod(true);
    try {
      const rows = await loadTracksForPeriod(r, p);
      if (p !== 'today') topTracksCache[cacheKey] = rows;
      setPeriodData(rows);
    } catch (err) { console.error('Erro loadTracksForPeriod:', err); }
    finally { setLoadingPeriod(false); }
  }, []);

  useEffect(() => {
    fetchPeriodData(radio, period);
  }, [radio, period, fetchPeriodData]);

  const topTracks = useMemo(() => {
    const counts: Record<string, { artista: string; musica: string; count: number; genero: string; capa: string; execucoes: ExecucaoItem[] }> = {};
    periodData.forEach(t => {
      const key = `${t.artista}|||${t.musica}`;
      if (!counts[key]) {
        counts[key] = { artista: t.artista, musica: t.musica, count: 0, genero: t.genero, capa: t.capa || '', execucoes: [] };
      }
      counts[key].count++;
      counts[key].execucoes.push({ data: t.data, hora: t.hora, tocou_em: t.tocou_em });
      if (!counts[key].capa && t.capa) counts[key].capa = t.capa;
    });
    return Object.values(counts)
      .sort((a, b) => b.count - a.count || a.musica.localeCompare(b.musica));
  }, [periodData]);

  const periodLabel = TOP_PERIOD_OPTIONS.find(o => o.value === period)?.label || '';
  const visibleTracks = topTracks.slice(0, visibleLimit);

  return (
    <>
      {selectedTrack && (
        <TrackExecutionsModal
          artista={selectedTrack.artista}
          musica={selectedTrack.musica}
          capa={selectedTrack.capa}
          execucoes={selectedTrack.execucoes}
          periodLabel={period === 'today' ? 'HOJE' : `ÚLTIMOS ${periodLabel.toUpperCase()}`}
          onClose={() => setSelectedTrack(null)}
        />
      )}
      <section className="mb-8 rounded-[2rem] border border-[#5279FF]/20 bg-gradient-to-br from-[#5279FF]/10 via-white to-[#D0FF03]/10 p-6 shadow-xl shadow-[#5279FF]/15">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-gradient-to-br from-[#0D0056] via-[#5279FF] to-[#EA7F9F] p-4 shadow-lg shadow-[#5279FF]/25">
              <Music className="text-[#D0FF03]" size={28} />
            </div>
            <div>
              <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">MÚSICAS MAIS EXECUTADAS</h2>
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
                {period === 'today' ? 'ATUALIZADO HOJE • DESDE A MEIA-NOITE' : `ATUALIZADO ÚLTIMOS ${periodLabel.toUpperCase()}`} • TOQUE NA MÚSICA PARA VER AS EXECUÇÕES
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start rounded-2xl border border-[#D0FF03]/30 bg-[#D0FF03]/10 p-1.5">
            <span className="px-2 text-[10px] font-black uppercase tracking-wider text-[#0D0056]">Exibir</span>
            {TOP_TRACK_LIMITS.map(limit => (
              <button
                key={limit}
                type="button"
                onClick={() => setVisibleLimit(limit)}
                className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${
                  visibleLimit === limit ? 'bg-[#0D0056] text-[#D0FF03] shadow-md' : 'text-[#0D0056] hover:bg-white'
                }`}
              >
                {limit}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {TOP_PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPeriod(opt.value)}
              className={`flex items-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-wide transition-all ${
                period === opt.value
                  ? 'bg-[#EA7F9F] text-[#0D0056] shadow-lg shadow-[#EA7F9F]/30 scale-105'
                  : 'border border-[#5279FF]/25 bg-white/90 text-[#0D0056] hover:border-[#D0FF03] hover:bg-[#D0FF03]/10'
              }`}
            >
              <span>{opt.emoji}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {loadingPeriod ? (
          <div className="flex items-center justify-center gap-3 py-12 text-[#5279FF]">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm font-black uppercase">Carregando músicas mais executadas...</span>
          </div>
        ) : topTracks.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-5xl">🎵</div>
            <p className="font-black uppercase text-slate-400">Nenhum dado disponível</p>
            <p className="mt-1 text-sm text-slate-400">Tente outro período</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleTracks.map((track, index) => (
              <button
                key={`${track.artista}|||${track.musica}`}
                type="button"
                onClick={() => setSelectedTrack(track)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-[#5279FF]/15 bg-white/90 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#EA7F9F] hover:shadow-lg"
                title={`Ver execuções de ${track.musica}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${
                  index === 0 ? 'bg-[#D0FF03] text-[#0D0056]' : index === 1 ? 'bg-[#5279FF] text-white' : index === 2 ? 'bg-[#EA7F9F] text-[#0D0056]' : 'bg-[#0D0056]/10 text-[#0D0056]'
                }`}>
                  {index + 1}º
                </div>
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#5279FF]/10 shadow">
                  {track.capa ? <img src={track.capa} alt={track.musica} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><Music size={18} className="text-[#5279FF]" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black uppercase text-slate-900">{track.musica}</p>
                  <p className="truncate text-xs font-bold uppercase text-[#0D0056]">{track.artista}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {track.genero && track.genero !== 'Desconhecido' && <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase text-white" style={{ backgroundColor: GENRE_COLORS[track.genero] || '#5279FF' }}>{track.genero}</span>}
                    <span className="text-[10px] font-bold uppercase text-slate-400 group-hover:text-[#5279FF]">Ver execuções</span>
                  </div>
                </div>
                <div className="shrink-0 rounded-full bg-[#D0FF03]/25 px-3 py-1.5 text-xs font-black uppercase text-[#0D0056]">
                  {track.count}x
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// GRÁFICO DE GÊNEROS
// ─────────────────────────────────────────────────────────────
const GenreChart = ({ data, chartRef }: { data: any[]; chartRef?: React.RefObject<HTMLDivElement> }) => {
  if (!data || !data.length) return null;
  const knownGenres = data.filter(g => g.name !== 'Desconhecido');
  if (!knownGenres.length) return null;
  const mainGenres = knownGenres.filter(g => parseFloat(g.percentage) >= 3);
  const smallGenres = knownGenres.filter(g => parseFloat(g.percentage) < 3);
  let chartData = [...mainGenres];
  if (smallGenres.length > 0) {
    const ov = smallGenres.reduce((s,g)=>s+g.value,0);
    const tk = knownGenres.reduce((s,g)=>s+g.value,0);
    chartData.push({name:'Outros',value:ov,percentage:((ov/tk)*100).toFixed(1),subGenres:smallGenres.map(g=>g.name)});
  }
  chartData = chartData.sort((a,b)=>b.value-a.value);
  return (
    <div ref={chartRef} className="bg-gradient-to-br from-[#5279FF]/10 via-white to-[#EA7F9F]/10 p-8 rounded-[2rem] shadow-xl shadow-[#5279FF]/15 mb-8 border border-[#5279FF]/20">
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-gradient-to-br from-[#5279FF] via-[#334dcc] to-[#0D0056] p-4 rounded-2xl shadow-lg shadow-[#5279FF]/25"><TrendingUp className="text-white" size={28} /></div>
        <div>
          <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">Análise de Gêneros</h2>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Distribuição Musical (Sem Desconhecidos)</p>
        </div>
      </div>
      <div className="bg-white/90 p-6 rounded-2xl shadow-inner border border-slate-100">
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie data={chartData} cx="50%" cy="50%" labelLine={false}
              label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}
              outerRadius={120} innerRadius={60} fill="#5279FF" dataKey="value" paddingAngle={2}>
              {chartData.map((_,i)=>(<Cell key={i} fill={GENRE_COLORS[chartData[i].name]||'#9DA8D7'} stroke="#fff" strokeWidth={2}/>))}
            </Pie>
            <Tooltip content={<CustomTooltip/>}/>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {chartData.map(genre=>(
          <div key={genre.name} className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
            <div className="w-5 h-5 rounded-full shadow-md flex-shrink-0" style={{backgroundColor:GENRE_COLORS[genre.name]||'#9DA8D7'}}/>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-slate-700 uppercase truncate">{genre.name}</p>
              <p className="text-xs text-slate-500 font-bold">{genre.value} músicas • {genre.percentage}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// DATE PICKER
// ─────────────────────────────────────────────────────────────
const DatePicker = ({ value, availableDates, loadingDates, datesLoaded, onChange, onOpen }: {
  value: string;
  availableDates: string[];
  loadingDates: boolean;
  datesLoaded: boolean;
  onChange: (d: string) => void;
  onOpen: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && !datesLoaded) onOpen();
    setOpen(o => !o);
  };

  const handleSelect = (d: string) => { onChange(d); setOpen(false); };

  const displayDates = datesLoaded ? availableDates : (value ? [value] : []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={handleToggle}
        className="w-full flex items-center gap-3 pl-4 pr-4 py-3 bg-slate-50 rounded-2xl font-bold text-slate-700 border-2 border-transparent hover:border-[#D0FF03] focus:border-[#D0FF03] focus:outline-none transition-all cursor-pointer">
        {loadingDates
          ? <Loader2 size={16} className="text-[#5279FF] animate-spin flex-shrink-0" />
          : <CalendarDays size={16} className="text-[#5279FF] flex-shrink-0" />}
        <span className="flex-1 text-left text-sm">{value ? formatDateBR(value) : 'Selecionar data'}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-[80] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
          {loadingDates ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm font-bold">Carregando datas disponíveis...</span>
            </div>
          ) : displayDates.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm font-bold">Nenhuma data disponível</div>
          ) : (
            displayDates.map((d, i) => (
              <button key={d} type="button" onClick={() => handleSelect(d)}
                className={`w-full text-left px-5 py-3 text-sm font-bold transition-all hover:bg-[#5279FF]/10 ${d === value ? 'bg-[#5279FF]/15 text-[#0D0056]' : 'text-slate-700'}`}>
                📅 {formatDateBR(d)}
                {i === 0 && !datesLoaded && <span className="ml-2 text-[10px] font-black text-[#0D0056] uppercase">Hoje</span>}
                {datesLoaded && d === displayDates[0] && <span className="ml-2 text-[10px] font-black text-[#0D0056] uppercase">Mais recente</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// YEAR PICKER — seletor de ano de lançamento
// ─────────────────────────────────────────────────────────────
const YearPicker = ({ value, availableYears, onChange }: {
  value: string;
  availableYears: number[];
  onChange: (y: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (y: string) => { onChange(y); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 pl-4 pr-4 py-3 rounded-2xl font-bold text-slate-700 border-2 transition-all cursor-pointer text-sm ${
          value ? 'bg-[#5279FF]/10 border-[#5279FF] text-[#0D0056]' : 'bg-slate-50 border-transparent hover:border-[#5279FF]'
        }`}>
        <CalendarDays size={16} className={value ? 'text-[#5279FF] flex-shrink-0' : 'text-slate-400 flex-shrink-0'} />
        <span className="flex-1 text-left">{value ? `Ano: ${value}` : 'Ano de lançamento'}</span>
        {value && (
          <span
            onClick={e => { e.stopPropagation(); onChange(''); }}
            className="text-[#5279FF] hover:text-[#0D0056] font-black text-xs cursor-pointer"
          >✕</span>
        )}
        <ChevronDown size={16} className={`text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-[80] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
          <button type="button" onClick={() => handleSelect('')}
            className={`w-full text-left px-5 py-3 text-sm font-bold transition-all hover:bg-[#5279FF]/10 ${!value ? 'bg-[#5279FF]/15 text-[#0D0056]' : 'text-slate-500'}`}>
            🗓️ Todos os anos
          </button>
          {availableYears.map(y => (
            <button key={y} type="button" onClick={() => handleSelect(String(y))}
              className={`w-full text-left px-5 py-3 text-sm font-bold transition-all hover:bg-[#5279FF]/10 ${String(y) === value ? 'bg-[#5279FF]/15 text-[#0D0056]' : 'text-slate-700'}`}>
              🎵 {y}
            </button>
          ))}
          {availableYears.length === 0 && (
            <div className="py-6 text-center text-slate-400 text-sm font-bold">Nenhum ano disponível</div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// FETCH DATA
// ─────────────────────────────────────────────────────────────
function getBrasiliaDateBounds(date: string): { dayStart: string; dayEnd: string } {
  const dayStart = brasiliaLocalToUTC(`${date}T00:00:00`);
  const dayEnd   = brasiliaLocalToUTC(`${date}T23:59:59`);
  return { dayStart, dayEnd };
}

async function loadDayData(radio: string, date: string): Promise<any[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !date) return [];
  const { dayStart, dayEnd } = getBrasiliaDateBounds(date);
  const { data: tracks, error } = await supabase
    .from('radio_airplay').select('*')
    .eq('radio', radio)
    .gte('tocou_em', dayStart).lte('tocou_em', dayEnd)
    .order('tocou_em', { ascending: false });
  if (error) throw error;
  return (tracks || [])
    .map((t: any) => {
      const { data: d, hora, timestamp } = parseTocouEm(t.tocou_em);
      return { id: t.id, artista: t.artista || 'Desconhecido', musica: t.musica || 'Sem Título', radio: t.radio, genero: t.genero || 'Desconhecido', data: d, hora, timestamp, capa: t.capa, bpm: t.bpm, ano_lancamento: t.ano_lancamento ?? null };
    })
    .filter((t: any) => !isBlocked(t.artista, t.musica, t.radio));
}

async function loadWeeklyData(radio: string): Promise<any[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const now = new Date();
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(now.getDate() - 14);
  const { data: tracks, error } = await supabase
    .from('radio_airplay')
    .select('artista, musica, capa, genero, tocou_em, bpm')
    .eq('radio', radio)
    .gte('tocou_em', twoWeeksAgo.toISOString())
    .order('tocou_em', { ascending: false });
  if (error) return [];
  return (tracks || [])
    .map((t: any) => {
      const { data: d, hora, timestamp } = parseTocouEm(t.tocou_em);
      return { artista: t.artista || 'Desconhecido', musica: t.musica || 'Sem Título', capa: t.capa, genero: t.genero || 'Desconhecido', data: d, hora, timestamp, bpm: t.bpm, tocou_em: t.tocou_em };
    })
    .filter((t: any) => !isBlocked(t.artista, t.musica, radio));
}

async function loadLatestDate(radio: string): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) return '';
  const { data: rows } = await supabase
    .from('radio_airplay')
    .select('tocou_em')
    .eq('radio', radio)
    .order('tocou_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rows?.tocou_em) return '';
  return parseTocouEm(rows.tocou_em).data;
}

async function loadAvailableDates(radio: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const allDates = new Set<string>();
  let from = 0;
  while (true) {
    const { data: rows, error } = await supabase
      .from('radio_airplay')
      .select('tocou_em')
      .eq('radio', radio)
      .order('tocou_em', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !rows || rows.length === 0) break;
    rows.forEach((r: any) => allDates.add(parseTocouEm(r.tocou_em).data));
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return [...allDates].sort().reverse();
}

const datesCache: Record<string, string[]> = {};
const weeklyCache: Record<string, any[]> = {};

// ─────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────
const App = () => {
  const [data, setData] = useState<any[]>([]);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '', hour: 'all', shift: 'all', bpm: 'all', ano: '' });
  const [visibleCount, setVisibleCount] = useState(9);
  const [execModal, setExecModal] = useState<{ artista: string; musica: string; capa: string; execucoes: ExecucaoItem[] } | null>(null);
  const [showUniqueModal, setShowUniqueModal] = useState(false);
  const [showRepeatedModal, setShowRepeatedModal] = useState(false);
  const chartRef = React.useRef<HTMLDivElement>(null);

  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const weeklyLast7 = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return weeklyData.filter(t => t.timestamp >= cutoff);
  }, [weeklyData]);

  const weeklyExecsMap = useMemo(() => {
    const map: Record<string, ExecucaoItem[]> = {};
    weeklyLast7.forEach(t => {
      const k = `${t.artista}|||${t.musica}`;
      if (!map[k]) map[k] = [];
      map[k].push({ data: t.data, hora: t.hora, tocou_em: t.tocou_em });
    });
    return map;
  }, [weeklyLast7]);

  const doFetch = useCallback(async (radio: string, date: string, silent = false) => {
    if (!date) return;
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const rows = await loadDayData(radio, date);
      setData(rows);
    } catch (err) { console.error('Erro fetchData:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const fetchWeekly = useCallback(async (radio: string) => {
    if (weeklyCache[radio]) { setWeeklyData(weeklyCache[radio]); return; }
    try {
      const rows = await loadWeeklyData(radio);
      weeklyCache[radio] = rows;
      setWeeklyData(rows);
    } catch (err) { console.error('Erro loadWeeklyData:', err); }
  }, []);

  const handleOpenDatePicker = useCallback(async () => {
    const radio = filtersRef.current.radio;
    if (datesCache[radio]) {
      setAvailableDates(datesCache[radio]);
      setDatesLoaded(true);
      return;
    }
    if (loadingDates) return;
    setLoadingDates(true);
    try {
      const dates = await loadAvailableDates(radio);
      datesCache[radio] = dates;
      setAvailableDates(dates);
      setDatesLoaded(true);
    } catch (err) { console.error('Erro loadAvailableDates:', err); }
    finally { setLoadingDates(false); }
  }, [loadingDates]);

  useEffect(() => {
    (async () => {
      await waitForSupabase();
      const radio = 'Metropolitana FM';
      const today = await loadLatestDate(radio);
      if (today) {
        setFilters(f => ({ ...f, date: today }));
        await Promise.all([
          doFetch(radio, today),
          fetchWeekly(radio),
        ]);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (filters.date) doFetch(filters.radio, filters.date);
  }, [filters.date, filters.radio]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { radio, date } = filtersRef.current;
      if (date) doFetch(radio, date, true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [doFetch]);

  const handleRadioChange = useCallback(async (r: string) => {
    setData([]);
    setWeeklyData([]);
    setAvailableDates([]);
    setDatesLoaded(false);
    setVisibleCount(9);
    setFilters(f => ({ ...f, radio: r, date: '', search: '', genero: '', hour: 'all', bpm: 'all', ano: '' }));
    setLoading(true);
    const today = await loadLatestDate(r);
    if (today) {
      setFilters(f => ({ ...f, radio: r, date: today }));
      await Promise.all([
        doFetch(r, today),
        fetchWeekly(r),
      ]);
    } else {
      setLoading(false);
    }
  }, [doFetch, fetchWeekly]);

  // ── Anos disponíveis derivados dos dados carregados ──
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    data.forEach(t => { if (t.ano_lancamento) years.add(Number(t.ano_lancamento)); });
    return [...years].filter(y => !isNaN(y) && y > 0).sort((a, b) => b - a);
  }, [data]);

  const filteredData = useMemo(() => data.filter(t => {
    const matchSearch = filters.search ? (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true;
    const matchGenero = filters.genero ? t.genero === filters.genero : true;
    const matchHour   = filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true;
    const matchShift  = isHourInShift(t.hora, filters.shift);
    const matchAno    = filters.ano ? String(t.ano_lancamento) === filters.ano : true;
    let matchBpm = true;
    if (filters.bpm !== 'all' && t.bpm) {
      if (filters.bpm === 'slow') matchBpm = t.bpm < 100;
      else if (filters.bpm === 'moderate') matchBpm = t.bpm >= 100 && t.bpm <= 120;
      else if (filters.bpm === 'fast') matchBpm = t.bpm > 120;
    }
    return matchSearch && matchGenero && matchHour && matchShift && matchBpm && matchAno;
  }), [data, filters]);

  const repeatCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    filteredData.forEach(t => { const k = `${t.artista}|||${t.musica}`; map[k] = (map[k] || 0) + 1; });
    return map;
  }, [filteredData]);

  const genreData = useMemo(() => {
    const filtered = data.filter(t => (filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true) && isHourInShift(t.hora, filters.shift));
    const counts: Record<string, number> = {};
    filtered.forEach(t => { const g = t.genero || 'Desconhecido'; counts[g] = (counts[g] || 0) + 1; });
    const total = filtered.length;
    if (!total) return [];
    return Object.entries(counts).map(([name, value]) => ({ name, value, percentage: ((value / total) * 100).toFixed(1) })).sort((a, b) => b.value - a.value);
  }, [data, filters.hour, filters.shift]);

  // Mantém a lista de repetidas 100% sincronizada com os filtros ativos da playlist.
  const repeatedTracks = useMemo(() => Object.entries(repeatCountMap)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [artista, musica] = key.split('|||');
      return { artista, musica, count };
    })
    .sort((a, b) => b.count - a.count || a.musica.localeCompare(b.musica)), [repeatCountMap]);

  const uniqueTracks = useMemo(() => Object.entries(repeatCountMap)
    .map(([key, count]) => {
      const [artista, musica] = key.split('|||');
      return { artista, musica, count };
    })
    .sort((a, b) => a.musica.localeCompare(b.musica) || a.artista.localeCompare(b.artista)), [repeatCountMap]);

  const musicMetrics = useMemo(() => {
    const songKeys = new Set<string>();
    const genreCounts: Record<string, number> = {};
    const artistCounts: Record<string, number> = {};
    let topArtist = 'SEM DADOS';
    let topArtistCount = 0;
    let topTrack = 'SEM DADOS';
    let topTrackCount = 0;

    filteredData.forEach(t => {
      const songKey = `${t.artista}|||${t.musica}`;
      songKeys.add(songKey);
      if (t.artista) {
        artistCounts[t.artista] = (artistCounts[t.artista] || 0) + 1;
      }
      const genre = t.genero || 'Desconhecido';
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });

    Object.entries(artistCounts).forEach(([artista, count]) => {
      if (count > topArtistCount) {
        topArtistCount = count;
        topArtist = `${artista} • ${count}X`;
      }
    });

    Object.entries(repeatCountMap).forEach(([key, count]) => {
      if (count > topTrackCount) {
        topTrackCount = count;
        const [artista, musica] = key.split('|||');
        topTrack = `${musica} • ${artista} • ${count}X`;
      }
    });

    const dominantGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    return {
      totalExecutions: filteredData.length,
      uniqueSongs: songKeys.size,
      dominantGenre,
      repeatedSongs: Object.values(repeatCountMap).filter(count => count > 1).length,
      topArtist,
      topTrack,
    };
  }, [filteredData, repeatCountMap]);

  const programmingVarietyMetrics = useMemo(() => {
    const totalExecutions = filteredData.length;
    const uniqueSongs = Object.keys(repeatCountMap).length;
    const artistDiversity = new Set(filteredData.map(track => track.artista).filter(Boolean)).size;
    const counts = Object.values(repeatCountMap);
    const repeatedExecutions = counts.reduce((total, count) => total + (count > 1 ? count : 0), 0);
    const topTenExecutions = [...counts].sort((a, b) => b - a).slice(0, 10).reduce((total, count) => total + count, 0);
    const percentage = (value: number) => totalExecutions ? Math.round((value / totalExecutions) * 100) : 0;

    return {
      varietyIndex: percentage(uniqueSongs),
      uniqueSongs,
      totalExecutions,
      repetitionRate: percentage(repeatedExecutions),
      repeatedExecutions,
      topTenConcentration: percentage(topTenExecutions),
      topTenExecutions,
      artistDiversity,
    };
  }, [filteredData, repeatCountMap]);

  const uniqueGenres = useMemo(() => [...new Set(data.map(d => d.genero).filter(g => g && g !== 'Desconhecido'))].sort(), [data]);
  const hourOptions  = useMemo(() => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')), []);

  const exportPDF = async () => {
    if (!filteredData.length) { alert('Nenhum registro.'); return; }
    const doc = new jsPDF();
    doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text(`IA NO RADIO - ${filters.radio}`, 14, 20);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    const hourLabel = filters.hour === 'all' ? getShiftLabel(filters.shift) : `${filters.hour}:00`;
    doc.text(`Data: ${filters.date} | Horario: ${hourLabel}`, 14, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 14, 34);
    let y = 45;
    if (chartRef.current && genreData.length > 0) {
      try {
        const html2canvas = (await import('https://esm.sh/html2canvas@1.4.1')).default;
        const canvas = await html2canvas(chartRef.current, { backgroundColor: '#ffffff', scale: 2 });
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', 14, y, 180, 90); y += 100;
      } catch {}
    }
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('PLAYLIST', 14, y); y += 8;
    const renderHeader = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('HORA',14,y); doc.text('ARTISTA',32,y); doc.text('MUSICA',95,y); doc.text('GENERO',158,y); doc.text('BPM',185,y);
      doc.line(14,y+1,196,y+1); doc.setFont('helvetica','normal'); doc.setFontSize(7);
    };
    renderHeader(); y += 6;
    filteredData.forEach(t => {
      if(y>280){doc.addPage();y=20;renderHeader();y+=6;}
      doc.text(t.hora,14,y); doc.text(t.artista.substring(0,30),32,y); doc.text(t.musica.substring(0,38),95,y);
      doc.text((t.genero==='Desconhecido'?'':t.genero).substring(0,18),158,y); doc.text(t.bpm?String(t.bpm):'',185,y); y+=6;
    });
    doc.save(`IAnoRadio_${filters.radio}_${filters.date}_${hourLabel}.pdf`);
  };

  const hasActiveFilters = filters.search || filters.genero || filters.hour !== 'all' || filters.shift !== 'all' || filters.bpm !== 'all' || filters.ano;
  const activeStreamUrl = RADIO_STREAM_URLS[filters.radio];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(208,255,3,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(234,127,159,0.22),transparent_30%),linear-gradient(180deg,#f9f9ff_0%,#edf1ff_48%,#fff6f9_100%)]">
      {showUniqueModal && (
        <UniqueTracksModal tracks={uniqueTracks} onClose={() => setShowUniqueModal(false)} />
      )}

      {showRepeatedModal && (
        <RepeatedTracksModal tracks={repeatedTracks} onClose={() => setShowRepeatedModal(false)} />
      )}

      {execModal && (
        <TrackExecutionsModal
          artista={execModal.artista}
          musica={execModal.musica}
          capa={execModal.capa}
          execucoes={execModal.execucoes}
          onClose={() => setExecModal(null)}
        />
      )}

      <header className="bg-[#0D0056]/95 border-b border-white/10 sticky top-0 z-50 shadow-2xl shadow-[#0D0056]/25 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-24 flex items-center justify-between">
          {/* Logo + título clicáveis → volta para a home */}
          <a href="/" className="flex items-center gap-4 group" title="Voltar para a home">
            <div className="bg-[#D0FF03] p-3 rounded-2xl shadow-lg shadow-[#D0FF03]/25 group-hover:shadow-xl group-hover:scale-105 transition-all">
              <Radio size={32} className="text-[#0D0056]" />
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tight text-white uppercase leading-none group-hover:text-[#D0FF03] transition-colors">IA NO RÁDIO</h1>
              <p className="text-xs font-bold text-[#D0FF03] uppercase tracking-[0.25em] mt-1">Monitoramento Musical</p>
            </div>
          </a>
          <div className="flex items-center gap-3">
            <span
              title="Monitoramento Comercial em breve"
              className="px-4 py-2 bg-white/10 border border-white/15 rounded-xl font-black text-[#D0FF03] text-xs uppercase tracking-wider flex items-center gap-2 cursor-default select-none opacity-75"
              style={{ animation: 'none' }}
            >
              <Megaphone size={14} />
              Comercial
              <span className="ml-1 px-2 py-0.5 bg-[#D0FF03] text-[#0D0056] rounded-full text-[9px] font-black uppercase tracking-wider">Em Breve</span>
            </span>
            <button onClick={() => doFetch(filters.radio, filters.date)} className="p-4 bg-white/10 border border-white/15 rounded-2xl hover:bg-white/20 transition-all hover:scale-105 active:scale-95">
              <RefreshCw className={`text-[#D0FF03] ${refreshing ? 'animate-spin' : ''}`} size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="bg-[#5279FF]/10 border-b border-white/70 shadow-sm backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex gap-2 flex-wrap">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio', 'MIX Rio FM', 'Dumont FM'].map(r => (
              <button key={r} onClick={() => handleRadioChange(r)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-sm uppercase tracking-wide transition-all ${
                  filters.radio === r ? 'bg-[#D0FF03] text-[#0D0056] shadow-lg shadow-[#D0FF03]/20 scale-105' : 'bg-white text-neutral-600 border border-neutral-200 hover:border-[#EA7F9F] hover:bg-[#EA7F9F]/10 hover:text-[#EA7F9F]'
                }`}>
                <span className={`h-2 w-2 rounded-full ${filters.radio === r ? 'bg-[#0D0056]' : 'bg-[#EA7F9F]'}`} />
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="relative z-30 overflow-visible bg-white/90 backdrop-blur rounded-[2rem] shadow-xl shadow-neutral-300/60 p-5 mb-8 border border-white/80">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#EA7F9F]">Controles</p>
              <h2 className="font-black text-xl text-slate-900 uppercase tracking-tight">Filtros do monitoramento</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasActiveFilters && (
                <button onClick={() => setFilters(f => ({ ...f, search: '', genero: '', hour: 'all', shift: 'all', bpm: 'all', ano: '' }))}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-[#0D0056] hover:bg-[#20137f] rounded-2xl text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#5279FF]/15">
                  <X size={14} /> Limpar filtros
                </button>
              )}
              <button onClick={exportPDF}
                className="px-4 py-2 bg-[#D0FF03] hover:bg-[#dcff39] text-[#0D0056] rounded-2xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#D0FF03]/20 hover:shadow-xl active:scale-95">
                <Download size={15} />
                PDF
              </button>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#D0FF03]/30 bg-[#D0FF03]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#0D0056]">
                <span className="h-2 w-2 rounded-full bg-[#D0FF03] shadow-[0_0_0_4px_rgba(208,255,3,0.18)]" />
                Auto 30s
              </div>
            </div>
          </div>

          <div className="relative mb-4">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5279FF]" />
            <input type="text" placeholder="Buscar artista ou música..." value={filters.search}
              onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setVisibleCount(9); }}
              className="w-full pl-12 pr-4 py-3.5 bg-white rounded-2xl font-bold text-slate-800 border-2 border-[#D0FF03]/30 shadow-sm shadow-[#5279FF]/10 placeholder:text-slate-400 focus:border-[#D0FF03] focus:outline-none focus:ring-4 focus:ring-[#D0FF03]/20 transition-all text-sm" />
          </div>

          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2 mb-4">
              {filters.search && <span className="px-3 py-1.5 rounded-full bg-[#EA7F9F]/15 border border-[#EA7F9F]/30 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">Busca: {filters.search}</span>}
              {filters.genero && <span className="px-3 py-1.5 rounded-full bg-[#5279FF]/10 border border-[#5279FF]/25 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">Gênero: {filters.genero}</span>}
              {filters.hour !== 'all' && <span className="px-3 py-1.5 rounded-full bg-[#5279FF]/10 border border-[#5279FF]/25 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">Hora: {filters.hour}:00</span>}
              {filters.shift !== 'all' && <span className="px-3 py-1.5 rounded-full bg-[#D0FF03]/15 border border-[#D0FF03]/35 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">Locutor: {getShiftLabel(filters.shift)}</span>}
              {filters.bpm !== 'all' && <span className="px-3 py-1.5 rounded-full bg-[#EA7F9F]/15 border border-[#EA7F9F]/30 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">BPM: {filters.bpm === 'slow' ? 'Lento' : filters.bpm === 'moderate' ? 'Moderado' : 'Rápido'}</span>}
              {filters.ano && <span className="px-3 py-1.5 rounded-full bg-[#0D0056]/10 border border-[#0D0056]/20 text-[#0D0056] text-[10px] font-black uppercase tracking-wider">Ano: {filters.ano}</span>}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <DatePicker
              value={filters.date}
              availableDates={availableDates}
              loadingDates={loadingDates}
              datesLoaded={datesLoaded}
              onChange={d => { setFilters(f => ({ ...f, date: d })); setVisibleCount(9); }}
              onOpen={handleOpenDatePicker}
            />
            <div className="relative">
              <select value={filters.hour} onChange={e => { setFilters(f => ({ ...f, hour: e.target.value, shift: 'all' })); setVisibleCount(9); }}
                className="w-full appearance-none pl-4 pr-10 py-3 bg-slate-50 rounded-2xl font-bold text-slate-700 border-2 border-transparent hover:border-[#D0FF03] focus:border-[#D0FF03] focus:outline-none transition-all cursor-pointer text-sm">
                <option value="all">Todas as horas</option>
                {hourOptions.map(h => <option key={h} value={h}>{h}:00 – {h}:59</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            <div className="relative">
              <select value={filters.genero} onChange={e => { setFilters(f => ({ ...f, genero: e.target.value })); setVisibleCount(9); }}
                className="w-full appearance-none pl-4 pr-10 py-3 bg-slate-50 rounded-2xl font-bold text-slate-700 border-2 border-transparent hover:border-[#D0FF03] focus:border-[#D0FF03] focus:outline-none transition-all cursor-pointer text-sm">
                <option value="">Todos os gêneros</option>
                {uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            <div className="relative">
              <select value={filters.bpm} onChange={e => { setFilters(f => ({ ...f, bpm: e.target.value })); setVisibleCount(9); }}
                className="w-full appearance-none pl-4 pr-10 py-3 bg-slate-50 rounded-2xl font-bold text-slate-700 border-2 border-transparent hover:border-[#D0FF03] focus:border-[#D0FF03] focus:outline-none transition-all cursor-pointer text-sm">
                <option value="all">Todos os BPMs</option>
                <option value="slow">Lento (&lt; 100 BPM)</option>
                <option value="moderate">Moderado (100–120 BPM)</option>
                <option value="fast">Rápido (&gt; 120 BPM)</option>
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {/* ── SELETOR DE ANO DE LANÇAMENTO ── */}
            <YearPicker
              value={filters.ano}
              availableYears={availableYears}
              onChange={y => { setFilters(f => ({ ...f, ano: y })); setVisibleCount(9); }}
            />
          </div>

          <div className="mt-4 rounded-[1.5rem] border border-slate-100 bg-slate-50/80 p-3">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#5279FF]">Troca de locutor</p>
                <p className="text-xs font-bold uppercase text-slate-400">Filtros rápidos por faixa de programação</p>
              </div>
              {filters.shift !== 'all' && (
                <button onClick={() => { setFilters(f => ({ ...f, shift: 'all' })); setVisibleCount(9); }} className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-700">
                  Limpar período
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
              {SHIFT_FILTER_OPTIONS.map(option => {
                const active = filters.shift === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setFilters(f => ({ ...f, shift: option.value, hour: 'all' })); setVisibleCount(9); }}
                    className={`rounded-2xl px-3 py-2.5 text-xs font-black uppercase tracking-wider transition-all active:scale-95 ${
                      active
                        ? 'bg-[#0D0056] text-[#D0FF03] shadow-lg shadow-[#5279FF]/25 scale-[1.02]'
                        : 'bg-white text-[#0D0056] border border-[#5279FF]/20 hover:border-[#EA7F9F] hover:bg-[#EA7F9F]/10 hover:text-[#0D0056]'
                    }`}
                  >
                    {option.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 size={48} className="animate-spin text-[#5279FF]" />
            <p className="font-black text-slate-400 uppercase text-sm">Carregando playlist...</p>
          </div>
        ) : (
          <>
            {filteredData.length > 0 && (
              activeStreamUrl ? (
                <div className="mb-8 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <NowPlayingCard track={filteredData[0]} />
                  <RadioStreamPlayer radio={filters.radio} streamUrl={activeStreamUrl} />
                </div>
              ) : (
                <div className="mb-8">
                  <NowPlayingCard track={filteredData[0]} />
                </div>
              )
            )}

            {filteredData.length > 0 && (
              <MusicMetricsPanel
                metrics={musicMetrics}
                onOpenUnique={() => setShowUniqueModal(true)}
                onOpenRepeated={() => setShowRepeatedModal(true)}
              />
            )}

            {filteredData.length > 0 && <ProgrammingVarietyPanel metrics={programmingVarietyMetrics} />}

            <TopArtistsCard radio={filters.radio} />

            <TopTracksCard radio={filters.radio} />

            <GenreChart data={genreData} chartRef={chartRef} />

            {filteredData.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 rounded-[1.75rem] border border-white/80 bg-white/80 p-5 shadow-lg shadow-[#5279FF]/15 backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="bg-gradient-to-br from-[#D0FF03]/25 to-[#5279FF]/20 p-3 rounded-2xl"><Music size={20} className="text-[#0D0056]" /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#EA7F9F]">Playlist monitorada</p>
                    <p className="font-black text-slate-900 text-lg">{filteredData.length} execuções{filters.ano ? ` • ${filters.ano}` : ''}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase">{filters.radio} • {formatDateBR(filters.date)}</p>
                  </div>
                </div>
              </div>
            )}

            {filteredData.length === 0 ? (
              <div className="text-center py-32">
                <div className="text-6xl mb-4">🎵</div>
                <p className="font-black text-slate-300 uppercase text-xl">Nenhuma música encontrada</p>
                <p className="text-slate-400 font-bold mt-2 text-sm">Tente outros filtros ou selecione outra data</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3">
                  {filteredData.slice(0, visibleCount).map(track => {
                    const key = `${track.artista}|||${track.musica}`;
                    const execs = weeklyExecsMap[key] || [];
                    return (
                      <MusicCard
                        key={track.id}
                        track={track}
                        repeatCount={repeatCountMap[key]}
                        weeklyExecs={execs}
                        onCapaClick={() => setExecModal({
                          artista: track.artista,
                          musica: track.musica,
                          capa: track.capa || '',
                          execucoes: execs
                        })}
                      />
                    );
                  })}
                </div>
                {visibleCount < filteredData.length && (
                  <button onClick={() => setVisibleCount(v => v + 9)}
                    className="w-full mt-6 py-4 bg-white/90 border-2 border-[#5279FF]/25 hover:border-[#EA7F9F] text-[#0D0056] rounded-2xl font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all hover:shadow-lg">
                    <Plus size={18} /> Carregar mais ({filteredData.length - visibleCount} restantes)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
