import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import ioClient from "https://esm.sh/socket.io-client@2.5.0?conditions=browser";



const LASTFM_API_KEY = "3d5a34a8761cf3bfcce2124bb06f68f7";

// Identificação de navegador completa nos pedidos às rádios. "Mozilla/5.0" sozinho
// (ou o padrão do Deno) é reconhecido como robô por filtros anti-bot.
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// Recuo após bloqueio: se a rádio responder 403/429, espera este tempo antes de
// tentar de novo (estado em public.coleta_bloqueios), em vez de insistir a cada minuto.
const RECUO_BLOQUEIO_MS = 15 * 60 * 1000;



type InfoExtra = {
  genero: string | null;
  bpm: number | null;
  capa: string | null;
  ano_lancamento: string | null;
  artistaCanonico: string | null;
  musicaCanonica: string | null;
  tomMusical: string | null;
  camelot: string | null;
};



type RadioConfig = {
  nome: string;
  url: string;
  id: string;
  tipo: "json" | "xml" | "icy";
  timestampTipo: "utc" | "local_brasilia";
};

// ===== TABELAS DE CONVERSÃO PARA CAMELOT =====
const CAMELOT_MAIOR: Record<string, string> = {
  "C": "8B", "G": "9B", "D": "10B", "A": "11B", "E": "12B", "B": "1B",
  "F#": "2B", "Gb": "2B", "C#": "3B", "Db": "3B", "G#": "4B", "Ab": "4B",
  "D#": "5B", "Eb": "5B", "A#": "6B", "Bb": "6B", "F": "7B"
};

const CAMELOT_MENOR: Record<string, string> = {
  "A": "8A", "E": "9A", "B": "10A", "F#": "11A", "Gb": "11A",
  "C#": "12A", "Db": "12A", "G#": "1A", "Ab": "1A", "D#": "2A", "Eb": "2A",
  "A#": "3A", "Bb": "3A", "F": "4A", "C": "5A", "G": "6A", "D": "7A"
};

function mapearCamelot(key?: string | null, scale?: string | null): { tomMusical: string | null; camelot: string | null } {
  if (!key || !scale) return { tomMusical: null, camelot: null };
  const keyNorm = key.trim();
  const isMaior = scale.trim().toLowerCase().startsWith("maj");
  const tabela = isMaior ? CAMELOT_MAIOR : CAMELOT_MENOR;
  return {
    tomMusical: `${keyNorm} ${isMaior ? "Maior" : "Menor"}`,
    camelot: tabela[keyNorm] ?? null
  };
}



