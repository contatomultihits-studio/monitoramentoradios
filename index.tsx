import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Calendar, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download, PieChart as PieChartIcon,
  TrendingUp, Sparkles, Filter
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

// --- CONFIGURAÇÕES ---
const SHEET_ID = '1xFRBBHpmn38TiBdZcwN2556811FKkfbEEB3HmmdxT1s';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const REFRESH_INTERVAL_MS = 30000;

// Cores vibrantes para os gêneros
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
  'Desconhecido': '#D3D3D3',
  'Outros': '#B8B8B8'
};

// Card da música tocando AGORA - Destaque especial
const NowPlayingCard = ({ track }: { track: any }) => {
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

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-pink-600 to-red-600 p-8 rounded-3xl shadow-2xl mb-8">
      <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent animate-pulse"></div>
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
          <span className="text-white/90 font-black text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles size={16} /> Tocando Agora
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/20">
              {loadingCover ? (
                <div className="w-full h-full animate-pulse bg-white/10 flex items-center justify-center">
                  <Loader2 className="animate-spin text-white/40" size={32} />
                </div>
              ) : artwork ? (
                <img src={artwork.replace('100x100', '600x600')} alt="Capa" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/10">
                  <Music size={48} className="text-white/40" />
                </div>
              )}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-white/10 rounded-2xl"></div>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="font-black text-3xl sm:text-4xl text-white mb-2 leading-tight drop-shadow-lg">
              {track.musica}
            </h2>
            <p className="font-bold text-xl sm:text-2xl text-yellow-300 mb-4 drop-shadow-md">
              {track.artista}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full">
                <Clock size={16} className="text-white/80" />
                <span className="font-bold text-white text-sm">{track.hora}</span>
              </div>
              {track.genero && track.genero !== 'Desconhecido' && (
                <span 
                  className="px-4 py-2 rounded-full text-sm font-black uppercase text-white shadow-lg"
                  style={{ backgroundColor: GENRE_COLORS[track.genero] }}
                >
                  {track.genero}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Card de música normal (lista)
const MusicCard = ({ track }: { track: any }) => {
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

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-slate-100 shadow-md">
          {loadingCover ? (
            <div className="w-full h-full animate-pulse bg-slate-200 flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-300" size={16} />
            </div>
          ) : artwork ? (
            <img src={artwork.replace('100x100', '300x300')} alt="Capa" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300">
              <Music size={20} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-800 text-base truncate leading-tight mb-1">
            {track.musica}
          </h3>
          <p className="font-bold text-sky-600 text-sm truncate mb-2">
            {track.artista}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-full">
              <Clock size={10} className="text-slate-500" />
              <span className="font-bold text-[10px] text-slate-600">{track.hora}</span>
            </div>
            {track.genero && track.genero !== 'Desconhecido' && (
              <span 
                className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase text-white"
                style={{ backgroundColor: GENRE_COLORS[track.genero] }}
              >
                {track.genero}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Gráfico de pizza MODERNIZADO com imagem para PDF
const GenreChart = ({ data, chartRef }: { data: any[], chartRef?: React.RefObject<HTMLDivElement> }) => {
  if (!data || data.length === 0) return null;

  return (
    <div ref={chartRef} className="bg-gradient-to-br from-purple-50 to-pink-50 p-8 rounded-3xl shadow-xl mb-8 border border-purple-100">
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-4 rounded-2xl shadow-lg">
          <TrendingUp className="text-white" size={28} />
        </div>
        <div>
          <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">Análise de Gêneros</h2>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Distribuição Musical</p>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-inner">
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={120}
              innerRadius={60}
              fill="#8884d8"
              dataKey="value"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={GENRE_COLORS[entry.name] || '#D3D3D3'}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: any) => `${value} músicas`}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {data.map((genre) => (
          <div key={genre.name} className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
            <div 
              className="w-5 h-5 rounded-full shadow-md flex-shrink-0" 
              style={{ backgroundColor: GENRE_COLORS[genre.name] || '#D3D3D3' }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-slate-700 uppercase truncate">{genre.name}</p>
              <p className="text-xs text-slate-500 font-bold">
                {genre.value} músicas • {genre.percentage}%
              </p>
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
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '', hour: 'all' });
  const [visibleCount, setVisibleCount] = useState(9);
  const chartRef = React.useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    try {
      const response = await fetch(`${CSV_URL}&cache_bust=${Date.now()}`);
      const csvText = await response.text();
      const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
      const rows = lines.map(line => {
        const result = []; let cur = ''; let inQuotes = false;
        for (let char of line) { 
          if (char === '"') inQuotes = !inQuotes; 
          else if (char === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; } 
          else cur += char; 
        }
        result.push(cur.trim()); 
        return result;
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
        
        if (row[idxRad] === 'Antena 1' && rawTime.includes('T')) {
          dObj.setHours(dObj.getHours() - 3);
        }

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
      if (sorted.length > 0 && !filters.date) {
        setFilters(prev => ({ ...prev, date: sorted[0].data }));
      }
    } catch (err: any) { 
      if (!isSilent) setError(err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
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
      const matchSearch = filters.search ? 
        (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true;
      const matchGenero = filters.genero ? t.genero === filters.genero : true;
      const matchHour = filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true;
      
      return matchRadio && matchDate && matchSearch && matchGenero && matchHour;
    });
  }, [data, filters]);

  const genreData = useMemo(() => {
    const filtered = data.filter(t => {
      const matchRadio = t.radio.trim() === filters.radio.trim();
      const matchDate = filters.date ? t.data === filters.date : true;
      const matchHour = filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true;
      return matchRadio && matchDate && matchHour;
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
  }, [data, filters.radio, filters.date, filters.hour]);

  const uniqueDates = useMemo(() => {
    const dates = data.filter(t => t.radio === filters.radio).map(d => d.data);
    return [...new Set(dates)].sort().reverse();
  }, [data, filters.radio]);

  const uniqueGenres = useMemo(() => {
    const genres = data
      .filter(t => t.radio === filters.radio && (filters.date ? t.data === filters.date : true))
      .map(d => d.genero)
      .filter(g => g && g !== 'Desconhecido');
    return [...new Set(genres)].sort();
  }, [data, filters.radio, filters.date]);

  const hourOptions = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  }, []);

  const exportPDF = async () => {
    const exportRows = filteredData;

    if (exportRows.length === 0) {
      alert('Nenhum registro encontrado para exportar.');
      return;
    }

    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`IA NO RADIO - ${filters.radio}`, 14, 20);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const hourLabel = filters.hour === 'all' ? 'Todas as horas' : `${filters.hour}:00`;
    doc.text(`Data: ${filters.date} | Horario: ${hourLabel}`, 14, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 34);

    let y = 45;

    if (chartRef.current && genreData.length > 0) {
      try {
        const html2canvas = (await import('https://esm.sh/html2canvas@1.4.1')).default;
        const canvas = await html2canvas(chartRef.current, {
          backgroundColor: '#ffffff',
          scale: 2
        });
        const imgData = canvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 14, y, 180, 90);
        y += 100;
      } catch (err) {
        console.error('Erro ao adicionar grafico:', err);
      }
    }

    if (y > 240) {
      doc.addPage();
      y = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PLAYLIST", 14, y);
    y += 8;

    const renderHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("HORA", 14, y);
      doc.text("ARTISTA", 35, y);
      doc.text("MUSICA", 95, y);
      doc.text("GENERO", 155, y);
      doc.line(14, y + 2, 196, y + 2);
      doc.setFont("helvetica", "normal");
    };

    renderHeader();
    y += 6;

    exportRows.forEach(t => {
      if (y > 280) {
        doc.addPage();
        y = 20;
        renderHeader();
        y += 6;
      }
      doc.setFontSize(8);
      doc.text(t.hora, 14, y); 
      doc.text(t.artista.substring(0, 28), 35, y); 
      doc.text(t.musica.substring(0, 28), 95, y);
      doc.text(t.genero.substring(0, 18), 155, y);
      y += 6;
    });

    doc.save(`IAnoRadio_${filters.radio}_${filters.date}_${hourLabel}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-3 rounded-2xl shadow-lg">
              <Radio size={32} className="text-white" />
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tight text-slate-900 uppercase leading-none">
                IA NO RÁDIO
              </h1>
              <p className="text-xs font-bold text-purple-600 uppercase tracking-wider mt-1">
                Monitoramento Inteligente
              </p>
            </div>
          </div>
          <button 
            onClick={() => fetchData()} 
            className="p-4 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all hover:scale-105 active:scale-95"
          >
            <RefreshCw 
              className={refreshing ? 'animate-spin text-purple-600' : 'text-slate-600'} 
              size={24} 
            />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="bg-white p-8 rounded-3xl shadow-xl mb-8 border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <Filter className="text-purple-600" size={24} />
            <h3 className="font-black text-xl text-slate-900 uppercase tracking-tight">Filtros</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
              <button 
                key={r} 
                onClick={() => { 
                  setFilters(f => ({ ...f, radio: r, date: '', genero: '', hour: 'all' })); 
                  setVisibleCount(9); 
                }} 
                className={`py-5 rounded-2xl font-black text-sm uppercase transition-all transform hover:scale-105 active:scale-95 ${
                  filters.radio === r 
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-xl' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              placeholder="Buscar artista ou música..." 
              className="w-full pl-14 pr-5 py-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-700 border-2 border-transparent focus:border-purple-300 transition-all" 
              value={filters.search} 
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} 
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-600" size={20} />
              <select 
                className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-slate-700 appearance-none outline-none border-2 border-transparent focus:border-purple-300 transition-all cursor-pointer" 
                value={filters.date} 
                onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}
              >
                {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="relative">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-pink-600" size={20} />
              <select 
                className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-slate-700 appearance-none outline-none border-2 border-transparent focus:border-pink-300 transition-all cursor-pointer" 
                value={filters.hour} 
                onChange={e => setFilters(f => ({ ...f, hour: e.target.value }))}
              >
                <option value="all">Todas as horas</option>
                {hourOptions.map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>

            <div className="relative">
              <Music className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-600" size={20} />
              <select 
                className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-slate-700 appearance-none outline-none border-2 border-transparent focus:border-purple-300 transition-all cursor-pointer" 
                value={filters.genero} 
                onChange={e => setFilters(f => ({ ...f, genero: e.target.value }))}
              >
                <option value="">Todos os gêneros</option>
                {uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <button 
            onClick={exportPDF} 
            className="w-full mt-6 py-5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-2xl font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 active:scale-95"
          >
            <Download size={20} /> Exportar Relatório PDF
          </button>
        </div>

        {filteredData.length > 0 && !filters.search && <NowPlayingCard track={filteredData[0]} />}

        <GenreChart data={genreData} chartRef={chartRef} />

        <div className="space-y-3">
          {loading ? (
            <div className="py-32 text-center">
              <Loader2 className="animate-spin mx-auto text-purple-600 mb-6" size={48} />
              <p className="font-bold text-slate-500 text-sm uppercase tracking-wider">
                Carregando dados...
              </p>
            </div>
          ) : filteredData.length > 0 ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Music className="text-purple-600" size={24} />
                <h3 className="font-black text-xl text-slate-900 uppercase">
                  Últimas Execuções ({filteredData.length} músicas)
                </h3>
              </div>
              
              {filteredData.slice(filters.search ? 0 : 1, visibleCount + 1).map((track) => (
                <MusicCard key={track.id} track={track} />
              ))}
              
              {filteredData.length > visibleCount + 1 && (
                <button 
                  onClick={() => setVisibleCount(c => c + 9)} 
                  className="w-full py-6 rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50 text-purple-700 font-black hover:bg-purple-100 transition-all uppercase text-sm tracking-wider flex items-center justify-center gap-2 hover:scale-105 active:scale-95"
                >
                  <Plus size={20} /> Carregar Mais Músicas
                </button>
              )}
            </>
          ) : (
            <div className="bg-white p-24 rounded-3xl text-center border-4 border-dashed border-slate-200">
              <Music className="mx-auto text-slate-300 mb-4" size={64} />
              <p className="font-black text-slate-400 uppercase text-lg tracking-wider">
                Nenhum registro encontrado
              </p>
              <p className="text-slate-400 text-sm mt-2">
                Ajuste os filtros para ver mais resultados
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
