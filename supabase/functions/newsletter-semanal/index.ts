import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  esc, LINK_CANCELAR, LINK_CANCELAR_DIRETO, moldura, NOME_NEWS, REMETENTE_NEWS,
  REMETENTE_PROVISORIO, SITE, subdominioVerificado,
} from "../_shared/newsletter.ts";

// Envio semanal da newsletter "IA NO RÁDIO - Radar Rádios de São Paulo".
// Mesma conta do TOP 10 (semana x semana anterior), mas só o resumo e o TOP 10 do mercado,
// SEM nomes de rádio. Corpo: { test_email } envia só para esse e-mail (sem exigir subdomínio).
// Envio real: exige o subdomínio verificado no Resend e não repete a mesma semana.

// Kiss e Gazeta sem dados de música; Mix Rio é do Rio de Janeiro (a news é de São Paulo).
const RADIOS_EXCLUIDAS = ["KISS FM", "GAZETA FM", "MIX RIO FM"];
const PAGINA = 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const LOTE_RESEND = 100; // máximo de e-mails por chamada em lote

type Linha = { radio: string; artista: string; musica: string; tocou_em: string };
type Contagem = { artista: string; musica: string; atual: number; anterior: number };

const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function posicoes<T>(itens: T[], valor: (x: T) => number): Map<T, number> {
  const ordenados = [...itens].filter((x) => valor(x) > 0).sort((a, b) => valor(b) - valor(a));
  const pos = new Map<T, number>();
  ordenados.forEach((x, i) => pos.set(x, i > 0 && valor(ordenados[i - 1]) === valor(x) ? pos.get(ordenados[i - 1])! : i + 1));
  return pos;
}

function movimento(atual: number, anterior: number | undefined): { texto: string; cor: string } {
  if (anterior === undefined) return { texto: "NOVA", cor: "#2563EB" };
  const d = anterior - atual;
  if (d > 0) return { texto: `▲${d}`, cor: "#16A34A" };
  if (d < 0) return { texto: `▼${-d}`, cor: "#DC2626" };
  return { texto: "=", cor: "#6B7280" };
}

