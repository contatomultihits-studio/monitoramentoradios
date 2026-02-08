import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Calendar, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download, PieChart as PieChartIcon
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

// --- CONFIGURAÇÕES ---
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
    <div className={`flex items-center gap-4 p-5 rounded-[2rem] transition-all duration-300 ${isNowPlaying ? "bg-slate-900 border-l-8 border-yellow-400 shadow-2xl scale-[1.02] mb-10" : "bg-white border border-slate-200 hover:shadow-md"}`}>
      <div className={`relative flex-shrink-0 overflow-hidden rounded-2xl bg-slate-100 ${isNowPlaying ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-20 h-20'}`}>
        {artwork ? (
          <img src={artwork.replace('100x100', '400x400')} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300"><Music size={isNowPlaying ? 40 : 24} /></div>
        )}
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
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Soma baseada no filtro de hora</p>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
              {data.map((entry, index) => <Cell key={`cell-${index}`} fill={GENRE_COLORS[entry.name] || '#D3D3D3'} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-8">
        {data.map((genre) => (
          <div key={genre.name} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: GENRE_COLORS[genre.name] || '#D3D3D3' }} />
            <div className="flex-1 min-w-0">
              <p className="font-black text-[10px] text-slate-700 uppercase truncate">{genre.name}</p>
              <p className="text-[9px] text-slate-400 font-bold">{genre.value} músicas ({genre.percentage}%)</p>
            </div>
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
      const rows = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      const header = rows[0].map(h => h.toLowerCase().trim());
      
      const idx = {
        art: header.indexOf('artista'), mus: header.indexOf('musica'), 
        tim: header.indexOf('tocou_em'), rad: header.indexOf('radio'), gen: header.indexOf('genero')
      };

      const formatted = rows.slice(1).map((row, i) => {
        const timeStr = row[idx.tim] || '';
        // Normalização de data para evitar erros de fuso horário entre as rádios
        const d = new Date(timeStr.replace(/-/g, '/'));
        return {
          id: i, artista: row[idx.art], musica: row[idx.mus], radio: row[idx.rad], genero: row[idx.gen] || 'Desconhecido',
          data: timeStr.split(' ')[0],
          hora: timeStr.split(' ')[1]?.substring(0, 5) || '00:00',
          fullHour: timeStr.split(' ')[1]?.split(':')[0] || '00',
          ts: d.getTime()
        };
      }).filter(t => t.artista);

      const sorted = formatted.sort((a, b) => b.ts - a.ts);
      setData(sorted);
      if (sorted.length > 0 && !filters.date) setFilters(f => ({ ...f, date: sorted[0].data }));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters.date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    return data.filter(t => 
      t.radio === filters.radio && 
      t.data === filters.date &&
      (filters.hour === 'all' ? true : t.fullHour === filters.hour) &&
      (filters.search ? (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true)
    );
  }, [data, filters]);

  const genreStats = useMemo(() => {
    const counts: any = {};
    filtered.forEach(t => { if(t.genero !== 'Desconhecido') counts[t.genero] = (counts[t.genero] || 0) + 1; });
    const total = filtered.length;
    return Object.entries(counts).map(([name, value]: [string, any]) => ({ 
      name, 
      value, 
      percentage: ((value / total) * 100).toFixed(1) 
    })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text(`PLAYLIST - ${filters.radio}`, 14, 20);
    doc.setFontSize(10); doc.text(`Data: ${filters.date} | Hora: ${filters.hour === 'all' ? 'Dia Inteiro' : filters.hour + ':00'}`, 14, 28);
    let y = 40;
    filtered.forEach((t, i) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(`${t.hora} - ${t.artista} - ${t.musica} (${t.genero})`, 14, y);
      y += 7;
    });
    doc.save(`Relatorio_${filters.radio}_${filters.date}.pdf`);
  };

  const nowPlaying = filtered[0];
  const upcoming = filtered.slice(1, visibleCount);

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-20">
      <div className="max-w-3xl mx-auto">
        {/* CABEÇALHO / FILTROS */}
        <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
          <div className="flex items-center gap-3 mb-6">
             <div className="bg-yellow-400 p-2 rounded-xl text-white shadow-lg"><Radio /></div>
             <h1 className="font-black text-xl text-slate-900 uppercase">AUDIA MONITOR</h1>
          </div>
          
          <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-2xl">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
              <button key={r} onClick={() => setFilters({...filters, radio: r, hour: 'all'})} className={`flex-1 py-3 rounded-xl font-bold text-[10px] uppercase transition-all ${filters.radio === r ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>{r}</button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <select className="w-full pl-10 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-xs outline-none appearance-none" value={filters.date} onChange={e => setFilters({...filters, date: e.target.value})}>
                {[...new Set(data.filter(t => t.radio === filters.radio).map(d => d.data))].sort().reverse().map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="relative">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <select className="w-full pl-10 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-xs outline-none appearance-none" value={filters.hour} onChange={e => setFilters({...filters, hour: e.target.value})}>
                <option value="all">Dia Inteiro</option>
                {Array.from({length: 24}, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </div>

          <button onClick={exportPDF} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] flex items-center justify-center gap-3 active:scale-95 transition-all"><Download size={16} /> Exportar PDF da Seleção</button>
        </div>

        {loading ? (
          <div className="py-20 text-center animate-pulse text-slate-400 font-bold uppercase text-xs">Sincronizando Dados...</div>
        ) : (
          <>
            {/* 1. Música em destaque (No Ar) */}
            {nowPlaying && <MusicCard track={nowPlaying} isNowPlaying={true} />}

            {/* 2. Gráfico de Gêneros (Respeita o filtro de hora) */}
            <GenreChart data={genreStats} />

            {/* 3. Próximas 9 Músicas */}
            <div className="space-y-4">
              <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest ml-4 mb-2">Histórico Recente</h4>
              {upcoming.map(track => <MusicCard key={track.id} track={track} isNowPlaying={false} />)}
              
              {filtered.length > visibleCount && (
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
