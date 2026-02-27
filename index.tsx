import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Calendar, Clock, RefreshCw, Radio, 
  Music, Loader2, Plus, Download, PieChart as PieChartIcon,
  TrendingUp, Sparkles, Filter, Megaphone, Activity
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

// --- CONFIGURAÇÕES ---
const REFRESH_INTERVAL_MS = 30000;

// Pega Supabase client do window (já criado no musical.html)
const getSupabaseClient = () => (window as any)._supabaseClient;

// Cores vibrantes em tons de AZUL para os gêneros
const GENRE_COLORS: Record<string, string> = {
  'Sertanejo': '#3B82F6',
  'Pop': '#0EA5E9',
  'Rock': '#1E40AF',
  'MPB': '#60A5FA',
  'Funk': '#2563EB',
  'Pagode': '#0284C7',
  'Rap/Hip Hop': '#1D4ED8',
  'Eletrônica': '#06B6D4',
  'Gospel': '#7DD3FC',
  'Samba': '#1E3A8A',
  'Forró': '#93C5FD',
  'Reggae': '#34D399',
  'Jazz': '#1e293b',
  'Desconhecido': '#D3D3D3',
  'Outros': '#B8B8B8'
};

// Tooltip para mostrar gêneros dentro de "Outros"
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-4 rounded-xl shadow-2xl border border-slate-100">
        <p className="font-black text-slate-800 uppercase text-xs mb-1">{data.name}</p>
        <p className="font-bold text-blue-600 text-xs">{data.value} músicas ({data.percentage}%)</p>
        {data.subGenres && (
          <div className="mt-2 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Inclui:</p>
            <p className="text-[10px] text-slate-600 leading-tight">{data.subGenres.join(', ')}</p>
          </div>
        )}
      </div>
    );
  }
  return null;
};

