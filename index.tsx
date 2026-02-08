import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Calendar, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download, PieChart as PieChartIcon
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const SHEET_ID = '1xFRBBHpmn38TiBdZcwN2556811FKkfbEEB3HmmdxT1s';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const REFRESH_INTERVAL_MS = 30000;

const GENRE_COLORS: Record<string, string> = {
  'Sertanejo': '#FF6B6B', 'Pop': '#4ECDC4', 'Rock': '#95E1D3', 'MPB': '#F38181',
  'Funk': '#AA96DA', 'Pagode': '#FCBAD3', 'Rap/Hip Hop': '#A8D8EA', 'Eletrônica': '#FFAAA6',
  'Gospel': '#FFD3B5', 'Samba': '#FFA5BA', 'Forró': '#FFB86F', 'Reggae': '#5FD068',
  'Jazz': '#8E7CC3', 'Desconhecido': '#D3D3D3'
};

const MusicCard = ({ track, isNowPlaying }: { track: any, isNowPlaying: boolean }) => {
  const [artwork, setArtwork] = useState<string | null>(null);
  useEffect(() => {
    const fetchCover = async () => {
      const query = `${track.artista} ${track.musica}`.toLowerCase().trim();
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
        const data = await res.json();
        setArtwork(data.results?.[0]?.artworkUrl100 || null);
      } catch (e) { setArtwork(null); }
    };
    fetchCover();
  }, [track.artista, track.musica]);

  return (
    <div className={`flex items-center gap-4 p-5 rounded-[2rem] transition-all duration-300 ${isNowPlaying ? "bg-slate-900 border-l-8 border-yellow-400 shadow-2xl scale-[1.02] mb-10" : "bg-white border border-slate-200"}`}>
      <div className={`relative flex-shrink-0 overflow-hidden rounded-2xl bg-slate-100 ${isNowPlaying ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-20 h-20'}`}>
        {artwork ? <img src={artwork.replace('100x100', '400x400')} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-300"><Music size={isNowPlaying ? 40 : 24} /></div>}
      </div>
      <div className="flex-grow min-w-0">
        {isNowPlaying && <div className="text-[10px] font-black text-white uppercase mb-2 flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span> No Ar Agora</div>}
        <h3 className={`font-black uppercase truncate text-lg ${isNowPlaying ? "text-white" : "text-slate-800"}`}>{track.musica}</h3>
        <p className={`font-bold uppercase truncate text-sm mb-2 ${isNowPlaying ? "text-yellow-400" : "text-sky-500"}`}>{track.artista}</p>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full font-bold text-[10px] ${isNowPlaying ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'}`}>{track.hora}</div>
          <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase text-white" style={{ backgroundColor: GENRE_COLORS[track.genero] || '#D3D3D3' }}>{track.genero}</span>
        </div>
      </div>
    </div>
  );
};

const GenreChart = ({ data }: { data: any[] }) => {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-gradient-to-br from-purple-400 to-pink-400 p-3 rounded-xl shadow-lg"><PieChartIcon className="text-white" size={24} /></div>
        <div>
          <h2 className="font-black text-xl tracking-tighter text-slate-900 uppercase">Gêneros Musicais</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Filtro de hora ativo</p>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer><PieChart><Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{data.map((entry, index) => <Cell key={`cell-${index}`} fill={GENRE_COLORS[entry.name] || '#D3D3D3'} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-8">
        {data.map((genre) => (
          <div key={genre.name} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: GENRE_COLORS[genre.name] || '#D3D3D3' }} />
            <div className="flex-1 min-w-0"><p className="font-black text-[10px] text-slate-700 uppercase truncate">{genre.name}</p><p className="text-[9px] text-slate-400 font-bold">{genre.value} músicas ({genre.percentage}%)</p></div>
          </div>
        ))}
      </div>
    </div>
  );
};

const App = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', hour: 'all' });
  const [visibleCount, setVisibleCount] = useState(10);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`${CSV_URL}&cb=${Date.now()}`);
      const text = await response.text();
      const rows = text.split('\n').filter(l => l.trim()).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      const header = rows[0].map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      
      const idx = {
        art: header.indexOf('artista'), mus: header.indexOf('musica'), 
        tim: header.indexOf('tocou_em'), rad: header.indexOf('radio'), gen: header.indexOf('genero')
      };

      const formatted = rows.slice(1).map((row, i) => {
        const timeStr = row[idx.tim] || '';
        const d = new Date(timeStr.replace(/-/g, '/'));
        const hPart = timeStr.split(' ')[1] || '00:00';
        return {
          id: i, artista: row[idx.art] || '?', musica: row[idx.mus] || '?', radio: row[idx.rad] || '?', genero: row[idx.gen] || 'Desconhecido',
          data: timeStr.split(' ')[0] || '---',
          hora: hPart.substring(0, 5),
          fullHour: hPart.split(':')[0] || '00',
          ts: isNaN(d.getTime()) ? 0 : d.getTime()
        };
      }).filter(t => t.artista !== '?');

      const sorted = formatted.sort((a, b) => b.ts - a.ts);
      setData(sorted);
      if (sorted.length > 0 && !filters.date) setFilters(f => ({ ...f, date: sorted[0].data }));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters.date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredAll = useMemo(() => data.filter(t => t.radio.trim() === filters.radio.trim() && t.data === filters.date), [data, filters.radio, filters.date]);

  const filteredByHour = useMemo(() => {
    return filteredAll.filter(t => (filters.hour === 'all' ? true : t.fullHour === filters.hour) && (filters.search ? (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true));
  }, [filteredAll, filters.hour, filters.search]);

  const genreStats = useMemo(() => {
    const counts: any = {};
    filteredByHour.forEach(t => { if(t.genero !== 'Desconhecido') counts[t.genero] = (counts[t.genero] || 0) + 1; });
    const total = filteredByHour.length;
    return Object.entries(counts).map(([name, value]: [string, any]) => ({ name, value, percentage: ((value / total) * 100).toFixed(1) })).sort((a, b) => b.value - a.value);
  }, [filteredByHour]);

  const nowPlaying = filteredAll[0];
  const history = filteredByHour.filter(t => t.id !== nowPlaying?.id).slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-20">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
          <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-2xl">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
              <button key={r} onClick={() => { setFilters({...filters, radio: r, hour: 'all'}); setVisibleCount(10); }} className={`flex-1 py-3 rounded-xl font-bold text-[10px] uppercase transition-all ${filters.radio === r ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>{r}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <select className="p-4 bg-slate-50 rounded-2xl font-bold text-xs outline-none appearance-none" value={filters.date} onChange={e => setFilters({...filters, date: e.target.value})}>
              {[...new Set(data.filter(t => t.radio === filters.radio).map(d => d.data))].sort().reverse().map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="p-4 bg-slate-50 rounded-2xl font-bold text-xs outline-none appearance-none" value={filters.hour} onChange={e => setFilters({...filters, hour: e.target.value})}>
              <option value="all">Todas as Horas</option>
              {Array.from({length: 24}, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 font-bold uppercase text-xs animate-pulse">Carregando AUDIA...</div>
        ) : (
          <>
            {nowPlaying && <MusicCard track={nowPlaying} isNowPlaying={true} />}
            <GenreChart data={genreStats} />
            <div className="space-y-4">
              <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest ml-4 mb-2">Histórico Recente</h4>
              {history.map(track => <MusicCard key={track.id} track={track} isNowPlaying={false} />)}
              {filteredByHour.length > visibleCount && (
                <button onClick={() => setVisibleCount(c => c + 15)} className="w-full py-6 rounded-[2rem] border-2 border-dashed border-slate-200 text-slate-400 font-bold uppercase text-[10px] hover:bg-white transition-all"><Plus size={16} className="mx-auto" /></button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) { createRoot(container).render(<App />); }