function limparTexto(v?: string): string {
  return (v || "")
    .normalize("NFKC")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function corrigirCodificacao(str: string): string {
  if (!str) return "";
  try {
    // Tenta converter de uma string que parece UTF-8 mas foi lida como ISO
    return decodeURIComponent(escape(str));
  } catch (e) {
    // Substituição manual para casos comuns de má codificação
    return str
      .replace(/Ã\s/g, "É ")
      .replace(/Ã‰/g, "É")
      .replace(/Ã\(/g, "Ê")
      .replace(/Ã\)/g, "Í")
      .replace(/Ã³/g, "Ó")
      .replace(/Ã¡/g, "Á")
      .replace(/Ã£/g, "Ã")
      .replace(/Ãµ/g, "Õ")
      .replace(/Ã§/g, "Ç");
  }
}

function isSystemMessage(artista: string, musica: string): boolean {
  const combined = `${artista} - ${musica}`.toLowerCase();

  // Filtros Globais
  if (combined.includes("entre em contato") ||
      combined.includes("informe qual site ou app") ||
      combined.includes("o melhor mix do brasil") ||
      combined.includes("104.3 mhz") ||
      combined.includes("tudo o que voce gosta") ||
      combined.includes("tudo o que você gosta") ||
      combined.includes("gazeta fm") ||
      combined.includes("alpha fm") ||
      combined.includes("101.7") ||
      combined.includes("a radio que voce ama") ||
      combined.includes("a rádio que você ama") ||
      combined.includes("a primeira") ||
      combined.includes("dumont")) {
    return true;
  }

  // Filtros Específicos para MIX RIO FM ou placeholders genéricos
  if (artista === "." || musica === "." ||
      combined.includes("singer ketan raj") ||
      combined.includes("tejaji new song")) {
    return true;
  }

  return combined.length < 5; // Ignora strings muito curtas
}

function normalizarTexto(v?: string): string {
  return limparTexto(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/\b(ft|feat|featuring|part|pt)\.?\b/g, " ")
    .replace(/\((ao vivo|live|remix|radio edit|versao radio|versão radio|explicit|official)\)/gi, " ")
    .replace(/\[(ao vivo|live|remix|radio edit|versao radio|versão radio|explicit|official)\]/gi, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is"));
  return limparTexto(match?.[1]?.trim());
}

function brasiliaParaUTC(timestampLocal: string): string | undefined {
  let valorNormalizado = timestampLocal.trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(valorNormalizado)) {
    const hoje = new Date().toISOString().substring(0, 10);
    valorNormalizado = `${hoje}T${valorNormalizado}`;
  }
    valorNormalizado = valorNormalizado.replace(" ", "T");

  // Se já tem timezone ou é UTC, tenta parsear diretamente
  if (valorNormalizado.endsWith("Z") || valorNormalizado.includes("+") || valorNormalizado.match(/-\d{2}:\d{2}$/)) {
    const d = new Date(valorNormalizado);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // Tenta adicionar o offset de Brasília (-03:00)
  const dComOffset = new Date(valorNormalizado + "-03:00");
  if (!Number.isNaN(dComOffset.getTime())) return dComOffset.toISOString();

  // Última tentativa: parsear sem offset e ver se é válido
  const dSemOffset = new Date(valorNormalizado);
  if (!Number.isNaN(dSemOffset.getTime())) return dSemOffset.toISOString();

  return undefined;
}

function educadoraHoraBrasiliaParaUTC(timestampLocal: string): string | undefined {
  const valorNormalizado = timestampLocal.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(valorNormalizado)) {
    return brasiliaParaUTC(valorNormalizado);
  }

  const partesData = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const dataBrasilia = `${partesData.find((parte) => parte.type === "year")?.value}-${partesData.find((parte) => parte.type === "month")?.value}-${partesData.find((parte) => parte.type === "day")?.value}`;
  const dataHoraBrasilia = `${dataBrasilia}T${valorNormalizado}`;
  const dataComOffset = new Date(`${dataHoraBrasilia}-03:00`);
  if (!Number.isNaN(dataComOffset.getTime())) return dataComOffset.toISOString();

  return undefined;
}

function parseUTCSeguro(valor?: string): string | undefined {
  if (!valor) return undefined;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function getTimestampUTC(): string {
  return new Date().toISOString();
}

// Limita apenas chamadas externas de metadados para que uma API lenta
// não impeça a gravação da música na tabela radio_airplay.
async function fetchComTimeout(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Valores que a antiga estimativa por duração gravava (até a v103). No histórico
// não dá para separar o estimado do real, então esses valores não são reaproveitados.
const BPM_ESTIMATIVA_ANTIGA = new Set([128, 120, 110, 100, 95, 90]);

function estimarBpmPorDuracao(durationMs?: number | null): number | null {
  if (!durationMs || durationMs <= 0) return null;
  const sec = Math.round(durationMs / 1000);
  if (sec < 90)   return null;
  if (sec <= 150) return 128;
  if (sec <= 190) return 120;
  if (sec <= 230) return 110;
  if (sec <= 280) return 100;
  if (sec <= 340) return 95;
  return 90;
}

function mapearGenero(genres: string[]): string {
  const g = genres.join(" ").toLowerCase();
  if (g.includes("sertanejo") || g.includes("arrocha") || g.includes("agronejo") ||
    g.includes("modao") || g.includes("universitario")) return "Sertanejo";
  if (g.includes("pagode") || g.includes("samba") || g.includes("cavaquinho")) return "Pagode/Samba";
  if (g.includes("funk") && (g.includes("carioca") || g.includes("ostentacao") ||
    g.includes("baile") || g.includes("150") || g.includes("mandelao") ||
    g.includes("proibidao") || g.includes("brasileiro") || g.includes("brazilian"))) return "Funk";
  if (g.includes("funk") && !g.includes("disco")) return "Funk";
  if (g.includes("forro") || g.includes("piseiro") || g.includes("pisadinha") ||
    g.includes("xote") || g.includes("brega")) return "Forró";
  if (g.includes("axe") || g.includes("axé") || g.includes("carnaval")) return "Axé";
  if (g.includes("mpb") || g.includes("bossa nova") || g.includes("musica popular brasileira")) return "MPB";
  if (g.includes("rap") || g.includes("hip hop") || g.includes("trap") || g.includes("drill")) return "Rap/Hip Hop";
  if (g.includes("gospel") || g.includes("louvor") || g.includes("adoracao") ||
    g.includes("ccb") || g.includes("catolico") || g.includes("christian")) return "Gospel";
  if (g.includes("pop") && !g.includes("k-pop")) return "Pop";
  if (g.includes("rock") || g.includes("metal") || g.includes("punk")) return "Rock";
  if (g.includes("electro") || g.includes("house") || g.includes("dance") ||
    g.includes("techno") || g.includes("edm")) return "Eletrônica";
  if (g.includes("reggae") || g.includes("ska")) return "Reggae";
  if (g.includes("r&b") || g.includes("soul") || g.includes("rnb")) return "R&B/Soul";
  if (g.includes("jazz") || g.includes("blues")) return "Jazz/Blues";
  if (g.includes("country") && !g.includes("sertanejo")) return "Country";
  const fallback = genres[0] || "Variados";
  if (fallback.toLowerCase().includes("brazilian") ||
    fallback.toLowerCase().includes("brasilianische") ||
    fallback.toLowerCase().includes("brasil")) {
    if (genres.length > 1) return genres[1].charAt(0).toUpperCase() + genres[1].slice(1);
    return "Nacional";
  }
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

async function buscarItunesMeta(artista: string, musica: string): Promise<{ capa: string | null; durationMs: number | null; ano: string | null; artistaCanonico: string | null; musicaCanonica: string | null; matchForte: boolean }> {
  try {
    const query   = encodeURIComponent(`${artista} ${musica}`);
    const res     = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=5`);
    const data    = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return { capa: null, durationMs: null, ano: null, artistaCanonico: null, musicaCanonica: null, matchForte: false };
    const artistaNorm = normalizarTexto(artista);
    const musicaNorm  = normalizarTexto(musica);
    let matchForte = false;
    let best = results.find((r: any) =>
      normalizarTexto(r.artistName).includes(artistaNorm.split(" ")[0] || "") &&
      normalizarTexto(r.trackName).includes(musicaNorm.split(" ")[0] || "")
    );
    if (best) {
      matchForte = true;
    } else {
      best = results[0];
    }
    return {
      capa:             best?.artworkUrl100?.replace("100x100bb", "600x600bb") ?? null,
      durationMs:       typeof best?.trackTimeMillis === "number" ? best.trackTimeMillis : null,
      ano:              best?.releaseDate?.substring(0, 4) ?? null,
      artistaCanonico:  matchForte ? (best?.artistName ?? null) : null,
      musicaCanonica:   matchForte ? (best?.trackName ?? null) : null,
      matchForte
    };
  } catch (e) {
    console.error("[ITUNES] Exception:", e.message);
    return { capa: null, durationMs: null, ano: null, artistaCanonico: null, musicaCanonica: null, matchForte: false };
  }
}

async function buscarDeezerCompleto(artista: string, musica: string): Promise<{ genero: string | null; bpm: number | null; ano: string | null; capa: string | null; artistaCanonico: string | null; musicaCanonica: string | null; matchForte: boolean }> {
  try {
    console.log("[DEEZER] Buscando:", artista, "-", musica);
    let query      = encodeURIComponent(`artist:"${artista}" track:"${musica}"`);
    console.log("[DEEZER] Antes do fetch search:", artista, "-", musica);
    let searchRes  = await fetchComTimeout(`https://api.deezer.com/search?q=${query}&limit=5`);
    console.log("[DEEZER] Depois do fetch search:", searchRes.status);
    let searchData = await searchRes.json();
    console.log("[DEEZER] Depois do JSON search:", artista, "-", musica);
    let matchForte = false;
    let track = searchData.data?.find((t: any) => {
      const artistMatch = normalizarTexto(t.artist?.name).includes(normalizarTexto(artista).split(" ")[0] || "");
      const trackMatch  = normalizarTexto(t.title).includes(normalizarTexto(musica).split(" ")[0] || "");
      return artistMatch && trackMatch;
    });
    if (track) {
      matchForte = true;
    } else {
      track = searchData.data?.[0];
    }
    if (!track) {
      console.log("[DEEZER] Busca exata falhou, tentando busca relaxada...");
      query      = encodeURIComponent(`${artista} ${musica}`);
      searchRes  = await fetchComTimeout(`https://api.deezer.com/search?q=${query}&limit=10`);
      searchData = await searchRes.json();
      const candidates = searchData.data || [];
      track = candidates.find((t: any) => {
        const artistMatch = normalizarTexto(t.artist?.name).includes(normalizarTexto(artista).split(" ")[0] || "");
        const trackMatch  = normalizarTexto(t.title).includes(normalizarTexto(musica).split(" ")[0] || "");
        return artistMatch && trackMatch;
      });
      if (track) {
        matchForte = true;
      } else {
        track = candidates[0];
      }
    }
    if (!track) {
      console.log("[DEEZER] ❌ Track não encontrada");
      return { genero: null, bpm: null, ano: null, capa: null, artistaCanonico: null, musicaCanonica: null, matchForte: false };
    }
    const capaDeezer: string | null = track.album?.cover_xl ?? track.album?.cover_big ?? null;
    const trackId = track.id;
    const albumId = track.album?.id;
    console.log(`[DEEZER] ✅ Track ID: ${trackId} | Album ID: ${albumId}`);
    let genero: string | null = null;
    let ano: string | null = null;
    if (albumId) {
      const albumRes  = await fetchComTimeout(`https://api.deezer.com/album/${albumId}`);
      const albumData = await albumRes.json();
      if (albumData.genres?.data?.length > 0) {
        genero = mapearGenero(albumData.genres.data.map((g: any) => g.name));
        console.log(`[DEEZER] ✅ Gênero: ${genero}`);
      }
      if (albumData.release_date) {
        ano = albumData.release_date.substring(0, 4);
        console.log(`[DEEZER] ✅ Ano: ${ano}`);
      }
    }
    let bpm: number | null = null;
    const trackRes  = await fetchComTimeout(`https://api.deezer.com/track/${trackId}`);
    const trackData = await trackRes.json();
    if (trackData.bpm && trackData.bpm > 0) {
      bpm = Math.round(trackData.bpm);
      console.log(`[DEEZER] ✅ BPM: ${bpm}`);
    } else {
      console.log("[DEEZER] ⚠️ BPM não disponível nesta faixa");
    }
    return {
      genero, bpm, ano, capa: capaDeezer,
      artistaCanonico: matchForte ? (track.artist?.name ?? null) : null,
      musicaCanonica:  matchForte ? (track.title ?? null) : null,
      matchForte
    };
  } catch (e) {
    console.error("[DEEZER] Exception:", e.message);
    return { genero: null, bpm: null, ano: null, capa: null, artistaCanonico: null, musicaCanonica: null, matchForte: false };
  }
}

async function buscarLastFM(artista: string, musica: string): Promise<{ genero: string | null; bpm: number | null; durationMs?: number | null }> {
  try {
    console.log("[LAST.FM] Buscando:", artista, "-", musica);
    const trackQuery  = encodeURIComponent(musica);
    const artistQuery = encodeURIComponent(artista);
    const trackUrl    = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${LASTFM_API_KEY}&artist=${artistQuery}&track=${trackQuery}&format=json`;
    const trackRes  = await fetch(trackUrl);
    const trackData = await trackRes.json();
    if (trackData.error) {
      console.log("[LAST.FM] ❌ Track não encontrada");
      return { genero: null, bpm: null, durationMs: null };
    }
    let genero: string | null = null;
    const tags = trackData.track?.toptags?.tag || [];
    const durationMs =
      trackData.track?.duration && Number(trackData.track.duration) > 0
        ? Number(trackData.track.duration)
        : null;
    if (tags.length > 0) {
      const genreNames = tags.slice(0, 3).map((t: any) => t.name);
      genero = mapearGenero(genreNames);
      console.log(`[LAST.FM] ✅ Gênero (tags): ${genero} (${genreNames.join(", ")})`);
    }
    if (!genero) {
      console.log("[LAST.FM] Buscando tags do artista...");
      const artistUrl  = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&api_key=${LASTFM_API_KEY}&artist=${artistQuery}&format=json`;
      const artistRes  = await fetch(artistUrl);
      const artistData = await artistRes.json();
      const artistTags = artistData.artist?.tags?.tag || [];
      if (artistTags.length > 0) {
        const artistGenres = artistTags.slice(0, 3).map((t: any) => t.name);
        genero = mapearGenero(artistGenres);
        console.log(`[LAST.FM] ✅ Gênero (artista): ${genero} (${artistGenres.join(", ")})`);
      }
    }
    return { genero, bpm: null, durationMs };
  } catch (e) {
    console.error("[LAST.FM] Exception:", e.message);
    return { genero: null, bpm: null, durationMs: null };
  }
}

// ===== ATUALIZADA: agora também retorna Key/Scale do AcousticBrainz, sem nenhuma chamada extra =====
async function buscarBPMEKeyMusicBrainz(artista: string, musica: string): Promise<{ bpm: number | null; key: string | null; scale: string | null }> {
  try {
    console.log("[MUSICBRAINZ] Buscando BPM/Key:", artista, "-", musica);
    const query = encodeURIComponent(`${musica} ${artista}`);
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=5`,
      { headers: { "User-Agent": "IAnoRadio/1.0 (contatomultihits@gmail.com)" } }
    );
    if (!mbRes.ok) {
      console.log("[MUSICBRAINZ] ❌ Erro na busca:", mbRes.status);
      return { bpm: null, key: null, scale: null };
    }
    const mbData     = await mbRes.json();
    const recordings = mbData.recordings || [];
    const match = recordings.find((r: any) =>
      normalizarTexto(r.title).includes(normalizarTexto(musica).split(" ")[0] || "")
    ) || recordings[0];
    const recordingId = match?.id;
    if (!recordingId) {
      console.log("[MUSICBRAINZ] ❌ Recording não encontrado");
      return { bpm: null, key: null, scale: null };
    }
    console.log(`[MUSICBRAINZ] ✅ Recording ID: ${recordingId}`);
    const abRes = await fetch(`https://acousticbrainz.org/api/v1/${recordingId}/low-level`);
    if (!abRes.ok) {
      console.log("[ACOUSTICBRAINZ] ❌ Dados não disponíveis");
      return { bpm: null, key: null, scale: null };
    }
    const abData   = await abRes.json();
    const bpmValue = abData.rhythm?.bpm;
    const bpm      = bpmValue && bpmValue > 0 ? Math.round(bpmValue) : null;
    if (bpm) console.log(`[MUSICBRAINZ] ✅ BPM: ${bpm}`);
    else console.log("[ACOUSTICBRAINZ] ⚠️ BPM não encontrado");

    const key   = abData.tonal?.key_key   ?? null;
    const scale = abData.tonal?.key_scale ?? null;
    if (key && scale) {
      console.log(`[ACOUSTICBRAINZ] ✅ Tom: ${key} ${scale}`);
    } else {
      console.log("[ACOUSTICBRAINZ] ⚠️ Tom/Escala não encontrados");
    }

    return { bpm, key, scale };
  } catch (e) {
    console.error("[MUSICBRAINZ] Exception:", e.message);
    return { bpm: null, key: null, scale: null };
  }
}

async function buscarInfoExtra(artista: string, musica: string): Promise<InfoExtra> {
  console.log(`\n[INFO EXTRA] 🎵 ${artista} - ${musica}`);
  console.log("[INFO EXTRA] Antes do Deezer:", artista, musica);
  const deezer = await buscarDeezerCompleto(artista, musica);
  console.log("[INFO EXTRA] Depois do Deezer:", artista, musica);
  let genero   = deezer.genero;
  let bpm      = deezer.bpm;
  const itunes = await buscarItunesMeta(artista, musica);
  const ano_lancamento = itunes.ano ?? deezer.ano;
  let lastfmDuration: number | null = null;
  if (!genero || !bpm) {
    console.log("[INFO EXTRA] Tentando Last.fm...");
    const lastfm = await buscarLastFM(artista, musica);
    if (!genero) genero = lastfm.genero;
    lastfmDuration = lastfm.durationMs ?? null;
  }

  let tomMusical: string | null = null;
  let camelot: string | null    = null;

  if (!bpm) {
    console.log("[INFO EXTRA] Tentando BPM/Tom no MusicBrainz + AcousticBrainz...");
    const mb = await buscarBPMEKeyMusicBrainz(artista, musica);
    bpm = mb.bpm;
    const camelotInfo = mapearCamelot(mb.key, mb.scale);
    tomMusical = camelotInfo.tomMusical;
    camelot    = camelotInfo.camelot;
  }

  // v104: sem BPM real (Deezer/AcousticBrainz), a música fica sem BPM.
  // A estimativa pela duração (estimarBpmPorDuracao) não é mais usada.
  const capa = itunes.capa ?? deezer.capa ?? null;

  // Nome "bonito": só usamos o nome canônico do Deezer/iTunes quando o match
  // foi forte (artista E música bateram de verdade, não é só o primeiro
  // resultado da busca). Prioriza Deezer, cai pro iTunes se só ele tiver match forte.
  let artistaCanonico: string | null = null;
  let musicaCanonica: string | null = null;
  if (deezer.matchForte) {
    artistaCanonico = deezer.artistaCanonico;
    musicaCanonica  = deezer.musicaCanonica;
  } else if (itunes.matchForte) {
    artistaCanonico = itunes.artistaCanonico;
    musicaCanonica  = itunes.musicaCanonica;
  }
  if (artistaCanonico || musicaCanonica) {
    console.log(`[INFO EXTRA] ✅ Nome canônico encontrado: ${artistaCanonico || artista} - ${musicaCanonica || musica}`);
  }

  console.log(`[INFO EXTRA] ✅ Gênero: ${genero || "Variados"} | BPM: ${bpm || "N/A"} | Tom: ${tomMusical || "N/A"} | Camelot: ${camelot || "N/A"} | Capa: ${itunes.capa ? "iTunes" : deezer.capa ? "Deezer" : "N/A"} | Ano: ${ano_lancamento || "N/A"}\n`);
  return {
    genero: genero || "Variados",
    capa,
    bpm,
    ano_lancamento: ano_lancamento ?? null,
    artistaCanonico,
    musicaCanonica,
    tomMusical,
    camelot
  };
}

function buildRequestInit(radio: RadioConfig): RequestInit {
  if (radio.id === "educadora") {
    return {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA_NAVEGADOR
      }
    };
  }
  if (radio.id === "metro") {
    return {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA_NAVEGADOR,
        "Referer": "https://m985.com.br/",
        "Origin": "https://m985.com.br"
      }
    };
  }
  if (radio.id === "inweb_energia") {
    return {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.97fm.com.br/",
        "Origin": "https://www.97fm.com.br"
      }
    };
  }
  return {
    method: "GET",
    headers: {
      "Accept": radio.tipo === "xml"
        ? "application/xml, text/xml, */*"
        : "application/json, text/plain, */*",
      "User-Agent": UA_NAVEGADOR
    }
  };
}

