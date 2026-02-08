import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Search, Clock, RefreshCw, Radio, 
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

// Componente do Gráfico
const GenreChart = ({ data }: { data: any[] }) => {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-10 border border-slate-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-gradient-to-br from-purple-400 to-pink-400 p-3 rounded-xl shadow-lg">
          <PieChartIcon className="text-white" size={24} />
        </div>
        <h2 className="font-black text-xl text-slate-900 uppercase">Gêneros Musicais</h2>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} outerRadius={80} fill="#8884d8" dataKey="value">
              {data.map((entry, index) => <Cell key={`cell-${index}`} fill={GENRE_COLORS[entry.name] || '#D3D3D3'} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Componente Principal
const App = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date: '', search: '', radio: 'Metropolitana FM', genero: '' });

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const response = await fetch(`${CSV_URL}&cb=${Date.now()}`);
      const csvText = await response.text();
      // Lógica de processamento do CSV simplificada para estabilidade
      const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
      const rows = lines.map(line => line.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      
      // Mapeamento dinâmico de colunas
      const header = rows[0].map(h => h.toLowerCase().trim());
      const idx = { art: header.indexOf('artista'), mus: header.indexOf('musica'), rad: header.indexOf('radio'), gen: header.indexOf('genero'), tim: header.indexOf('tocou_em') };

      const formatted = rows.slice(1).map((row, i) => ({
        id: i,
        artista: row[idx.art] || '?',
        musica: row[idx.mus] || '?',
        radio: row[idx.rad] || 'Metropolitana FM',
        genero: row[idx.gen] || 'Desconhecido',
        hora: row[idx.tim] ? row[idx.tim].split(' ')[1] : '00:00'
      }));

      setData(formatted);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const genreData = useMemo(() => {
    const counts: any = {};
    data.filter(t => t.radio === filters.radio).forEach(t => counts[t.genero] = (counts[t.genero] || 0) + 1);
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [data, filters.radio]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <header className="flex items-center gap-3 mb-10">
        <div className="bg-yellow-400 p-2 rounded-xl text-white shadow-lg"><Radio /></div>
        <h1 className="font-black text-2xl text-slate-900 uppercase">RÁDIO AI</h1>
      </header>

      <GenreChart data={genreData} />
      
      {/* Lista de músicas e filtros aqui... */}
      <div className="text-slate-400 font-bold text-center py-10">
        {loading ? <Loader2 className="animate-spin mx-auto" /> : "Playlist Carregada"}
      </div>
    </div>
  );
};

// INICIALIZAÇÃO SEGURA
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
