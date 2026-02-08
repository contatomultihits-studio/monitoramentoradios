import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Calendar, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download, PieChart as PieChartIcon
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// --- CONFIGURAÇÕES ---
const SHEET_ID = '1xFRBBHpmn38TiBdZcwN2556811FKkfbEEB3HmmdxT1s';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const REFRESH_INTERVAL_MS = 30000;

// Cores para os gêneros
const GENRE_COLORS: Record<string, string> = {
  'Sertanejo': '#FF6B6B',
  'Pop': '#4ECDC4',
  'Rock': '#95E1D3',
  'MPB': '#F38181',
  'Funk': '#AA96DA',
  'Pagode': '#FCBAD3',
  'Rap/Hip Hop': '#A8D8EA',
  'Eletrônica': '#FFAAA6',
  'Gospel': '#FFD3B5',
  'Samba': '#FFA5BA',
  'Forró': '#FFB86F',
  'Reggae': '#5FD068',
  'Jazz': '#8E7CC3',
  'Folk': '#B8A9C9',
  'Brazil': '#FFD93D',
  'Outros': '#B8B8B8'
};

const MusicCard = ({ track, isNowPlaying }: { track: any, isNowPlaying: boolean }) => {
  const [artwork, setArtwork] = useState<string | null>(null);
  const [loadingCover, setLoadingCover] = useState(true);

  useEffect(() => {
    const fetchCover = async () => {
      const query = `${track.artista} ${track.musica}`.toLowerCase().trim();
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
        const data = await res.json();
        setArtwork(data.results?.[0]?.artworkUrl100 || null);
      } catch (e) { setArtwork(null); } finally { setLoadingCover(false); }
    };
    fetchCover();
  }, [track.artista, track.musica]);

  const cardStyle = isNowPlaying 
    ? "bg-slate-900 border-l-8 border-yellow-400 shadow-2xl scale-[1.02] z-10" 
    : "bg-white border border-slate-200 hover:shadow-lg hover:-translate-y-1";

  return (
    <div className={`flex items-center gap-4 p-5 rounded-[2rem] transition-all duration-300 ${cardStyle}`}>
      <div className={`relative flex-shrink-0 overflow-hidden rounded-2xl bg-slate-100 shadow-inner ${isNowPlaying ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-20 h-20'}`}>
        {loadingCover ? (
          <div className="w-full h-full animate-pulse bg-slate-200 flex items-center justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
        ) : artwork ? (
          <img src={artwork.replace('100x100', '400x400')} alt="Capa" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300"><Music size={isNowPlaying ? 40 : 24} /></div>
        )}
      </div>
      <div className="flex-grow min-w-0">
        {isNowPlaying && (
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-2 w-2 rounded-full bg-red-500 animate-ping"></span>
            <span className="text-[10px] font-black text-white uppercase tracking-tighter">No Ar Agora</span>
          </div>
        )}
        <h3 className={`font-black uppercase truncate leading-tight text-lg ${isNowPlaying ? "text-white" : "text-slate-800"}`}>{track.musica}</h3>
        <p className={`font-bold uppercase truncate text-sm mb-2 ${isNowPlaying ? "text-yellow-400" : "text-sky-500"}`}>{track.artista}</p>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold tabular-nums text-[10px] ${isNowPlaying ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'}`}><Clock size={12} /> {track.hora}</div>
          {track.genero && track.genero !== 'Desconhecido' && (
            <span 
              className={`px-2 py-1 rounded-full text-[9px] font-black uppercase`}
              style={{ 
                backgroundColor: GENRE_COLORS[track.genero] || '#B8B8B8',
                color: 'white'
              }}
            >
              {track.genero}
            </span>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isNowPlaying ? 'text-white/40' : 'text-slate-400'}`}>{track.data}</span>
        </div>
      </div>
    </div>
  );
};

const GenreChart = ({ data }: { data: any[] }) => {
  if (!data || data.length === 0) return null;

  // Remove "Desconhecido" e agrupa gêneros pequenos (menos de 3%) em "Outros"
  const MIN_PERCENTAGE = 3;
  const knownGenres = data.filter(g => g.name !== 'Desconhecido');
  
  if (knownGenres.length === 0) return null;
  
  const mainGenres = knownGenres.filter(g => parseFloat(g.percentage) >= MIN_PERCENTAGE);
  const smallGenres = knownGenres.filter(g => parseFloat(g.percentage) < MIN_PERCENTAGE);
  
  let chartData = [...mainGenres];
  
  // Agrupa gêneros pequenos em "Outros"
  if (smallGenres.length > 0) {
    const othersValue = smallGenres.reduce((sum, g) => sum + g.value, 0);
    const totalKnown = knownGenres.reduce((sum, g) => sum + g.value, 0);
    chartData.push({
      name: 'Outros',
      value: othersValue,
      percentage: ((othersValue / totalKnown) * 100).toFixed(1)
    });
  }
  
  // Ordena por valor
  chartData = chartData.sort((a, b) => b.value - a.value);

  return (
    <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-gradient-to-br from-purple-400 to-pink-400 p-3 rounded-xl shadow-lg">
          <PieChartIcon className="text-white" size={24} />
        </div>
        <div>
          <h2 className="font-black text-xl tracking-tighter text-slate-900 uppercase">Gêneros Musicais</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Distribuição por estilo</p>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            outerRadius={90}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={GENRE_COLORS[entry.name] || '#B8B8B8'} />
            ))}
          </Pie>
          <Tooltip formatter={(value: any) => `${value} músicas`} />
        </PieChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {chartData.map((genre) => (
          <div key={genre.name} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl">
            <div 
              className="w-4 h-4 rounded-full flex-shrink-0" 
              style={{ backgroundColor: GENRE_COLORS[genre.name] || '#B8B8B8' }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-black text-xs text-slate-700 uppercase truncate">{genre.name}</p>
              <p className="text-[10px] text-slate-400 font-bold">{genre.value} ({genre.percentage}%)</p>
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '' });
  const [visibleCount, setVisibleCount] = useState(15);
  const [exportHour, setExportHour] = useState('all');

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    try {
      const response = await fetch(`${CSV_URL}&cache_bust=${Date.now()}`);
      const csvText = await response.text();
      const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
      const rows = lines.map(line => {
        const result = []; let cur = ''; let inQuotes = false;
        for (let char of line) { if (char === '"') inQuotes = !inQuotes; else if (char === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; } else cur += char; }
        result.push(cur.trim()); return result;
      });

      const header = rows[0].map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      const idxArt = header.indexOf('artista');
      const idxMus = header.indexOf('musica');
      const idxTim = header.indexOf('tocou_em');
      const idxRad = header.indexOf('radio');
      const idxGen = header.indexOf('genero');

      const formatted = rows.slice(1).map((row, i) => {
        const rawTime = row[idxTim] || '';
        const normalizedTime = rawTime.replace(/-/g, '/');
        let dObj = new Date(normalizedTime);
        if (isNaN(dObj.getTime())) dObj = new Date(rawTime);
        
        if (row[idxRad] === 'Antena 1' && rawTime.includes('T')) dObj.setHours(dObj.getHours() - 3);

        let datePart = '', timePart = '00:00', ts = 0;
        if (!isNaN(dObj.getTime())) {
          datePart = dObj.toISOString().split('T')[0];
          timePart = dObj.toTimeString().substring(0, 5);
          ts = dObj.getTime();
        } else {
          const parts = rawTime.split(' ');
          datePart = parts[0] || "---";
          timePart = parts[1]?.substring(0, 5) || "00:00";
          ts = 0;
        }

        return {
          id: `t-${i}`,
          artista: row[idxArt] || 'Desconhecido',
          musica: row[idxMus] || 'Sem Título',
          radio: row[idxRad] || 'Metropolitana FM',
          genero: row[idxGen] || 'Desconhecido',
          data: datePart,
          hora: timePart,
          timestamp: ts
        };
      }).filter(t => t.artista !== 'artista');

      const sorted = formatted.sort((a, b) => b.timestamp - a.timestamp);
      setData(sorted);
      if (sorted.length > 0 && !filters.date) setFilters(prev => ({ ...prev, date: sorted[0].data }));
    } catch (err: any) { if (!isSilent) setError(err.message); } finally { setLoading(false); setRefreshing(false); }
  }, [filters.date]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredData = useMemo(() => {
    return data.filter(t => {
      const matchRadio = t.radio.trim() === filters.radio.trim();
      const matchDate = filters.date ? t.data === filters.date : true;
      const matchSearch = filters.search ? (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true;
      const matchGenero = filters.genero ? t.genero === filters.genero : true;
      return matchRadio && matchDate && matchSearch && matchGenero;
    });
  }, [data, filters]);

  const genreData = useMemo(() => {
    const filtered = data.filter(t => {
      const matchRadio = t.radio.trim() === filters.radio.trim();
      const matchDate = filters.date ? t.data === filters.date : true;
      return matchRadio && matchDate;
    });
    
    const genreCounts: Record<string, number> = {};
    filtered.forEach(t => {
      const genre = t.genero || 'Desconhecido';
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });

    const total = filtered.length;
    return Object.entries(genreCounts)
      .map(([name, value]) => ({
        name,
        value,
        percentage: ((value / total) * 100).toFixed(1)
      }))
      .sort((a, b) => b.value - a.value);
  }, [data, filters.radio, filters.date]);

  const uniqueDates = useMemo(() => {
    const dates = data.filter(t => t.radio === filters.radio).map(d => d.data);
    return [...new Set(dates)].sort().reverse();
  }, [data, filters.radio]);

  const uniqueGenres = useMemo(() => {
    const genres = data.filter(t => t.radio === filters.radio && (filters.date ? t.data === filters.date : true)).map(d => d.genero);
    return [...new Set(genres)].sort();
  }, [data, filters.radio, filters.date]);

  const hourOptions = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  }, []);

  const exportPDF = () => {
    const exportBaseRows = data.filter(t => {
      const matchRadio = t.radio.trim() === filters.radio.trim();
      const matchDate = filters.date ? t.data === filters.date : true;
      return matchRadio && matchDate;
    });
    const exportRows = exportBaseRows.filter(t => {
      if (exportHour === 'all') return true;
      return t.hora.startsWith(`${exportHour}:`);
    });

    if (exportRows.length === 0) {
      alert('Nenhum registro encontrado para o horário selecionado.');
      return;
    }

    const doc = new jsPDF();
    
    // Título
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`IA NO RADIO - ${filters.radio}`, 14, 15);
    
    // Subtítulo
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const hourLabel = exportHour === 'all' ? 'Todas as horas' : `${exportHour}:00`;
    doc.text(`Data: ${filters.date} | Horario: ${hourLabel}`, 14, 22);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 27);
    
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PLAYLIST", 14, 35);

    let y = 43;
    
    const renderHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("HORA", 14, y);
      doc.text("ARTISTA", 32, y);
      doc.text("MUSICA", 95, y);
      doc.text("GENERO", 158, y);
      doc.line(14, y + 1, 196, y + 1);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
    };

    renderHeader();
    
    exportRows.forEach(t => {
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
        renderHeader();
        y += 6;
      }
      
      const generoText = t.genero === 'Desconhecido' ? '' : t.genero;
      
      doc.text(t.hora, 14, y);
      doc.text(t.artista.substring(0, 30), 32, y);
      doc.text(t.musica.substring(0, 38), 95, y);
      doc.text(generoText.substring(0, 18), 158, y);
    });
    
    doc.save(`IAnoRadio_${filters.radio}_${filters.date}_${exportHour === 'all' ? 'completo' : exportHour + '_00'}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-400 p-2 rounded-xl text-white shadow-lg"><Radio size={24} /></div>
            <div>
              <h1 className="font-black text-xl tracking-tighter text-slate-900 leading-none uppercase">RÁDIO AI</h1>
              <p className="text-[10px] font-bold text-sky-500 uppercase tracking-[0.2em] mt-1">{filters.radio}</p>
            </div>
          </div>
          <button onClick={() => fetchData()} className="p-3 bg-slate-50 rounded-xl hover:bg-slate-100"><RefreshCw className={refreshing ? 'animate-spin text-sky-500' : 'text-slate-400'} size={20} /></button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
          <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-2xl">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
              <button key={r} onClick={() => { setFilters(f => ({ ...f, radio: r, date: '', genero: '' })); setVisibleCount(15); }} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${filters.radio === r ? 'bg-white shadow-md text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>{r}</button>
            ))}
          </div>
          <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} /><input type="text" placeholder="Pesquisar..." className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-700" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} /></div>
          <div className="relative mb-4"><Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-sky-500" size={18} /><select className="w-full pl-12 pr-10 py-4 bg-slate-50 rounded-2xl font-bold text-slate-600 appearance-none outline-none" value={filters.date} onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}>{uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
          <div className="relative mb-4"><Music className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500" size={18} /><select className="w-full pl-12 pr-10 py-4 bg-slate-50 rounded-2xl font-bold text-slate-600 appearance-none outline-none" value={filters.genero} onChange={e => setFilters(f => ({ ...f, genero: e.target.value }))}><option value="">Todos os gêneros</option>{uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
          <div className="relative"><Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-sky-500" size={18} /><select className="w-full pl-12 pr-10 py-4 bg-slate-50 rounded-2xl font-bold text-slate-600 appearance-none outline-none" value={exportHour} onChange={e => setExportHour(e.target.value)}><option value="all">Todas as horas</option>{hourOptions.map(h => <option key={h} value={h}>{h}:00</option>)}</select></div>
          <button onClick={exportPDF} className="w-full mt-4 py-4 bg-yellow-400 hover:bg-yellow-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 transition-all shadow-lg active:scale-95"><Download size={18} /> Exportar Playlist PDF</button>
        </div>

        {genreData.length > 0 && <GenreChart data={genreData} />}

        <div className="space-y-4">
          {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-sky-400 mb-4" size={40} /><p className="font-bold text-slate-400 text-[10px] uppercase">Sincronizando...</p></div> : 
          filteredData.length > 0 ? (
            <>{filteredData.slice(0, visibleCount).map((track, idx) => <MusicCard key={track.id} track={track} isNowPlaying={idx === 0 && !filters.search} />)}{filteredData.length > visibleCount && <button onClick={() => setVisibleCount(c => c + 15)} className="w-full py-6 rounded-[2rem] border-2 border-dashed border-slate-200 text-slate-400 font-bold hover:bg-white transition-all uppercase text-[10px] tracking-widest"><Plus size={16} /> Carregar Mais</button>}</>
          ) : <div className="bg-white p-20 rounded-[3rem] text-center border-4 border-dashed border-slate-100"><p className="font-black text-slate-300 uppercase text-xs tracking-widest">Nenhum registro para {filters.radio}</p></div>}
        </div>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
