import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// TOP 10 analítico (aprovado em 05/10/2026; a versão anterior está em backup-v17.ts).
// Semana (7 dias) comparada com a anterior, movimento de posição, TOP 10 do mercado,
// quem tocou primeiro nos lançamentos, cobertura de dados por rádio e resumo.
// Com `test_email` no corpo, envia só para ele.

const RECIPIENTS = [
  "jany.lima@radiod.com.br",
  "Francielly.Garcia@radiod.com.br",
  "Simone.Evangelista@radiod.com.br",
  "joao.guilherme@radiod.com.br",
];

const LINK_MONITORAMENTO = "https://monitoramento.ianoradio.com/";
// Kiss FM: sem nomes de música desde 14/09/2026. Gazeta FM: nomes em branco desde 30/09/2026.
const RADIOS_EXCLUIDAS = ["KISS FM", "GAZETA FM"];
const PAGINA = 1000; // a API devolve no máximo 1000 linhas por consulta
const DIA_MS = 24 * 60 * 60 * 1000;
const COBERTURA_ALERTA = 80; // % das horas com dados abaixo do qual a rádio ganha aviso
const MAX_LANCAMENTOS = 5;

type Linha = { radio: string; artista: string; musica: string; tocou_em: string };
type Contagem = { artista: string; musica: string; atual: number; anterior: number };

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dataBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

function nomeRadio(r: string): string {
  return r.split(" ").map((p) => (p.length <= 2 && p !== "SÃO" ? p : p.charAt(0) + p.slice(1).toLowerCase())).join(" ")
    .replace(/\bFm\b/g, "FM");
}

// Ranking com empates: músicas com o mesmo número de execuções dividem a posição.
function posicoes<T>(itens: T[], valor: (x: T) => number): Map<T, number> {
  const ordenados = [...itens].filter((x) => valor(x) > 0).sort((a, b) => valor(b) - valor(a));
  const pos = new Map<T, number>();
  ordenados.forEach((x, i) => {
    pos.set(x, i > 0 && valor(ordenados[i - 1]) === valor(x) ? pos.get(ordenados[i - 1])! : i + 1);
  });
  return pos;
}

function movimento(posAtual: number, posAnterior: number | undefined): { texto: string; cor: string } {
  if (posAnterior === undefined) return { texto: "NOVA", cor: "#2563EB" };
  const d = posAnterior - posAtual;
  if (d > 0) return { texto: `▲${d}`, cor: "#16A34A" };
  if (d < 0) return { texto: `▼${-d}`, cor: "#DC2626" };
  return { texto: "=", cor: "#6B7280" };
}

