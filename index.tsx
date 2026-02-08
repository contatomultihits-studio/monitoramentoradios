import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Clock, RefreshCw, Radio, Music, Loader2, Plus, Download, PieChart as PieChartIcon } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const SHEET_ID = '1xFRBBHpmn38TiBdZcwN2556811FKkfbEEB3HmmdxT1s';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const COLORS = ['#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181', '#AA96DA', '#FCBAD3'];

const MusicCard = ({ track, isNowPlaying }) => {
  const [artwork, setArtwork] = useState(null);
  useEffect(() => {
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(track.artista + ' ' + track.musica)}&entity=song&limit=1`)
      .then(res => res.json()).then(data => setArtwork(data.results?.[0]?.artworkUrl100 || null));
  }, [track.artista, track.musica]);

  return (
    <div className={`flex items-center gap-4 p-5 rounded-[2rem] mb-3 ${isNowPlaying ? "bg-slate-900 border-l-8 border-yellow-400" : "bg-white border"}`}>
      <div className="w-20 h-20 overflow-hidden rounded-2xl bg-slate-100 flex-shrink-0">
        {artwork ? <img src={artwork.replace('100x100', '400x400')} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Music className="text-slate-300" /></div>}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={`font-black uppercase truncate ${isNowPlaying ? "text-white" : "text-slate-800"}`}>{track.musica}</h3>
        <p className="font-bold text-sky-500 text-sm uppercase">{track.artista}</p>
        <div className="flex gap-2 mt-1">
          <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-full">{track.hora}</span>
          <span className="text-[10px] font-bold bg-purple-100 text-purple-600 px-2 py-1 rounded-full">{track.genero}</span>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ radio: 'Metropolitana FM', date: '', genero: '' });

  const fetchData = useCallback(async () => {
    const res = await fetch(`${CSV_URL}&cb=${Date.now()}`);
    const text = await res.text();
    const rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    const header = rows[0].map(h => h.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    const idx = { art: header.indexOf('artista'), mus: header.indexOf('musica'), tim: header.indexOf('tocou_em'), rad: header.indexOf('radio'), gen: header.indexOf('genero') };
    
    const formatted = rows.slice(1).map(row => ({
      artista: row[idx.art] || '?', musica: row[idx.mus] || '?', radio: row[idx.rad] || '?',
      genero: row[idx.gen] || 'Desconhecido',
      data: (row[idx.tim] || '').split(' ')[0],
      hora: (row[idx.tim] || '').split(' ')[1]?.substring(0, 5) || '00:00',
      ts: new Date(row[idx.tim]).getTime() || 0
    })).filter(t => t.artista !== '?').sort((a, b) => b.ts - a.ts);

    setData(formatted);
    if (!filters.date && formatted.length > 0) setFilters(f => ({ ...f, date: formatted[0].data }));
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => data.filter(t => t.radio === filters.radio && (filters.date ? t.data === filters.date : true) && (filters.genero ? t.genero === filters.genero : true)), [data, filters]);
  const stats = useMemo(() => {
    const counts = {};
    filtered.forEach(t => { if(t.genero !== 'Desconhecido') counts[t.genero] = (counts[t.genero] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-6">
        <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-2xl">
          {['Metropolitana FM', 'Antena 1', 'Forbes Radio'].map(r => (
            <button key={r} onClick={() => setFilters({...filters, radio: r, genero: ''})} className={`flex-1 py-3 rounded-xl font-bold text-xs ${filters.radio === r ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>{r}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="p-4 bg-slate-50 rounded-2xl font-bold" value={filters.date} onChange={e => setFilters({...filters, date: e.target.value})}>
            {[...new Set(data.filter(t => t.radio === filters.radio).map(d => d.data))].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="p-4 bg-slate-50 rounded-2xl font-bold" value={filters.genero} onChange={e => setFilters({...filters, genero: e.target.value})}>
            <option value="">Gêneros</option>
            {[...new Set(data.map(d => d.genero))].filter(g => g !== 'Desconhecido').map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="bg-white p-6 rounded-[2.5rem] shadow-xl mb-6 h-64">
          <ResponsiveContainer><PieChart><Pie data={stats} dataKey="value" nameKey="name" outerRadius={60} label>{stats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        </div>
      )}

      {loading ? <Loader2 className="animate-spin mx-auto mt-10" /> : filtered.map((t, i) => <MusicCard key={i} track={t} isNowPlaying={i === 0} />)}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