async function buscarPeriodo(supabase: any, inicio: Date, fim: Date): Promise<Linha[]> {
  const { count, error } = await supabase.from("radio_airplay").select("id", { count: "exact", head: true })
    .gte("tocou_em", inicio.toISOString()).lt("tocou_em", fim.toISOString());
  if (error) throw error;
  const paginas = Math.ceil((count ?? 0) / PAGINA);
  const linhas: Linha[] = [];
  for (let lote = 0; lote < paginas; lote += 6) {
    const res = await Promise.all(Array.from({ length: Math.min(6, paginas - lote) }, (_, k) => {
      const de = (lote + k) * PAGINA;
      return supabase.from("radio_airplay").select("radio, artista, musica, tocou_em")
        .gte("tocou_em", inicio.toISOString()).lt("tocou_em", fim.toISOString())
        .order("id", { ascending: true }).range(de, de + PAGINA - 1);
    }));
    for (const { data, error: e } of res) { if (e) throw e; linhas.push(...(data ?? [])); }
  }
  return linhas.filter((l) => !RADIOS_EXCLUIDAS.includes(String(l.radio ?? "").trim().toUpperCase()));
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: segredo }, { data: resendKey }] = await Promise.all([
      supabase.rpc("get_app_secret", { secret_name: "cron_shared_secret" }),
      supabase.rpc("get_app_secret", { secret_name: "resend_api_key" }),
    ]);
    if (!segredo || req.headers.get("x-relatorio-secret") !== segredo) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!resendKey) return Response.json({ error: "missing resend api key" }, { status: 500 });

    let testEmail: string | null = null;
    try {
      const b = await req.json();
      if (typeof b?.test_email === "string" && b.test_email.includes("@")) testEmail = b.test_email;
    } catch (_e) { /* sem corpo */ }

    const verificado = await subdominioVerificado(resendKey);
    if (!testEmail && !verificado) {
      return Response.json({ error: `subdomínio ainda não verificado no Resend; envio real bloqueado` }, { status: 409 });
    }

    // ---- Semana: 7 dias completos até hoje 00h (Brasília) x 7 dias anteriores ----
    const agora = new Date();
    const hoje0 = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3, 0, 0));
    if (hoje0 > agora) hoje0.setTime(hoje0.getTime() - DIA_MS);
    const ini7 = new Date(hoje0.getTime() - 7 * DIA_MS);
    const ini14 = new Date(hoje0.getTime() - 14 * DIA_MS);
    const periodo = `${dataBR(ini7)} a ${dataBR(new Date(hoje0.getTime() - 1))}`;
    const periodoAntes = `${dataBR(ini14)} a ${dataBR(new Date(ini7.getTime() - 1))}`;

    if (!testEmail) {
      const { data: jaEnviado } = await supabase.from("newsletter_envios").select("id")
        .eq("semana", periodo).eq("teste", false).gt("enviados", 0).limit(1).maybeSingle();
      if (jaEnviado) return Response.json({ ok: true, aviso: `semana ${periodo} já enviada` });
    }

    const linhas = await buscarPeriodo(supabase, ini14, hoje0);
    const porRadio = new Map<string, Map<string, Contagem>>();
    for (const l of linhas) {
      const atual = new Date(l.tocou_em + "Z") >= ini7;
      if (!porRadio.has(l.radio)) porRadio.set(l.radio, new Map());
      const k = `${l.artista}|||${l.musica}`;
      const m = porRadio.get(l.radio)!;
      if (!m.has(k)) m.set(k, { artista: l.artista, musica: l.musica, atual: 0, anterior: 0 });
      atual ? m.get(k)!.atual++ : m.get(k)!.anterior++;
    }
    const radios = [...porRadio.keys()].filter((r) => [...porRadio.get(r)!.values()].some((c) => c.atual > 0));

    // ---- TOP 10 do mercado (todas as rádios juntas) ----
    const mercado = new Map<string, Contagem & { radios: Set<string>; radiosAntes: Set<string> }>();
    for (const r of radios) for (const [k, c] of porRadio.get(r)!) {
      if (!mercado.has(k)) mercado.set(k, { artista: c.artista, musica: c.musica, atual: 0, anterior: 0, radios: new Set(), radiosAntes: new Set() });
      const m = mercado.get(k)!;
      m.atual += c.atual; m.anterior += c.anterior;
      if (c.atual > 0) m.radios.add(r);
      if (c.anterior > 0) m.radiosAntes.add(r);
    }
    const lista = [...mercado.values()];
    const pos = posicoes(lista, (m) => m.radios.size * 100000 + m.atual);
    const posAntes = posicoes(lista, (m) => m.radiosAntes.size * 100000 + m.anterior);
    const top = lista.filter((m) => pos.has(m)).sort((a, b) => pos.get(a)! - pos.get(b)!).slice(0, 10);

    // ---- Resumo, sem nomes de rádio ----
    const resumo: string[] = [];
    if (top[0]) resumo.push(`<b>Mais tocada do mercado:</b> ${esc(top[0].artista)} – ${esc(top[0].musica)}, em ${top[0].radios.size} de ${radios.length} rádios (${top[0].atual} execuções na semana).`);
    const altas: Contagem[] = [];
    for (const r of radios) for (const c of porRadio.get(r)!.values()) if (c.atual >= 5) altas.push(c);
    const maiorAlta = altas.sort((a, b) => (b.atual - b.anterior) - (a.atual - a.anterior))[0];
    if (maiorAlta && maiorAlta.atual > maiorAlta.anterior) {
      resumo.push(`<b>Maior alta:</b> ${esc(maiorAlta.artista)} – ${esc(maiorAlta.musica)}, em uma das rádios monitoradas, de ${maiorAlta.anterior} para ${maiorAlta.atual} execuções.`);
    }
    // Lançamento: 1ª execução depois de 14 dias de monitoramento e já em 2+ rádios.
    const { data: primeiraLinha } = await supabase.from("radio_airplay").select("tocou_em").order("tocou_em", { ascending: true }).limit(1).maybeSingle();
    const corte = new Date((primeiraLinha ? new Date(primeiraLinha.tocou_em + "Z") : ini14).getTime() + 14 * DIA_MS);
    const candidatos = lista.filter((m) => m.radios.size >= 2).sort((a, b) => b.radios.size - a.radios.size || b.atual - a.atual).slice(0, 40);
    let lancamento: { artista: string; musica: string; radios: number; inicio: Date } | null = null;
    for (let i = 0; i < candidatos.length; i += 8) {
      const res = await Promise.all(candidatos.slice(i, i + 8).map((m) =>
        supabase.from("radio_airplay").select("radio, tocou_em").eq("artista", m.artista).eq("musica", m.musica)
          .order("tocou_em", { ascending: true }).limit(PAGINA)));
      res.forEach(({ data }, j) => {
        const m = candidatos[i + j];
        const primeiras = new Map<string, Date>();
        for (const l of data ?? []) {
          if (RADIOS_EXCLUIDAS.includes(String(l.radio).toUpperCase())) continue;
          if (!primeiras.has(l.radio)) primeiras.set(l.radio, new Date(l.tocou_em + "Z"));
        }
        const inicio = [...primeiras.values()].sort((a, b) => a.getTime() - b.getTime())[0];
        if (primeiras.size >= 2 && inicio >= corte &&
            (!lancamento || primeiras.size > lancamento.radios || (primeiras.size === lancamento.radios && inicio > lancamento.inicio))) {
          lancamento = { artista: m.artista, musica: m.musica, radios: primeiras.size, inicio };
        }
      });
    }
    if (lancamento) {
      const l = lancamento as { artista: string; musica: string; radios: number; inicio: Date };
      resumo.push(`<b>Lançamento se espalhando:</b> ${esc(l.artista)} – ${esc(l.musica)}, já em ${l.radios} rádios; a primeira começou a tocar em ${dataBR(l.inicio)}.`);
    }

    // ---- E-mail ----
    const th = (t: string, a = "left") => `<th style="text-align:${a};padding:8px 6px;font-size:11px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #E5E7EB;">${t}</th>`;
    const td = (t: string, x = "") => `<td style="padding:9px 6px;border-bottom:1px solid #F0F0F0;font-size:14px;color:#1a1a1a;${x}">${t}</td>`;
    const linhasTop = top.map((m) => {
      const mv = movimento(pos.get(m)!, posAntes.get(m));
      return `<tr>${td(`<b>${pos.get(m)}</b>`, "width:24px;")}${td(`<b>${esc(m.artista)}</b><br><span style="color:#555;">${esc(m.musica)}</span>`)}${td(`${m.radios.size}/${radios.length}`, "text-align:center;")}${td(String(m.atual), "text-align:center;")}${td(`<b style="color:${mv.cor};">${mv.texto}</b>`, "text-align:center;")}</tr>`;
    }).join("");

    const conteudo = `
      <p style="font-size:15px;margin:0 0 4px 0;">Bom dia! Aqui está o <b>Radar</b> das rádios monitoradas pelo sistema <b>IA NO RÁDIO</b>.</p>
      <p style="font-size:15px;margin:0 0 18px 0;"><b>Semana: ${periodo}</b> <span style="color:#777;">(comparada com ${periodoAntes})</span></p>
      <div style="background:#F5F7FF;border-radius:10px;padding:14px 18px;margin-bottom:22px;">
        <p style="font-size:12px;color:#5279FF;font-weight:700;margin:0 0 8px 0;letter-spacing:.4px;">RESUMO DA SEMANA</p>
        ${resumo.map((t) => `<p style="font-size:14px;line-height:1.55;margin:0 0 6px 0;">• ${t}</p>`).join("")}
      </div>
      <h2 style="font-size:18px;margin:0 0 4px 0;color:#0D0056;">🏆 TOP 10 do mercado</h2>
      <p style="font-size:12px;color:#777;margin:0 0 8px 0;">Todas as rádios juntas: primeiro as músicas tocando em mais rádios, depois as com mais execuções. ▲ subiu, ▼ caiu, = manteve, NOVA = entrou agora.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><thead><tr>${th("#")}${th("Música")}${th("Rádios", "center")}${th("Exec.", "center")}${th("Mov.", "center")}</tr></thead><tbody>${linhasTop}</tbody></table>
      <div style="background:#0D0056;border-radius:12px;padding:18px 20px;text-align:center;">
        <p style="color:#ffffff;font-size:15px;margin:0 0 12px 0;">Quer ver a programação completa e os dados da sua rádio?</p>
        <a href="${SITE}" style="display:inline-block;background:#D0FF03;color:#0D0056;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;">Conheça o IA NO RÁDIO</a>
      </div>`;
    const texto = `${NOME_NEWS} - semana ${periodo}\n\n` +
      resumo.map((t) => "- " + t.replace(/<[^>]+>/g, "")).join("\n") + "\n\nTOP 10 DO MERCADO\n" +
      top.map((m) => `${pos.get(m)}. ${m.artista} - ${m.musica} (${m.radios.size} rádios, ${m.atual}x)`).join("\n") +
      `\n\nConheça o IA NO RÁDIO: ${SITE}`;

    // ---- Destinatários ----
    let destinos: { email: string; token: string }[];
    if (testEmail) {
      destinos = [{ email: testEmail, token: "00000000-0000-0000-0000-000000000000" }];
    } else {
      destinos = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabase.from("newsletter_inscritos").select("email, token")
          .eq("status", "ativo").order("criado_em", { ascending: true }).range(de, de + PAGINA - 1);
        if (error) throw error;
        destinos.push(...(data ?? []));
        if ((data ?? []).length < PAGINA) break;
      }
    }

    const remetente = verificado ? REMETENTE_NEWS : REMETENTE_PROVISORIO;
    const assunto = `${testEmail ? "[TESTE] " : ""}Radar Rádios de São Paulo – semana ${periodo}`;
    let enviados = 0, erros = 0;
    const detalhes: string[] = [];
    for (let i = 0; i < destinos.length; i += LOTE_RESEND) {
      const lote = destinos.slice(i, i + LOTE_RESEND).map((d) => ({
        from: remetente,
        to: [d.email],
        subject: assunto,
        html: moldura(conteudo,
          `Você recebe o ${esc(NOME_NEWS)} porque se inscreveu em ianoradio.com.<br>` +
          `<a href="${LINK_CANCELAR}${d.token}" style="color:#888;">Cancelar inscrição</a>`),
        text: texto + `\n\nCancelar inscrição: ${LINK_CANCELAR}${d.token}`,
        headers: {
          "List-Unsubscribe": `<${LINK_CANCELAR_DIRETO}${d.token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }));
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote),
      });
      if (r.ok) enviados += lote.length;
      else { erros += lote.length; detalhes.push((await r.text()).slice(0, 300)); }
      if (i + LOTE_RESEND < destinos.length) await new Promise((ok) => setTimeout(ok, 600)); // limite do Resend
    }

    if (!testEmail && enviados > 0) {
      await supabase.from("newsletter_inscritos").update({ ultimo_envio_em: new Date().toISOString() }).eq("status", "ativo");
    }
    await supabase.from("newsletter_envios").insert({
      semana: periodo, teste: !!testEmail, destinatarios: destinos.length, enviados, erros,
      detalhe: detalhes.join(" | ") || null,
    });

    return Response.json({ ok: erros === 0, teste: !!testEmail, semana: periodo, remetente, destinatarios: destinos.length, enviados, erros, radios: radios.length });
  } catch (err) {
    console.error("[newsletter-semanal]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