// Card da música tocando AGORA - TEMA AZUL
const NowPlayingCard = ({ track }: { track: any }) => {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 p-8 rounded-3xl shadow-2xl mb-8">
      <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent animate-pulse"></div>
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-300"></span>
          </span>
          <span className="text-white/90 font-black text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles size={16} /> Tocando Agora
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/20">
              {track.capa ? (
                <img src={track.capa} alt="Capa" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/10">
                  <Music size={48} className="text-white/40" />
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="font-black text-3xl sm:text-4xl text-white mb-2 leading-tight drop-shadow-lg">
              {track.musica}
            </h2>
            <p className="font-bold text-xl sm:text-2xl text-sky-200 mb-4 drop-shadow-md">
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
                  style={{ backgroundColor: GENRE_COLORS[track.genero] || '#3B82F6' }}
                >
                  {track.genero}
                </span>
              )}
              {track.bpm && (
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500 rounded-full shadow-lg">
                  <Activity size={16} className="text-white" />
                  <span className="font-black text-white text-sm">{track.bpm} BPM</span>
                </div>
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
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-slate-100 shadow-md">
          {track.capa ? (
            <img src={track.capa} alt="Capa" className="w-full h-full object-cover" />
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
          <p className="font-bold text-blue-600 text-sm truncate mb-2">
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
                style={{ backgroundColor: GENRE_COLORS[track.genero] || '#3B82F6' }}
              >
                {track.genero}
              </span>
            )}
            {track.bpm && (
              <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 rounded-full">
                <Activity size={10} className="text-white" />
                <span className="font-black text-[10px] text-white">{track.bpm} BPM</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Gráfico de pizza com lógica de "Outros"
const GenreChart = ({ data, chartRef }: { data: any[], chartRef?: React.RefObject<HTMLDivElement> }) => {
  if (!data || data.length === 0) return null;

  const MIN_PERCENTAGE = 3;
  const knownGenres = data.filter(g => g.name !== 'Desconhecido');
  if (knownGenres.length === 0) return null;
  
  const mainGenres = knownGenres.filter(g => parseFloat(g.percentage) >= MIN_PERCENTAGE);
  const smallGenres = knownGenres.filter(g => parseFloat(g.percentage) < MIN_PERCENTAGE);
  
  let chartData = [...mainGenres];
  if (smallGenres.length > 0) {
    const othersValue = smallGenres.reduce((sum, g) => sum + g.value, 0);
    const totalKnown = knownGenres.reduce((sum, g) => sum + g.value, 0);
    chartData.push({
      name: 'Outros',
      value: othersValue,
      percentage: ((othersValue / totalKnown) * 100).toFixed(1),
      subGenres: smallGenres.map(g => g.name)
    });
  }
  chartData = chartData.sort((a, b) => b.value - a.value);

  return (
    <div ref={chartRef} className="bg-gradient-to-br from-blue-50 to-indigo-50 p-8 rounded-3xl shadow-xl mb-8 border border-blue-100">
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-2xl shadow-lg">
          <TrendingUp className="text-white" size={28} />
        </div>
        <div>
          <h2 className="font-black text-2xl tracking-tight text-slate-900 uppercase">Análise de Gêneros</h2>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wide">Distribuição Musical (Sem Desconhecidos)</p>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-inner">
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={120}
              innerRadius={60}
              fill="#3B82F6"
              dataKey="value"
              paddingAngle={2}
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={GENRE_COLORS[entry.name] || '#B8B8B8'}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {chartData.map((genre) => (
          <div key={genre.name} className="flex items-center gap-3 p-4 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
            <div 
              className="w-5 h-5 rounded-full shadow-md flex-shrink-0" 
              style={{ backgroundColor: GENRE_COLORS[genre.name] || '#B8B8B8' }}
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
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '', hour: 'all', bpm: 'all' });
  const [visibleCount, setVisibleCount] = useState(9);
  const chartRef = React.useRef<HTMLDivElement>(null);
  
  const fetchDataRef = useRef<(isSilent?: boolean) => Promise<void>>();

  // Busca dados do Supabase
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client não disponível');

      const { data: tracks, error: queryError } = await supabase
        .from('radio_airplay')
        .select('*')
        .order('tocou_em', { ascending: false })
        .limit(1000);
      
      if (queryError) throw queryError;
      
      const formatted = tracks.map((t: any) => {
        const utcDate = new Date(t.tocou_em);
        
        const brazilDateStr = utcDate.toLocaleString('pt-BR', { 
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        
        const [datePart, timePart] = brazilDateStr.split(', ');
        const [day, month, year] = datePart.split('/');
        const isoDate = `${year}-${month}-${day}`;
        
        return {
          id: t.id,
          artista: t.artista || 'Desconhecido',
          musica: t.musica || 'Sem Título',
          radio: t.radio || 'Metropolitana FM',
          genero: t.genero || 'Desconhecido',
          data: isoDate,
          hora: timePart,
          timestamp: utcDate.getTime(),
          capa: t.capa,
          bpm: t.bpm
        };
      });
      
      setData(formatted);
      
      setFilters(prev => {
        if (!prev.date && formatted.length > 0) {
          return { ...prev, date: formatted[0].data };
        }
        return prev;
      });
    } catch (err: any) {
      console.error('Erro ao buscar dados:', err);
      if (!isSilent) setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => { 
    fetchData(); 
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDataRef.current?.(true);
    }, REFRESH_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, []);

  const filteredData = useMemo(() => {
    return data.filter(t => {
      const matchRadio = t.radio.trim() === filters.radio.trim();
      const matchDate = filters.date ? t.data === filters.date : true;
      const matchSearch = filters.search ? 
        (t.artista + t.musica).toLowerCase().includes(filters.search.toLowerCase()) : true;
      const matchGenero = filters.genero ? t.genero === filters.genero : true;
      const matchHour = filters.hour !== 'all' ? t.hora.startsWith(`${filters.hour}:`) : true;
      
      let matchBpm = true;
      if (filters.bpm !== 'all' && t.bpm) {
        if (filters.bpm === 'slow') matchBpm = t.bpm < 100;
        else if (filters.bpm === 'moderate') matchBpm = t.bpm >= 100 && t.bpm <= 120;
        else if (filters.bpm === 'fast') matchBpm = t.bpm > 120;
      }
      
      return matchRadio && matchDate && matchSearch && matchGenero && matchHour && matchBpm;
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
        const canvas = await html2canvas(chartRef.current, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 14, y, 180, 90);
        y += 100;
      } catch (err) { console.error('Erro ao adicionar gráfico:', err); }
    }

    if (y > 240) { doc.addPage(); y = 20; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PLAYLIST", 14, y);
    y += 8;

    const renderHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("HORA", 14, y);
      doc.text("ARTISTA", 32, y);
      doc.text("MUSICA", 95, y);
      doc.text("GENERO", 158, y);
      doc.text("BPM", 185, y);
      doc.line(14, y + 1, 196, y + 1);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
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
      const generoTxt = t.genero === 'Desconhecido' ? '' : t.genero;
      const bpmTxt = t.bpm ? String(t.bpm) : '';
      doc.text(t.hora, 14, y); 
      doc.text(t.artista.substring(0, 30), 32, y); 
      doc.text(t.musica.substring(0, 38), 95, y);
      doc.text(generoTxt.substring(0, 18), 158, y);
      doc.text(bpmTxt, 185, y);
      y += 6;
    });

    doc.save(`IAnoRadio_${filters.radio}_${filters.date}_${hourLabel}.pdf`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-blue-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-3 rounded-2xl shadow-lg">
              <Radio size={32} className="text-white" />
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tight text-slate-900 uppercase leading-none">
                IA NO RÁDIO
              </h1>
              <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mt-1">
                Monitoramento Musical
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/comercial" className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 rounded-xl font-bold text-emerald-700 text-xs uppercase tracking-wider transition-all flex items-center gap-2">
              <Megaphone size={14} /> Ver Comercial
            </a>
            <button 
              onClick={() => fetchData()} 
              className="p-4 bg-blue-50 rounded-2xl hover:bg-blue-100 transition-all hover:scale-105 active:scale-95"
            >
              <RefreshCw 
                className={refreshing ? 'animate-spin text-blue-600' : 'text-blue-600'} 
                size={24} 
              />
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
              <button 
                key={r} 
                onClick={() => { 
                  setFilters(f => ({ ...f, radio: r, date: '', genero: '', hour: 'all', bpm: 'all' })); 
                  setVisibleCount(9); 
                }} 
                className={`py-5 rounded-2xl font-black text-sm uppercase transition-all transform hover:scale-105 active:scale-95 ${
                  filters.radio === r 
                    ? 'bg-blue-600 text-white shadow-xl' 
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
              className="w-full pl-14 pr-5 py-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-700 border-2 border-transparent focus:border-blue-300 transition-all" 
              value={filters.search} 
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} 
            />
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

          <button 
            onClick={exportPDF} 
            className="w-full mt-2 py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 active:scale-95"
          >
            <Download size={20} /> Exportar Relatório PDF
          </button>
        </div>

        {filteredData.length > 0 && !filters.search && <NowPlayingCard track={filteredData[0]} />}

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
              {filteredData.slice(filters.search ? 0 : 1, visibleCount + 1).map((track) => (
                <MusicCard key={track.id} track={track} />
              ))}
              {filteredData.length > visibleCount + 1 && (
                <button onClick={() => setVisibleCount(c => c + 9)} className="w-full py-6 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:scale-105 active:scale-95">
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

// ⭐ AGUARDA SUPABASE CLIENT ESTAR PRONTO ANTES DE RENDERIZAR
(async () => {
  const maxAttempts = 10;
  let attempts = 0;
  
  console.log('[REACT] Aguardando Supabase client...');
  
  while (attempts < maxAttempts) {
    if ((window as any)._supabaseReady && (window as any)._supabaseClient) {
      console.log('[REACT] ✅ Client pronto, renderizando App!');
      const root = createRoot(document.getElementById('root')!);
      root.render(<App />);
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
    console.log(`[REACT] Tentativa ${attempts}/${maxAttempts}...`);
  }
  
  console.error('[REACT] ❌ Timeout: Supabase client não inicializou');
  document.getElementById('root')!.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#EF4444,#DC2626);">
      <div style="text-align:center;color:white;padding:2rem;">
        <h1 style="font-size:2rem;font-weight:900;margin-bottom:1rem;">❌ Erro de Inicialização</h1>
        <p style="margin-bottom:2rem;">Não foi possível conectar ao banco de dados.</p>
        <button onclick="location.reload()" style="background:white;color:#DC2626;padding:1rem 2rem;border:none;border-radius:0.5rem;font-weight:bold;cursor:pointer;">
          Tentar Novamente
        </button>
      </div>
    </div>
  `;
})();