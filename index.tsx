import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download,
  TrendingUp, Sparkles, Filter, Megaphone, Activity,
  Trophy, ChevronRight, ChevronLeft, Youtube
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const REFRESH_INTERVAL_MS = 30000;
const LASTFM_API_KEY = '2a416b64ded1827a7e82e61d9a87b2e0';
const getSupabaseClient = () => (window as any)._supabaseClient;

// ─────────────────────────────────────────────────────────────
// BLOQUEIO — breaks/vinhetas que não devem aparecer na dash
// ─────────────────────────────────────────────────────────────
const BLOCKED_TRACKS: { artista?: string; musica?: string }[] = [
  { artista: 'SP' },
];

const isBlocked = (artista: string, musica: string): boolean =>
  BLOCKED_TRACKS.some(b => {
    const matchArtista = !b.artista || b.artista === '*' || b.artista.trim().toLowerCase() === artista.trim().toLowerCase();
    const matchMusica  = !b.musica  || b.musica  === '*' || b.musica.trim().toLowerCase()  === musica.trim().toLowerCase();
    return matchArtista && matchMusica;
  });

const GENRE_COLORS: Record<string, string> = {
  'Sertanejo': '#3B82F6', 'Pop': '#0EA5E9', 'Rock': '#1E40AF',
  'MPB': '#60A5FA', 'Funk': '#2563EB', 'Pagode': '#0284C7',
  'Rap/Hip Hop': '#1D4ED8', 'Eletrônica': '#06B6D4', 'Gospel': '#7DD3FC',
  'Samba': '#1E3A8A', 'Forró': '#93C5FD', 'Reggae': '#34D399',
  'Jazz': '#1e293b', 'Desconhecido': '#D3D3D3', 'Outros': '#B8B8B8'
};