async function lerXmlComEncoding(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const sniff         = new TextDecoder("utf-8").decode(buffer.slice(0, 200));
  const encodingMatch = sniff.match(/encoding=["']([^"']+)["']/i);
  const encoding      = encodingMatch?.[1]?.toUpperCase() || "UTF-8";
  console.log(`[XML] Encoding detectado: ${encoding}`);
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}


async function buscarGazetaSocketIO(): Promise<{ artista?: string; musica?: string }> {
  return new Promise((resolve) => {
    let resolvido = false;
    console.log("[GAZETA] Conectando via Socket.IO: https://app02.gazetafm.com.br/");
    const socket = ioClient("https://app02.gazetafm.com.br", {
      reconnection: false,
      timeout: 8000,
      query: {
        "imagensMusicas[atual][demonstracao][width]": "150",
        "imagensMusicas[atual][demonstracao][height]": "150",
        "imagensMusicas[seguinte][demonstracaoMenor][width]": "100",
        "imagensMusicas[seguinte][demonstracaoMenor][height]": "100"
      }
    });
    const finalizar = (resultado: { artista?: string; musica?: string }) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timeoutId);
      try { socket.close(); } catch (_) {}
      resolve(resultado);
    };
    const timeoutId = setTimeout(() => {
      console.log("[GAZETA] ⏱️ Timeout aguardando evento 'atualizacao-musicas'");
      finalizar({});
    }, 8000);
    socket.on("connect_error", (err: any) => {
      console.error("[GAZETA] Socket.IO connect_error:", err?.message || err);
    });
    socket.on("error", (err: any) => {
      console.error("[GAZETA] Socket.IO error:", err?.message || err);
    });
    socket.on("connect", () => {
      console.log("[GAZETA] ✅ Conectado, aguardando evento...");
    });
    socket.on("atualizacao-musicas", (message: any) => {
      const atual   = message?.atual;
      const artistaRaw = atual?.interprete || "";
      const musicaRaw  = atual?.musica || "";

      const artista = limparTexto(corrigirCodificacao(artistaRaw));
      const musica  = limparTexto(corrigirCodificacao(musicaRaw));

      console.log(`[GAZETA] ✅ Evento recebido (Corrigido): ${artista} - ${musica}`);
      finalizar({ artista, musica });
    });
  });
}