async function buscarPeriodo(supabase: any, inicio: Date, fim: Date): Promise<Linha[]> {
  const { count, error: erroCount } = await supabase
    .from("radio_airplay")
    .select("id", { count: "exact", head: true })
    .gte("tocou_em", inicio.toISOString())
    .lt("tocou_em", fim.toISOString());
  if (erroCount) throw erroCount;
  const paginas = Math.ceil((count ?? 0) / PAGINA);
  const linhas: Linha[] = [];
  for (let lote = 0; lote < paginas; lote += 6) {
    const resultados = await Promise.all(
      Array.from({ length: Math.min(6, paginas - lote) }, (_, k) => {
        const de = (lote + k) * PAGINA;
        return supabase
          .from("radio_airplay")
          .select("radio, artista, musica, tocou_em")
          .gte("tocou_em", inicio.toISOString())
          .lt("tocou_em", fim.toISOString())
          .order("id", { ascending: true })
          .range(de, de + PAGINA - 1);
      }),
    );
    for (const { data, error } of resultados) {
      if (error) throw error;
      linhas.push(...(data ?? []));
    }
  }
  return linhas.filter((l) => !RADIOS_EXCLUIDAS.includes(String(l.radio ?? "").trim().toUpperCase()));
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: cronSecret }, { data: resendApiKey }] = await Promise.all([
      supabase.rpc("get_app_secret", { secret_name: "cron_shared_secret" }),
      supabase.rpc("get_app_secret", { secret_name: "resend_api_key" }),
    ]);
    if (!cronSecret || req.headers.get("x-relatorio-secret") !== cronSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!resendApiKey) return Response.json({ error: "missing resend api key" }, { status: 500 });

    let testEmail: string | null = null;
    try {
      const body = await req.json();
      if (typeof body?.test_email === "string" && body.test_email.includes("@")) testEmail = body.test_email;
    } catch (_e) { /* sem body */ }
    const destinatarios = testEmail ? [testEmail] : RECIPIENTS;

    // Janelas: 7 dias completos até hoje 00h (Brasília) e os 7 dias anteriores.
    const agora = new Date();
    const hoje0 = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3, 0, 0));
    if (hoje0 > agora) hoje0.setTime(hoje0.getTime() - DIA_MS);
    const ini7 = new Date(hoje0.getTime() - 7 * DIA_MS);
    const ini14 = new Date(hoje0.getTime() - 14 * DIA_MS);

    const linhas = await buscarPeriodo(supabase, ini14, hoje0);
    const atuais = linhas.filter((l) => new Date(l.tocou_em + "Z") >= ini7);

    // ---- Contagens por rádio e cobertura (horas com dados) ----
    const porRadio = new Map<string, Map<string, Contagem>>();
    const horasPorRadio = new Map<string, Set<string>>();
    for (const l of linhas) {
      const atual = new Date(l.tocou_em + "Z") >= ini7;
      if (!porRadio.has(l.radio)) porRadio.set(l.radio, new Map());
      const mapa = porRadio.get(l.radio)!;
      const k = `${l.artista}|||${l.musica}`;
      if (!mapa.has(k)) mapa.set(k, { artista: l.artista, musica: l.musica, atual: 0, anterior: 0 });
      const c = mapa.get(k)!;
      if (atual) {
        c.atual++;
        if (!horasPorRadio.has(l.radio)) horasPorRadio.set(l.radio, new Set());
        horasPorRadio.get(l.radio)!.add(l.tocou_em.slice(0, 13));
      } else c.anterior++;
    }
    const radios = [...porRadio.keys()].filter((r) => [...porRadio.get(r)!.values()].some((c) => c.atual > 0)).sort();
    const cobertura = new Map(radios.map((r) => [r, Math.round(((horasPorRadio.get(r)?.size ?? 0) * 100) / 168)]));

    // ---- Mercado: soma de todas as rádios ----
    const mercado = new Map<string, Contagem & { radios: Set<string>; radiosAntes: Set<string> }>();
    for (const r of radios) {
      for (const [k, c] of porRadio.get(r)!) {
        if (!mercado.has(k)) mercado.set(k, { artista: c.artista, musica: c.musica, atual: 0, anterior: 0, radios: new Set(), radiosAntes: new Set() });
        const m = mercado.get(k)!;
        m.atual += c.atual;
        m.anterior += c.anterior;
        if (c.atual > 0) m.radios.add(r);
        if (c.anterior > 0) m.radiosAntes.add(r);
      }
    }
    const mercadoLista = [...mercado.values()];
    const valorMercado = (m: (typeof mercadoLista)[number]) => m.radios.size * 100000 + m.atual;
    const valorMercadoAntes = (m: (typeof mercadoLista)[number]) => m.radiosAntes.size * 100000 + m.anterior;
    const posMercado = posicoes(mercadoLista, valorMercado);
    const posMercadoAntes = posicoes(mercadoLista, valorMercadoAntes);
    const topMercado = mercadoLista.filter((m) => posMercado.has(m)).sort((a, b) => posMercado.get(a)! - posMercado.get(b)!).slice(0, 10);

    // ---- Quem tocou primeiro (só lançamentos: 1ª execução depois de 14 dias de monitoramento) ----
    const { data: primeiraLinha } = await supabase.from("radio_airplay").select("tocou_em").order("tocou_em", { ascending: true }).limit(1).maybeSingle();
    const inicioMonitoramento = primeiraLinha ? new Date(primeiraLinha.tocou_em + "Z") : ini14;
    const corteLancamento = new Date(inicioMonitoramento.getTime() + 14 * DIA_MS);
    const candidatos = mercadoLista.filter((m) => m.radios.size >= 2).sort((a, b) => b.radios.size - a.radios.size || b.atual - a.atual).slice(0, 40);
    const lancamentos: { artista: string; musica: string; ordem: { radio: string; em: Date }[] }[] = [];
    for (let i = 0; i < candidatos.length; i += 8) {
      const res = await Promise.all(candidatos.slice(i, i + 8).map((m) =>
        supabase.from("radio_airplay").select("radio, tocou_em").eq("artista", m.artista).eq("musica", m.musica)
          .order("tocou_em", { ascending: true }).limit(PAGINA)
      ));
      res.forEach(({ data }, j) => {
        const m = candidatos[i + j];
        const primeira = new Map<string, Date>();
        for (const l of data ?? []) {
          if (RADIOS_EXCLUIDAS.includes(String(l.radio).toUpperCase())) continue;
          if (!primeira.has(l.radio)) primeira.set(l.radio, new Date(l.tocou_em + "Z"));
        }
        const ordem = [...primeira.entries()].map(([radio, em]) => ({ radio, em })).sort((a, b) => a.em.getTime() - b.em.getTime());
        if (ordem.length >= 2 && ordem[0].em >= corteLancamento) lancamentos.push({ artista: m.artista, musica: m.musica, ordem });
      });
    }
    lancamentos.sort((a, b) => b.ordem.length - a.ordem.length || b.ordem[0].em.getTime() - a.ordem[0].em.getTime());
    const topLancamentos = lancamentos.slice(0, MAX_LANCAMENTOS);

    // ---- Resumo (3 linhas) ----
    const resumo: string[] = [];
    const lider = topMercado[0];
    if (lider) resumo.push(`<b>Mais tocada do mercado:</b> ${esc(lider.artista)} – ${esc(lider.musica)}, em ${lider.radios.size} de ${radios.length} rádios (${lider.atual} execuções na semana).`);
    const subidas: { radio: string; c: Contagem }[] = [];
    for (const r of radios) for (const c of porRadio.get(r)!.values()) if (c.atual >= 5) subidas.push({ radio: r, c });
    const maiorAlta = subidas.sort((a, b) => (b.c.atual - b.c.anterior) - (a.c.atual - a.c.anterior))[0];
    if (maiorAlta && maiorAlta.c.atual > maiorAlta.c.anterior) {
      resumo.push(`<b>Maior alta:</b> ${esc(maiorAlta.c.artista)} – ${esc(maiorAlta.c.musica)} na ${esc(nomeRadio(maiorAlta.radio))}, de ${maiorAlta.c.anterior} para ${maiorAlta.c.atual} execuções.`);
    }
    if (topLancamentos[0]) {
      const l = topLancamentos[0];
      resumo.push(`<b>Lançamento se espalhando:</b> ${esc(l.artista)} – ${esc(l.musica)}, já em ${l.ordem.length} rádios; a primeira foi a ${esc(nomeRadio(l.ordem[0].radio))}, em ${dataBR(l.ordem[0].em)}.`);
    } else {
      const maiorQueda = subidas.sort((a, b) => (a.c.atual - a.c.anterior) - (b.c.atual - b.c.anterior))[0];
      if (maiorQueda && maiorQueda.c.atual < maiorQueda.c.anterior) {
        resumo.push(`<b>Maior queda:</b> ${esc(maiorQueda.c.artista)} – ${esc(maiorQueda.c.musica)} na ${esc(nomeRadio(maiorQueda.radio))}, de ${maiorQueda.c.anterior} para ${maiorQueda.c.atual} execuções.`);
      }
    }

    // ---- HTML ----
    const F = "Arial, sans-serif";
    const th = (t: string, alinhar = "left") => `<th style="text-align:${alinhar};padding:8px 6px;font-size:12px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #E5E7EB;">${t}</th>`;
    const td = (t: string, extra = "") => `<td style="padding:9px 6px;border-bottom:1px solid #F0F0F0;font-size:15px;color:#1a1a1a;${extra}">${t}</td>`;
    const periodo = `${dataBR(ini7)} a ${dataBR(new Date(hoje0.getTime() - 1))}`;
    const periodoAntes = `${dataBR(ini14)} a ${dataBR(new Date(ini7.getTime() - 1))}`;

    const linhasMercado = topMercado.map((m) => {
      const mv = movimento(posMercado.get(m)!, posMercadoAntes.get(m));
      return `<tr>${td(`<b>${posMercado.get(m)}</b>`, "width:28px;")}${td(`<b>${esc(m.artista)}</b><br><span style="color:#555;">${esc(m.musica)}</span>`)}${td(`${m.radios.size}/${radios.length}`, "text-align:center;")}${td(String(m.atual), "text-align:center;")}${td(`<b style="color:${mv.cor};">${mv.texto}</b>`, "text-align:center;")}</tr>`;
    }).join("");

    const blocoLancamentos = topLancamentos.length
      ? topLancamentos.map((l) => `<div style="padding:10px 0;border-bottom:1px solid #F0F0F0;font-family:${F};"><div style="font-size:15px;color:#1a1a1a;"><b>${esc(l.artista)}</b> – ${esc(l.musica)}</div><div style="font-size:13px;color:#555;margin-top:4px;line-height:1.6;">${l.ordem.map((o, i) => `${i === 0 ? "🥇 " : ""}${esc(nomeRadio(o.radio))} <span style="color:#999;">${dataBR(o.em)}</span>`).join(" → ")}</div></div>`).join("")
      : `<p style="color:#777;font-family:${F};font-size:14px;">Nenhum lançamento novo tocando em 2 ou mais rádios no período.</p>`;

    let blocosRadios = "";
    for (const r of radios) {
      const lista = [...porRadio.get(r)!.values()];
      const pos = posicoes(lista, (c) => c.atual);
      const posAntes = posicoes(lista, (c) => c.anterior);
      const top = lista.filter((c) => pos.has(c) && pos.get(c)! <= 10).sort((a, b) => pos.get(a)! - pos.get(b)! || b.atual - a.atual).slice(0, 12);
      const cob = cobertura.get(r) ?? 0;
      const aviso = cob < COBERTURA_ALERTA
        ? `<div style="background:#FEF3C7;color:#92400E;padding:8px 14px;font-size:13px;font-family:${F};">⚠️ Dados em ${cob}% das horas da semana (programas gravados, rede ou falha na fonte da rádio). Compare com cautela.</div>`
        : `<div style="background:#F9FAFB;color:#6B7280;padding:6px 14px;font-size:12px;font-family:${F};">Dados em ${cob}% das horas da semana.</div>`;
      const linhasTop = top.map((c) => {
        const mv = movimento(pos.get(c)!, posAntes.get(c));
        return `<tr>${td(`<b>${pos.get(c)}</b>`, "width:28px;")}${td(`<b>${esc(c.artista)}</b><br><span style="color:#555;">${esc(c.musica)}</span>`)}${td(String(c.atual), "text-align:center;")}${td(String(c.anterior || "–"), "text-align:center;color:#999;")}${td(`<b style="color:${mv.cor};">${mv.texto}</b>`, "text-align:center;")}</tr>`;
      }).join("");
      blocosRadios += `
        <div style="margin-bottom:26px;border:1px solid #ececec;border-radius:10px;overflow:hidden;">
          <div style="background:#0D0056;padding:12px 16px;"><span style="color:#fff;font-size:17px;font-weight:700;font-family:${F};">${esc(r)}</span></div>
          ${aviso}
          <table style="width:100%;border-collapse:collapse;font-family:${F};"><thead><tr>${th("#")}${th("Música")}${th("7 dias", "center")}${th("Antes", "center")}${th("Mov.", "center")}</tr></thead><tbody>${linhasTop}</tbody></table>
        </div>`;
    }

    const html = `
      <div style="max-width:640px;margin:0 auto;font-family:${F};color:#1a1a1a;">
        ${testEmail ? `<div style="background:#FEF3C7;color:#92400E;padding:10px 16px;border-radius:8px;font-size:14px;margin:16px 0;">ENVIO DE TESTE &mdash; só para ${esc(testEmail)}</div>` : `<div style="height:16px;"></div>`}
        <p style="font-size:16px;margin:0 0 4px 0;">Bom dia, você está recebendo o <b>TOP 10</b> das rádios monitoradas pelo sistema <b>IA NO RÁDIO</b>.</p>
        <p style="font-size:16px;margin:0 0 4px 0;"><b>Semana: ${periodo}</b> <span style="color:#777;">(comparada com ${periodoAntes})</span></p>
        <p style="font-size:14px;color:#666;margin:0 0 18px 0;">Mais detalhes em <a href="${LINK_MONITORAMENTO}" style="color:#0D0056;">${LINK_MONITORAMENTO}</a></p>

        <div style="background:#F5F7FF;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
          <p style="font-size:13px;color:#5279FF;font-weight:700;margin:0 0 8px 0;letter-spacing:.4px;">RESUMO DA SEMANA</p>
          ${resumo.map((t) => `<p style="font-size:15px;line-height:1.5;margin:0 0 6px 0;">• ${t}</p>`).join("")}
        </div>

        <h2 style="font-size:19px;margin:0 0 4px 0;">🏆 TOP 10 do mercado</h2>
        <p style="font-size:13px;color:#777;margin:0 0 8px 0;">Todas as rádios juntas: primeiro as músicas tocando em mais rádios, depois as com mais execuções.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:26px;"><thead><tr>${th("#")}${th("Música")}${th("Rádios", "center")}${th("Execuções", "center")}${th("Mov.", "center")}</tr></thead><tbody>${linhasMercado}</tbody></table>

        <h2 style="font-size:19px;margin:0 0 4px 0;">🚀 Quem tocou primeiro</h2>
        <p style="font-size:13px;color:#777;margin:0 0 6px 0;">Lançamentos que já estão em 2 ou mais rádios, na ordem em que cada rádio começou a tocar.</p>
        <div style="margin-bottom:26px;">${blocoLancamentos}</div>

        <h2 style="font-size:19px;margin:0 0 10px 0;">📻 TOP 10 por rádio</h2>
        <p style="font-size:13px;color:#777;margin:0 0 12px 0;">▲ subiu, ▼ caiu, = manteve a posição, NOVA = não tocou na semana anterior. Músicas empatadas dividem a posição.</p>
        ${blocosRadios}
        <p style="color:#aaa;font-size:13px;">Relatório automático do sistema ianoradio.</p>
      </div>`;

    const texto = `TOP 10 IA NO RÁDIO - semana ${periodo}\n\n` +
      resumo.map((t) => "- " + t.replace(/<[^>]+>/g, "")).join("\n") + "\n\nTOP 10 DO MERCADO\n" +
      topMercado.map((m) => `${posMercado.get(m)}. ${m.artista} - ${m.musica} (${m.radios.size} rádios, ${m.atual}x)`).join("\n");

    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Relatório ianoradio <relatorios@ianoradio.com>",
        to: destinatarios,
        subject: `${testEmail ? "[TESTE] " : ""}TOP 10 RÁDIOS - SEMANA ${periodo} - IA NO RÁDIO`,
        html,
        text: texto,
      }),
    });
    if (!envio.ok) return Response.json({ error: "resend failed", detail: await envio.text() }, { status: 502 });

    return Response.json({
      ok: true, para: destinatarios, linhas_lidas: linhas.length, linhas_semana: atuais.length, radios,
      cobertura: Object.fromEntries(cobertura), lancamentos: topLancamentos.length,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