const ytURL = (artista: string, musica: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`"${artista}" "${musica}"`)}` ;

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
        <p className="font-bold text-blue-600 text-xs">{d.value} músicas ({d.percentage}%)</p>
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
// NOW PLAYING CARD
// ─────────────────────────────────────────────────────────────
const NowPlayingCard = ({ track }: { track: any }) => (
  <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 p-8 rounded-3xl shadow-2xl mb-8">
    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent animate-pulse" />
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-300" />
        </span>
        <span className="text-white/90 font-black text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles size={16} /> Tocando Agora
        </span>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex-shrink-0">
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/20">
            {track.capa
              ? <img src={track.capa} alt="Capa" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center bg-white/10"><Music size={48} className="text-white/40" /></div>
            }
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-3xl sm:text-4xl text-white mb-2 leading-tight drop-shadow-lg">{track.musica}</h2>
          <p className="font-bold text-xl sm:text-2xl text-sky-200 mb-4 drop-shadow-md">{track.artista}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full">
              <Clock size={16} className="text-white/80" />
              <span className="font-bold text-white text-sm">{track.hora}</span>
            </div>
            {track.genero && track.genero !== 'Desconhecido' && (
              <span className="px-4 py-2 rounded-full text-sm font-black uppercase text-white shadow-lg"
                style={{ backgroundColor: GENRE_COLORS[track.genero] || '#3B82F6' }}>{track.genero}</span>
            )}
            {track.bpm && (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500 rounded-full shadow-lg">
                <Activity size={16} className="text-white" />
                <span className="font-black text-white text-sm">{track.bpm} BPM</span>
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
const MusicCard = ({ track, repeatCount }: { track: any; repeatCount?: number }) => (
  <div className={`bg-white border rounded-2xl p-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${
    repeatCount && repeatCount >= 3 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
  }`}>
    <div className="flex items-center gap-4">
      <div className="flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-slate-100 shadow-md">
        {track.capa
          ? <img src={track.capa} alt="Capa" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-slate-300"><Music size={20} /></div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-black text-slate-800 text-base truncate leading-tight mb-1">{track.musica}</h3>
        <p className="font-bold text-blue-600 text-sm truncate mb-2">{track.artista}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-full">
            <Clock size={10} className="text-slate-500" />
            <span className="font-bold text-[10px] text-slate-600">{track.hora}</span>
          </div>
          {track.genero && track.genero !== 'Desconhecido' && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase text-white"
              style={{ backgroundColor: GENRE_COLORS[track.genero] || '#3B82F6' }}>{track.genero}</span>
          )}
          {track.bpm && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 rounded-full">
              <Activity size={10} className="text-white" />
              <span className="font-black text-[10px] text-white">{track.bpm} BPM</span>
            </div>
          )}
          {repeatCount && repeatCount >= 3 && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-400 rounded-full">
              <span className="font-black text-[10px] text-white">🔁 {repeatCount}x tocada</span>
            </div>
          )}
        </div>
      </div>
      <YTButton artista={track.artista} musica={track.musica} size="md" />
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// TOP 5 ARTISTAS
// ─────────────────────────────────────────────────────────────
const TopArtistsCard = ({ filteredData }: { filteredData: any[] }) => {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const topArtists = useMemo(() => {
    const counts: Record<string, { count: number; genero: string; capa: string; musica: string }> = {};
    filteredData.forEach(t => {
      if (!counts[t.artista]) counts[t.artista] = { count: 0, genero: t.genero, capa: t.capa || '', musica: t.musica };
      counts[t.artista].count++;
      if (!counts[t.artista].capa && t.capa) counts[t.artista].capa = t.capa;
    });
    return Object.entries(counts).map(([artista, info]) => ({ artista, ...info })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredData]);

  useEffect(() => {
    if (!topArtists.length) return;
    setLoading(true);
    Promise.all(topArtists.map(async a => ({ artista: a.artista, photo: await fetchArtistPhoto(a.artista) })))
      .then(results => {
        const map: Record<string, string> = {};
        results.forEach(r => { map[r.artista] = r.photo; });
        setPhotos(map);
        setLoading(false);
      });
  }, [topArtists]);

  if (!topArtists.length) return null;

  return (
    <div className="bg-gradient-to-br from-yellow-50 to-amber-50 p-8 rounded-3xl shadow-xl mb-8 border border-amber-100">
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-gradient-to-br from-amber-400 to-yellow-500 p-4 rounded-2xl shadow-lg"><Trophy className="text-white" size={28} /></div>
        <div>
          <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">Top 5 Artistas</h2>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Mais tocados no período filtrado</p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {topArtists.map((artist, idx) => {
          const photo = photos[artist.artista] || artist.capa || '';
          return (
            <div key={artist.artista} className="flex flex-col items-center text-center group">
              <div className="relative mb-3">
                <div className={`absolute -top-2 -left-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-md ${
                  idx === 0 ? 'bg-yellow-400 text-yellow-900' : idx === 1 ? 'bg-slate-300 text-slate-700' : idx === 2 ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-600'
                }`}>{idx < 3 ? ['1°','2°','3°'][idx] : `${idx+1}°`}</div>
                <a href={ytURL(artist.artista, artist.musica)} target="_blank" rel="noopener noreferrer"
                  className={`relative block w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden shadow-lg ring-4 transition-all group-hover:scale-105 ${
                    idx === 0 ? 'ring-yellow-400' : idx === 1 ? 'ring-slate-300' : idx === 2 ? 'ring-amber-500' : 'ring-slate-200'
                  }`} title={`Ver ${artist.artista} no YouTube`}>
                  {photo
                    ? <img src={photo} alt={artist.artista} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                    : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-indigo-200"><Music size={24} className="text-blue-400" /></div>
                  }
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                    <Youtube size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </a>
                {loading && !photo && (
                  <div className="absolute inset-0 rounded-2xl bg-white/60 flex items-center justify-center">
                    <Loader2 size={16} className="animate-spin text-blue-500" />
                  </div>
                )}
              </div>
              <p className="font-black text-slate-800 text-xs leading-tight truncate w-full">{artist.artista}</p>
              <p className="font-bold text-blue-600 text-[10px] mt-1">{artist.count} execuções</p>
              {artist.genero && artist.genero !== 'Desconhecido' && (
                <span className="mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase text-white"
                  style={{ backgroundColor: GENRE_COLORS[artist.genero] || '#3B82F6' }}>{artist.genero}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
    const othersValue = smallGenres.reduce((sum, g) => sum + g.value, 0);
    const totalKnown = knownGenres.reduce((sum, g) => sum + g.value, 0);
    chartData.push({ name: 'Outros', value: othersValue, percentage: ((othersValue / totalKnown) * 100).toFixed(1), subGenres: smallGenres.map(g => g.name) });
  }
  chartData = chartData.sort((a, b) => b.value - a.value);
  return (
    <div ref={chartRef} className="bg-gradient-to-br from-blue-50 to-indigo-50 p-8 rounded-3xl shadow-xl mb-8 border border-blue-100">
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-2xl shadow-lg"><TrendingUp className="text-white" size={28} /></div>
        <div>
          <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">Análise de Gêneros</h2>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Distribuição Musical (Sem Desconhecidos)</p>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-inner">
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie data={chartData} cx="50%" cy="50%" labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={120} innerRadius={60} fill="#3B82F6" dataKey="value" paddingAngle={2}>
              {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={GENRE_COLORS[entry.name] || '#B8B8B8'} stroke="#fff" strokeWidth={2} />))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {chartData.map(genre => (
          <div key={genre.name} className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
            <div className="w-5 h-5 rounded-full shadow-md flex-shrink-0" style={{ backgroundColor: GENRE_COLORS[genre.name] || '#B8B8B8' }} />
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
// APP
// ─────────────────────────────────────────────────────────────
const App = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '', hour: 'all', bpm: 'all' });
  const [visibleCount, setVisibleCount] = useState(9);
  const chartRef = React.useRef<HTMLDivElement>(null);
  const fetchDataRef = useRef<(isSilent?: boolean) => Promise<void>>();

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client não disponível');
      const { data: tracks, error } = await supabase.from('radio_airplay').select('*').order('tocou_em', { ascending: false }).limit(1000);
      if (error) throw error;
      const formatted = tracks
        .map((t: any) => {
          const utcDate = new Date(t.tocou_em);
          const str = utcDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
          const [datePart, timePart] = str.split(', ');
          const [day, month, year] = datePart.split('/');
          return { id: t.id, artista: t.artista || 'Desconhecido', musica: t.musica || 'Sem Título', radio: t.radio || 'Metropolitana FM', genero: t.genero || 'Desconhecido', data: `${year}-${month}-${day}`, hora: timePart, timestamp: utcDate.getTime(), capa: t.capa, bpm: t.bpm };
        })
        .filter((t: any) => !isBlocked(t.artista, t.musica));
      setData(formatted);
      setFilters(prev => (!prev.date && formatted.length > 0) ? { ...prev, date: formatted[0].data } : prev);
    } catch (err: any) {
      console.error('Erro:', err);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);
  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(() => { fetchDataRef.current?.(true); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const filteredData = useMemo(() => data.filter(t => {
    const matchRadio = t.radio.trim() === filters.radio.trim();
    const matchDate = filters.date ? t.data === filters.date : true;
    const matchSearch = filters.search ? (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true;
    const matchGenero = filters.genero ? t.genero === filters.genero : true;
    const matchHour = filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true;
    let matchBpm = true;
    if (filters.bpm !== 'all' && t.bpm) {
      if (filters.bpm === 'slow') matchBpm = t.bpm < 100;
      else if (filters.bpm === 'moderate') matchBpm = t.bpm >= 100 && t.bpm <= 120;
      else if (filters.bpm === 'fast') matchBpm = t.bpm > 120;
    }
    return matchRadio && matchDate && matchSearch && matchGenero && matchHour && matchBpm;
  }), [data, filters]);

  const repeatCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    filteredData.forEach(t => { const k = `${t.artista}|||${t.musica}`; map[k] = (map[k] || 0) + 1; });
    return map;
  }, [filteredData]);

  const genreData = useMemo(() => {
    const filtered = data.filter(t => t.radio.trim() === filters.radio.trim() && (filters.date ? t.data === filters.date : true) && (filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true));
    const counts: Record<string, number> = {};
    filtered.forEach(t => { const g = t.genero || 'Desconhecido'; counts[g] = (counts[g] || 0) + 1; });
    const total = filtered.length;
    return Object.entries(counts).map(([name, value]) => ({ name, value, percentage: ((value / total) * 100).toFixed(1) })).sort((a, b) => b.value - a.value);
  }, [data, filters.radio, filters.date, filters.hour]);

  const uniqueDates = useMemo(() => [...new Set(data.filter(t => t.radio === filters.radio).map(d => d.data))].sort().reverse(), [data, filters.radio]);
  const uniqueGenres = useMemo(() => [...new Set(data.filter(t => t.radio === filters.radio && (filters.date ? t.data === filters.date : true)).map(d => d.genero).filter(g => g && g !== 'Desconhecido'))].sort(), [data, filters.radio, filters.date]);
  const hourOptions = useMemo(() => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')), []);

  const exportPDF = async () => {
    if (!filteredData.length) { alert('Nenhum registro.'); return; }
    const doc = new jsPDF();
    doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text(`IA NO RADIO - ${filters.radio}`, 14, 20);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    const hourLabel = filters.hour === 'all' ? 'Todas as horas' : `${filters.hour}:00`;
    doc.text(`Data: ${filters.date} | Horario: ${hourLabel}`, 14, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 34);
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
      doc.text('HORA', 14, y); doc.text('ARTISTA', 32, y); doc.text('MUSICA', 95, y); doc.text('GENERO', 158, y); doc.text('BPM', 185, y);
      doc.line(14, y + 1, 196, y + 1); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    };
    renderHeader(); y += 6;
    filteredData.forEach(t => {
      if (y > 280) { doc.addPage(); y = 20; renderHeader(); y += 6; }
      doc.text(t.hora, 14, y); doc.text(t.artista.substring(0, 30), 32, y); doc.text(t.musica.substring(0, 38), 95, y);
      doc.text((t.genero === 'Desconhecido' ? '' : t.genero).substring(0, 18), 158, y); doc.text(t.bpm ? String(t.bpm) : '', 185, y); y += 6;
    });
    doc.save(`IAnoRadio_${filters.radio}_${filters.date}_${hourLabel}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-blue-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-3 rounded-2xl shadow-lg"><Radio size={32} className="text-white" /></div>
            <div>
              <h1 className="font-black text-2xl tracking-tight text-slate-900 uppercase leading-none">IA NO RÁDIO</h1>
              <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mt-1">Monitoramento Musical</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/comercial" className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 rounded-xl font-bold text-emerald-700 text-xs uppercase tracking-wider transition-all flex items-center gap-2">
              <Megaphone size={14} /> Ver Comercial
            </a>
            <button onClick={() => fetchData()} className="p-4 bg-blue-50 rounded-2xl hover:bg-blue-100 transition-all hover:scale-105 active:scale-95">
              <RefreshCw className={refreshing ? 'animate-spin text-blue-600' : 'text-blue-600'} size={24} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="bg-white p-8 rounded-3xl shadow-xl mb-8 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <Filter className="text-blue-600" size={24} />
            <h3 className="font-black text-xl text-slate-900 uppercase tracking-tight">Filtros</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
              <button key={r} onClick={() => { setFilters(f => ({ ...f, radio: r, date: '', genero: '', hour: 'all', bpm: 'all' })); setVisibleCount(9); }}
                className={`py-5 rounded-2xl font-black text-sm uppercase transition-all transform hover:scale-105 active:scale-95 ${
                  filters.radio === r ? 'bg-blue-600 text-white shadow-xl' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>{r}</button>
            ))}
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input type="text" placeholder="Buscar artista ou música..."
              className="w-full pl-14 pr-5 py-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-700 border-2 border-transparent focus:border-blue-300 transition-all"
              value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-300" value={filters.date} onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}>
              {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-300" value={filters.hour} onChange={e => setFilters(f => ({ ...f, hour: e.target.value }))}>
              <option value="all">Todas as horas</option>
              {hourOptions.map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-300" value={filters.genero} onChange={e => setFilters(f => ({ ...f, genero: e.target.value }))}>
              <option value="">Todos os gêneros</option>
              {uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-blue-300" value={filters.bpm} onChange={e => setFilters(f => ({ ...f, bpm: e.target.value }))}>
              <option value="all">Todos os BPMs</option>
              <option value="slow">🐢 Lento (&lt;100)</option>
              <option value="moderate">🚶 Moderado (100-120)</option>
              <option value="fast">🏃 Rápido (&gt;120)</option>
            </select>
          </div>
          <button onClick={exportPDF}
            className="w-full mt-2 py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 active:scale-95">
            <Download size={20} /> Exportar Relatório PDF
          </button>
        </div>

        {filteredData.length > 0 && !filters.search && <NowPlayingCard track={filteredData[0]} />}
        {!loading && <TopArtistsCard filteredData={filteredData} />}
        <GenreChart data={genreData} chartRef={chartRef} />

        <div className="space-y-3">
          {loading ? (
            <div className="py-32 text-center">
              <Loader2 className="animate-spin mx-auto text-blue-600 mb-6" size={48} />
              <p className="font-bold text-slate-500 text-sm uppercase tracking-wider">Carregando dados...</p>
            </div>
          ) : filteredData.length > 0 ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Music className="text-blue-600" size={24} />
                <h3 className="font-black text-xl text-slate-900 uppercase">Últimas Execuções ({filteredData.length} músicas)</h3>
              </div>
              {filteredData.slice(filters.search ? 0 : 1, visibleCount + 1).map(track => {
                const rc = repeatCountMap[`${track.artista}|||${track.musica}`];
                return <MusicCard key={track.id} track={track} repeatCount={rc} />;
              })}
              {filteredData.length > visibleCount + 1 && (
                <button onClick={() => setVisibleCount(c => c + 9)}
                  className="w-full py-6 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:scale-105 active:scale-95">
                  <Plus size={20} /> Carregar Mais Músicas
                </button>
              )}
            </>
          ) : (
            <div className="bg-white p-24 rounded-3xl text-center border-4 border-dashed border-slate-200">
              <Music className="mx-auto text-slate-300 mb-4" size={64} />
              <p className="font-black text-slate-400 uppercase text-lg tracking-wider">Nenhum registro encontrado</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

(async () => {
  const maxAttempts = 10;
  let attempts = 0;
  while (attempts < maxAttempts) {
    if ((window as any)._supabaseReady && (window as any)._supabaseClient) {
      createRoot(document.getElementById('root')!).render(<App />);
      return;
    }
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }
  document.getElementById('root')!.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#EF4444"><div style="text-align:center;color:white;padding:2rem"><h1 style="font-size:2rem;font-weight:900;margin-bottom:1rem">❌ Erro</h1><button onclick="location.reload()" style="background:white;color:#DC2626;padding:1rem 2rem;border:none;border-radius:.5rem;font-weight:bold;cursor:pointer">Tentar Novamente</button></div></div>`;
})();