async function buscarIcyMetadata(streamUrl: string): Promise<{ artista?: string; musica?: string }> {
  try {
    console.log("[ICY] Conectando:", streamUrl);
    const res = await fetch(streamUrl, {
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": UA_NAVEGADOR
      }
    });
    if (!res.ok || !res.body) {
      console.error("[ICY] Falha na conexão com o stream:", res.status);
      return {};
    }
    const metaintHeader = res.headers.get("icy-metaint");
    if (!metaintHeader) {
      console.error("[ICY] Servidor não retornou icy-metaint");
      res.body.cancel();
      return {};
    }
    const metaint = parseInt(metaintHeader, 10);
    const reader = res.body.getReader();
    let bytesLidos = 0;
    let buffer = new Uint8Array(0);
    function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    }
    while (bytesLidos < metaint) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const restante = metaint - bytesLidos;
      if (value.length <= restante) {
        bytesLidos += value.length;
      } else {
        buffer = value.slice(restante);
        bytesLidos = metaint;
        break;
      }
    }
    while (buffer.length < 1) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      buffer = concat(buffer, value);
    }
    if (buffer.length < 1) {
      reader.cancel();
      console.error("[ICY] Stream encerrou antes de entregar o tamanho do metadata");
      return {};
    }
    const metaLength = buffer[0] * 16;
    buffer = buffer.slice(1);
    while (buffer.length < metaLength) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      buffer = concat(buffer, value);
    }
    reader.cancel();
    const metaBlock = new TextDecoder("utf-8").decode(buffer.slice(0, metaLength));
    console.log("[ICY] Bloco bruto:", metaBlock);
    const match = metaBlock.match(/StreamTitle='([^']*)'/);
    const titulo = match?.[1];
    if (!titulo) {
      console.log("[ICY] StreamTitle não encontrado no bloco");
      return {};
    }
    const partes = titulo.split(" - ");
    const artista = limparTexto(partes[0]);
    const musica  = limparTexto(partes.slice(1).join(" - "));
    console.log(`[ICY] ✅ ${artista} - ${musica}`);
    return { artista, musica };
  } catch (e) {
    console.error("[ICY] Exception:", e.message);
    return {};
  }
}

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const radios: RadioConfig[] = [
      { nome: "Metropolitana FM", url: "https://m985.com.br/api/last/aovivo",                                  id: "metro",         tipo: "json", timestampTipo: "local_brasilia" },
      { nome: "Antena 1",         url: "https://www.antena1.com.br/api/v1/aovivo/getCurrentSongInfo/antena_1", id: "antena",        tipo: "json", timestampTipo: "utc"            },
      { nome: "EDUCADORA FM",     url: "https://www.educadorafm.com.br/api/player.php?action=now-playing",   id: "educadora",     tipo: "json", timestampTipo: "local_brasilia" },
      { nome: "Forbes Radio",     url: "https://fmmusical.com.br/app/xml/Pulsar/PULSAR.XML",                   id: "forbes",        tipo: "xml",  timestampTipo: "local_brasilia" },
      { nome: "MIX Rio FM",       url: "https://mixriofm.com.br/pulsar.xml",                                   id: "mix",           tipo: "xml",  timestampTipo: "local_brasilia" },
      { nome: "Dumont FM",        url: "https://8402.brasilstream.com.br/stream?origem=cadenaandroid",         id: "dumont",        tipo: "icy",  timestampTipo: "utc"            },
      { nome: "Gazeta FM",        url: "",                                                                     id: "gazeta",        tipo: "icy",  timestampTipo: "utc"            },
      { nome: "Alpha FM São Paulo", url: "https://ice.fabricahost.com.br/alphafmsp",                                 id: "alpha_sp",      tipo: "icy",  timestampTipo: "utc"            }
      // Kiss FM removida em 04/10/2026: não publica o nome das músicas desde 14/09/2026.
    ];

    // Rádios em espera após bloqueio (403/429). Falha ao ler não impede a coleta.
    const bloqueios = new Map<string, { bloqueado_ate: string; falhas: number }>();
    try {
      const { data: linhasBloqueio } = await supabase
        .from("coleta_bloqueios")
        .select("radio_id, bloqueado_ate, falhas");
      for (const b of linhasBloqueio ?? []) bloqueios.set(b.radio_id, b);
    } catch (e) {
      console.error("[RECUO] Falha ao ler coleta_bloqueios:", e?.message || e);
    }

    const resultados = await Promise.all(radios.map(async (radio) => {
      try {
        console.log(`\n${"=".repeat(50)}\n📻 ${radio.nome}\n${"=".repeat(50)}`);

        let artista:      string | undefined;
        let musica:       string | undefined;
        let timestampApi: string | undefined;

        if (radio.tipo === "icy") {
          const icyData = radio.id === "gazeta"
            ? await buscarGazetaSocketIO()
            : await buscarIcyMetadata(radio.url);
          artista = icyData.artista;
          musica  = icyData.musica;

          // Validação extra para rádios via Socket.IO
          if ((radio.id === "gazeta") && (!artista || !musica || isSystemMessage(artista, musica))) {
            console.log(`⏭️ ${radio.nome}: Dados vazios ou mensagem de sistema, pulando...`);
            return `${radio.nome}: Dados vazios/mensagem de sistema`;
          }

          // Validação extra para Alpha FM SP — ICY retorna título bruto que pode conter mensagens de sistema
          if ((radio.id === "alpha_sp") && (!artista || !musica || isSystemMessage(artista, musica))) {
            console.log(`⏭️ ${radio.nome}: Dados vazios ou mensagem de sistema, pulando...`);
            return `${radio.nome}: Dados vazios/mensagem de sistema`;
          }
        } else {
          const bloqueio = bloqueios.get(radio.id);
          if (bloqueio && new Date(bloqueio.bloqueado_ate).getTime() > Date.now()) {
            console.log(`⏸️ ${radio.nome}: em espera após bloqueio até ${bloqueio.bloqueado_ate}`);
            return `${radio.nome}: Em espera após bloqueio`;
          }
          const response = await fetch(radio.url, buildRequestInit(radio));
          if (response.status === 403 || response.status === 429) {
            try { await response.body?.cancel(); } catch (_) { /* ignora */ }
            const falhas = (bloqueio?.falhas ?? 0) + 1;
            const bloqueadoAte = new Date(Date.now() + RECUO_BLOQUEIO_MS).toISOString();
            console.error(`❌ HTTP ${response.status} — ${radio.nome} em espera até ${bloqueadoAte} (falha ${falhas})`);
            const { error: erroBloqueio } = await supabase.from("coleta_bloqueios").upsert({
              radio_id: radio.id, bloqueado_ate: bloqueadoAte, falhas,
              ultimo_status: response.status, atualizado_em: new Date().toISOString()
            });
            if (erroBloqueio) console.error("[RECUO] Falha ao gravar bloqueio:", erroBloqueio.message);
            return `${radio.nome}: Erro HTTP ${response.status} (em espera ${RECUO_BLOQUEIO_MS / 60000} min)`;
          }
          if (!response.ok) {
            console.error(`❌ HTTP ${response.status}`);
            return `${radio.nome}: Erro HTTP ${response.status}`;
          }
          if (bloqueio) {
            console.log(`✅ ${radio.nome}: acesso liberado de novo, saindo da espera`);
            await supabase.from("coleta_bloqueios").delete().eq("radio_id", radio.id);
          }
          if (radio.tipo === "xml") {
            const xml = await lerXmlComEncoding(response);
            artista = extrairTag(xml, "interprete");
            musica  = extrairTag(xml, "titulo");
            const horaXml = extrairTag(xml, "hora") || extrairTag(xml, "datahora") || extrairTag(xml, "horario");
            if (horaXml) {
              timestampApi = brasiliaParaUTC(horaXml);
              console.log(`[${radio.nome}] ⏰ Hora XML: ${horaXml} → UTC: ${timestampApi}`);
            }
            if (radio.id === "kiss_fm") {
              const extrairPropriedadeKiss = (nome: string): string | undefined => {
                const match = xml.match(new RegExp(`<property\\s+name=["']${nome}["'][^>]*>([\\s\\S]*?)</property>`, "i"));
                return limparTexto(match?.[1]?.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim());
              };
              artista = extrairPropriedadeKiss("track_artist_name");
              musica  = extrairPropriedadeKiss("cue_title");
              const cueTimeStart = extrairPropriedadeKiss("cue_time_start");
              if (cueTimeStart && !Number.isNaN(Number(cueTimeStart))) {
                timestampApi = parseUTCSeguro(new Date(Number(cueTimeStart)).toISOString());
                console.log(`[KISS FM] ⏰ cue_time_start: ${cueTimeStart} → UTC: ${timestampApi}`);
              }
            }
          } else {
            const json = await response.json();
            if (radio.id === "metro") {
              const nomeArtista = json.artist?.name || "";
              const nomeFeat    = json.feat?.name   || "";
              console.log(`[METRO] 🔍 Raw: artist="${json.artist?.name}" | song="${json.song?.name}" | feat="${json.feat?.name}" | lastReprodution="${json.lastReprodution}"`);
              artista = limparTexto(nomeFeat ? `${nomeArtista} feat. ${nomeFeat}` : nomeArtista);
              musica  = limparTexto(json.song?.name);
              const rawTs = json?.lastReprodution || json?.playedAt || json?.updatedAt || json?.time;
              if (rawTs) {
                timestampApi = brasiliaParaUTC(rawTs);
                console.log(`[METRO] ⏰ Timestamp local: ${rawTs} → UTC: ${timestampApi}`);
              }
            } else if (radio.id === "antena") {
              artista = limparTexto(json.data?.artist);
              musica  = limparTexto(json.data?.song);
              const timeRaw: string | undefined = json.data?.time;
              if (timeRaw) {
                timestampApi = parseUTCSeguro(timeRaw);
                console.log(`[ANTENA 1] ⏰ UTC recebido: ${timeRaw} → normalizado: ${timestampApi}`);
              }
            } else if (radio.id === "educadora") {
              artista = limparTexto(json.artist);
              musica  = limparTexto(json.title);
              const timeRaw: string | undefined = json.time;
              if (timeRaw) {
                timestampApi = educadoraHoraBrasiliaParaUTC(timeRaw);
                console.log(`[EDUCADORA FM] ⏰ Hora local: ${timeRaw} → UTC: ${timestampApi}`);
              }
            }
          }
        }

        if (!artista || !musica) {
          console.error(`❌ Dados não encontrados na API — artista="${artista}" musica="${musica}"`);
          return `${radio.nome}: Dados não encontrados`;
        }

        artista = limparTexto(artista);
        musica  = limparTexto(musica);

        if (!artista || !musica) {
          console.error("❌ Dados vazios após limpeza");
          return `${radio.nome}: Dados vazios após limpeza`;
        }

        if (isSystemMessage(artista, musica)) {
          console.log("⏭️ Mensagem de sistema, pulando...");
          return `${radio.nome}: Mensagem de sistema`;
        }

        console.log(`🎵 Tocando: ${artista} - ${musica}`);
        console.log(`[DEBUG] ${radio.nome} - Artista (bruto): ${artista}, Música (bruta): ${musica}`);
        console.log(`[DEBUG] ${radio.nome} - Artista (normalizado): ${normalizarTexto(artista)}, Música (normalizada): ${normalizarTexto(musica)}`);
        console.log(`[DEBUG] ${radio.nome} - tocouEm (gerado): ${timestampApi || getTimestampUTC()}`);

        // =============================================================
        // PRÉ-CHECAGEM DE REPETIÇÃO (v103)
        //
        // A coleta roda a cada minuto e a mesma música costuma aparecer
        // 3-4 vezes seguidas. Antes de buscar capa/gênero/BPM nos serviços
        // externos, verifica se essa execução já está gravada. Usa as
        // mesmas regras da deduplicação lá embaixo (que continua valendo):
        //   a) mesmo horário de início vindo da rádio → já existe (UNIQUE radio+tocou_em);
        //   b) mesma música da última tocada da rádio há menos de 10 min.
        // =============================================================
        {
          const tocouEmPrevio = timestampApi || getTimestampUTC();
          const tocouEmPrevioMs = new Date(tocouEmPrevio).getTime();

          // (a) Só quando o horário não está no futuro, para não interferir na
          // correção de horário da Educadora feita pelo banco.
          if (timestampApi && tocouEmPrevioMs <= Date.now() + 5 * 60 * 1000) {
            const { data: mesmoHorario } = await supabase
              .from("radio_airplay")
              .select("id")
              .eq("radio", radio.nome.toUpperCase())
              .eq("tocou_em", tocouEmPrevio.replace("Z", ""))
              .limit(1)
              .maybeSingle();
            if (mesmoHorario) {
              console.log(`⏭️ ${radio.nome}: execução já gravada (mesmo horário), sem buscar metadados`);
              return `${radio.nome}: Registro já existente`;
            }
          }

          // (b)
          const { data: ultima } = await supabase
            .from("radio_airplay")
            .select("artista, musica, tocou_em")
            .ilike("radio", radio.nome)
            .order("tocou_em", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (
            ultima &&
            normalizarTexto(ultima.artista) === normalizarTexto(artista) &&
            normalizarTexto(ultima.musica) === normalizarTexto(musica) &&
            (tocouEmPrevioMs - new Date(ultima.tocou_em).getTime()) < 10 * 60 * 1000
          ) {
            console.log(`⏭️ ${radio.nome}: mesma música da última tocada, sem buscar metadados`);
            return `${radio.nome}: Duplicata (mesma tocada)`;
          }
        }

        let info: InfoExtra;

        // Reaproveita metadados do histórico. v103: busca em MAIÚSCULAS (como o
        // banco grava) e não exige mais Tom/Camelot (só ~13% das músicas têm).
        // v104: não reaproveita BPM com valor da antiga estimativa (pode ser
        // inventado); aceita registro sem BPM. Prefere registro com BPM e com Tom.
        const { data: candidatosHistorico } = await supabase
          .from("radio_airplay")
          .select("capa, genero, bpm, ano_lancamento, tom_musical, camelot")
          .eq("artista", artista.toUpperCase())
          .eq("musica", musica.toUpperCase())
          .not("capa", "is", null)
          .not("genero", "is", null)
          .not("ano_lancamento", "is", null)
          .order("created_at", { ascending: false })
          .limit(20);
        const historico = (candidatosHistorico ?? [])
          .filter((h) => h.bpm == null || !BPM_ESTIMATIVA_ANTIGA.has(Number(h.bpm)))
          .sort((a, b) =>
            Number(b.bpm != null) - Number(a.bpm != null) ||
            Number(b.camelot != null) - Number(a.camelot != null)
          )[0];

        if (historico) {
          console.log(`♻️ Metadados reutilizados do histórico: ${artista} - ${musica}`);
          info = {
            capa:            historico.capa,
            genero:          historico.genero,
            bpm:             historico.bpm,
            ano_lancamento:  historico.ano_lancamento ?? null,
            artistaCanonico: null,
            musicaCanonica:  null,
            tomMusical:      historico.tom_musical ?? null,
            camelot:         historico.camelot ?? null
          };
        } else {
          info = await buscarInfoExtra(artista, musica);
          // Aplica o nome "bonito" (Deezer/iTunes) quando encontrado com match forte.
          // Nota: como o histórico acima é buscado por nome EXATO, uma vez que o nome
          // vira canônico aqui, a próxima vez que essa rádio mandar o nome bruto (bagunçado)
          // de novo, o histórico não vai bater e o sistema busca de novo — mais chamada de
          // API, mas nome sempre correto. Rádios que já mandam nome limpo não sofrem esse custo.
          if (info.artistaCanonico) artista = limparTexto(info.artistaCanonico);
          if (info.musicaCanonica)  musica  = limparTexto(info.musicaCanonica);
        }

    const artistaNorm = normalizarTexto(artista);
const musicaNorm = normalizarTexto(musica);
const tocouEm = timestampApi || getTimestampUTC();

let mesmaTocada = false;

// =============================================================
// DEDUPLICAÇÃO EXCLUSIVA DA KISS FM
//
// A API da KISS entrega cue_time_start: o horário de início da
// execução. Portanto, uma execução só é duplicada se for a mesma
// música, do mesmo artista, praticamente no mesmo horário.
//
// Isso evita descartar uma faixa válida apenas porque ela é igual
// à última música gravada, especialmente quando a API responde
// com algum atraso.
// =============================================================
if (radio.id === "kiss_fm" && timestampApi) {
  const tocouEmMs = new Date(tocouEm).getTime();

  if (Number.isNaN(tocouEmMs)) {
    console.warn(
      `[KISS FM] ⚠️ Horário inválido para deduplicação: ${tocouEm}. ` +
      "Aplicando a regra padrão de deduplicação."
    );
  } else {
    const toleranciaMs = 5_000;
    const inicioJanela = new Date(tocouEmMs - toleranciaMs).toISOString();
    const fimJanela = new Date(tocouEmMs + toleranciaMs).toISOString();

    const {
      data: execucoesMesmoHorario,
      error: execucoesMesmoHorarioError
    } = await supabase
      .from("radio_airplay")
      .select("artista, musica, tocou_em")
      .eq("radio", radio.nome)
      .gte("tocou_em", inicioJanela)
      .lte("tocou_em", fimJanela);

    if (execucoesMesmoHorarioError) {
      throw execucoesMesmoHorarioError;
    }

    mesmaTocada = (execucoesMesmoHorario || []).some((execucao) =>
      normalizarTexto(execucao.artista) === artistaNorm &&
      normalizarTexto(execucao.musica) === musicaNorm
    );

    if (mesmaTocada) {
      console.log(
        `[KISS FM] ⏭️ Execução já registrada, pulando. ` +
        `Faixa: ${artista} - ${musica} | ` +
        `cue_time_start: ${tocouEm}`
      );
    }
  }
}

// =============================================================
// DEDUPLICAÇÃO ORIGINAL DAS DEMAIS RÁDIOS
//
// Mantida propositalmente como estava para não alterar o
// comportamento de Metropolitana, Antena 1, Forbes, MIX Rio,
// Dumont, Gazeta e Alpha FM.
// =============================================================
if (radio.id !== "kiss_fm" || !timestampApi) {
  const { data: ultimaTocada, error: ultimaTocadaError } = await supabase
    .from("radio_airplay")
    .select("artista, musica, tocou_em")
    .ilike("radio", radio.nome)
    .order("tocou_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultimaTocadaError) {
    throw ultimaTocadaError;
  }

  mesmaTocada = Boolean(
    ultimaTocada &&
    normalizarTexto(ultimaTocada.artista) === artistaNorm &&
    normalizarTexto(ultimaTocada.musica) === musicaNorm &&
    (
      new Date(tocouEm).getTime() -
      new Date(ultimaTocada.tocou_em).getTime()
    ) < 10 * 60 * 1000
  );

  if (mesmaTocada) {
    console.log(
      `⏭️ ${radio.nome}: mesma música da última tocada registrada, pulando...`
    );
  }
}

if (mesmaTocada) {
  return `${radio.nome}: Duplicata (mesma tocada)`;
}

        const registroAirplay = {
  radio: radio.nome,
  artista,
  musica,
  tocou_em: tocouEm,
  capa: info.capa,
  genero: info.genero,
  bpm: info.bpm,
  ano_lancamento: info.ano_lancamento,
  tom_musical: info.tomMusical,
  camelot: info.camelot,
  cidade: "São Paulo"
};

// Com a constraint UNIQUE (radio, tocou_em), a mesma execução
// não gera erro caso a função seja chamada mais de uma vez.
const { data: registroSalvo, error: insertError } = await supabase
  .from("radio_airplay")
  .upsert(registroAirplay, {
    onConflict: "radio,tocou_em",
    ignoreDuplicates: true
  })
  .select("id")
  .maybeSingle();

if (insertError) {
  throw insertError;
}

const bpmText = info.bpm ? ` - ${info.bpm} BPM` : " - SEM BPM";
const camelotText = info.camelot
  ? ` - ${info.camelot} (${info.tomMusical})`
  : "";

if (registroSalvo) {
  console.log(
    `✅ Inserido: ${radio.nome} | ${artista} - ${musica}` +
    `${bpmText}${camelotText}`
  );

  return `${radio.nome}: Sucesso (${info.genero}${bpmText}${camelotText})`;
}

console.log(
  `⏭️ Registro já existente: ${radio.nome} | ` +
  `${artista} - ${musica} | ${tocouEm}`
);

return `${radio.nome}: Registro já existente`;

      } catch (e) {
        console.error(`❌ Erro em ${radio.nome}: ${e.message}`);
        return `${radio.nome}: Erro - ${e.message}`;
      }
    }));

    return new Response(JSON.stringify(resultados.filter(Boolean)), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("❌ ERRO GERAL:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
