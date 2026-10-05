import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RECIPIENTS = [
  "jany.lima@radiod.com.br",
  "Francielly.Garcia@radiod.com.br",
  "Simone.Evangelista@radiod.com.br",
  "joao.guilherme@radiod.com.br",
];

const LINK_MONITORAMENTO = "https://monitoramento.ianoradio.com/";
const MIN_EXECUCOES_APOSTA_EXCLUSIVA = 3;
// Rádios fora do relatório (Kiss FM: sem metadados de música desde 14/09/2026;
// Gazeta FM: nomes das músicas em branco desde 30/09/2026, fora até estabilizar).
const RADIOS_EXCLUIDAS = ["KISS FM", "GAZETA FM"];
// A API do Supabase devolve no máximo 1000 linhas por consulta; o dia tem ~2000.
const PAGINA = 1000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function juntarComE(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
}

Deno.serve(async (req: Request) => {
  try {
    const secretHeader = req.headers.get("x-relatorio-secret");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [{ data: cronSecret }, { data: resendApiKey }] = await Promise.all([
      supabase.rpc("get_app_secret", { secret_name: "cron_shared_secret" }),
      supabase.rpc("get_app_secret", { secret_name: "resend_api_key" }),
    ]);

    if (!cronSecret || secretHeader !== cronSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "missing resend api key" }), { status: 500 });
    }

    let testEmail: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.test_email === "string" && body.test_email.includes("@")) {
        testEmail = body.test_email;
      }
    } catch (_e) {
      // sem body ou body vazio, segue normal
    }
    const destinatarios = testEmail ? [testEmail] : RECIPIENTS;

    const now = new Date();
    const hojeInicioBRT = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0));
    const ontemInicio = new Date(hojeInicioBRT.getTime() - 24 * 60 * 60 * 1000);
    const ontemFim = hojeInicioBRT;

    const rowsDia: { radio: string; artista: string; musica: string }[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data: pagina, error: queryErrorDia } = await supabase
        .from("radio_airplay")
        .select("radio, artista, musica")
        .gte("tocou_em", ontemInicio.toISOString())
        .lt("tocou_em", ontemFim.toISOString())
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

      if (queryErrorDia) {
        return new Response(JSON.stringify({ error: queryErrorDia.message }), { status: 500 });
      }
      rowsDia.push(...(pagina ?? []));
      if ((pagina ?? []).length < PAGINA) break;
    }

    const porRadio = new Map<string, Map<string, { artista: string; musica: string; plays: number }>>();
    const musicaGlobal = new Map<
      string,
      { artista: string; musica: string; radios: Set<string>; totalPlays: number }
    >();

    for (const row of rowsDia) {
      if (RADIOS_EXCLUIDAS.includes(String(row.radio ?? "").trim().toUpperCase())) continue;
      if (!porRadio.has(row.radio)) porRadio.set(row.radio, new Map());
      const musicas = porRadio.get(row.radio)!;
      const key = `${row.artista}|||${row.musica}`;
      const entry = musicas.get(key);
      if (entry) entry.plays++;
      else musicas.set(key, { artista: row.artista, musica: row.musica, plays: 1 });

      if (!musicaGlobal.has(key)) {
        musicaGlobal.set(key, { artista: row.artista, musica: row.musica, radios: new Set(), totalPlays: 0 });
      }
      const g = musicaGlobal.get(key)!;
      g.radios.add(row.radio);
      g.totalPlays++;
    }
    const radiosOrdenadas = [...porRadio.keys()].sort();
    const totalRadiosNoDia = radiosOrdenadas.length;
    const dataOntemFormatada = ontemInicio.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    // ---- Insight 1: Consenso do mercado ----
    const SUBTITULO_CONSENSO = "Música que várias rádios estão tocando ao mesmo tempo, diferente do Top 10 individual de cada rádio.";
    const consensoOrdenado = [...musicaGlobal.values()].sort(
      (a, b) => b.radios.size - a.radios.size || b.totalPlays - a.totalPlays,
    );
    const topConsenso = consensoOrdenado.slice(0, 3).filter((m) => m.radios.size > 1);
    let textoConsenso = "Nenhuma música se destacou tocando em muitas rádios ao mesmo tempo hoje.";
    if (topConsenso.length > 0) {
      const frases = topConsenso.map(
        (m) => `"${m.artista} - ${m.musica}" tocou em ${m.radios.size} das ${totalRadiosNoDia} rádios hoje (${m.totalPlays} execuções no total)`,
      );
      textoConsenso = juntarComE(frases) + ".";
    }

    // ---- Insight 2: Perfil de repeticao por radio ----
    const SUBTITULO_PERFIL = "Mostra o quanto cada rádio varia a playlist no dia.";
    const perfilRepeticao = radiosOrdenadas
      .map((radio) => {
        const musicas = porRadio.get(radio)!;
        const totalPlays = [...musicas.values()].reduce((sum, m) => sum + m.plays, 0);
        const distintas = musicas.size;
        const diversidade = totalPlays > 0 ? (distintas / totalPlays) * 100 : 0;
        return { radio, totalPlays, distintas, diversidade };
      })
      .sort((a, b) => b.diversidade - a.diversidade);

    let textoPerfil = "Dados insuficientes pra comparar o perfil das rádios hoje.";
    if (perfilRepeticao.length >= 2) {
      const maisDiversa = perfilRepeticao[0];
      const menosDiversa = perfilRepeticao[perfilRepeticao.length - 1];
      textoPerfil =
        `${maisDiversa.radio}: ${maisDiversa.diversidade.toFixed(0)}% de diversidade — ${maisDiversa.diversidade >= 90 ? "praticamente nunca repete uma música no dia (grade bem ampla/variada)" : "varia bastante a grade ao longo do dia"}. ` +
        `${menosDiversa.radio}: só ${menosDiversa.diversidade.toFixed(0)}% — repete bastante os mesmos hits (rotação mais fechada, foco em poucas faixas fortes).`;
    }

    // ---- Insight 3: Apostas exclusivas ----
    const SUBTITULO_APOSTAS = "Músicas tocando em uma só rádio, pode indicar uma rádio testando uma faixa nova antes da concorrência.";
    const apostasExclusivas = [...musicaGlobal.values()]
      .filter((m) => m.radios.size === 1 && m.totalPlays >= MIN_EXECUCOES_APOSTA_EXCLUSIVA)
      .map((m) => ({ ...m, radio: [...m.radios][0] }))
      .sort((a, b) => b.totalPlays - a.totalPlays)
      .slice(0, 6);

    let textoApostas = "Nenhuma aposta exclusiva clara hoje.";
    if (apostasExclusivas.length > 0) {
      const porRadioApostas = new Map<string, string[]>();
      for (const item of apostasExclusivas) {
        if (!porRadioApostas.has(item.radio)) porRadioApostas.set(item.radio, []);
        porRadioApostas.get(item.radio)!.push(`"${item.artista} - ${item.musica}"`);
      }
      const clausulas = [...porRadioApostas.entries()].map(
        ([radio, musicas]) => `${juntarComE(musicas)} tocando pesado só na ${radio}`,
      );
      textoApostas = clausulas.join("; ") + ".";
    }

    // ---- Texto puro (fallback) ----
    let corpoTexto = `Bom dia, você está recebendo o "TOP 10" das rádios monitoradas pelo sistema "IA NO RÁDIO".\n`;
    corpoTexto += `${dataOntemFormatada} (00h às 00h)\n`;
    corpoTexto += `Para mais detalhes da programação acesse: ${LINK_MONITORAMENTO}\n`;
    if (testEmail) corpoTexto += `[ENVIO DE TESTE - apenas para ${testEmail}]\n`;
    corpoTexto += "=".repeat(50) + "\n\n";

    corpoTexto += "INSIGHTS DO DIA\n\n";
    corpoTexto += "CONSENSO DE MERCADO:\n" + SUBTITULO_CONSENSO + "\n\n" + textoConsenso + "\n\n";
    corpoTexto += "ROTAÇÃO DAS RÁDIOS:\n" + SUBTITULO_PERFIL + "\n\n" + textoPerfil + "\n\n";
    corpoTexto += "APOSTAS:\n" + SUBTITULO_APOSTAS + "\n\n" + textoApostas + "\n\n";
    corpoTexto += "=".repeat(50) + "\n\n";

    if (radiosOrdenadas.length === 0) corpoTexto += "Nenhuma execução registrada no dia anterior.\n";
    for (const radio of radiosOrdenadas) {
      const top10 = [...porRadio.get(radio)!.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
      corpoTexto += `${radio}\n` + "-".repeat(radio.length) + "\n";
      top10.forEach((item, i) => {
        corpoTexto += `${i + 1}. ${item.artista} - ${item.musica} (${item.plays}x)\n`;
      });
      corpoTexto += "\n";
    }
    corpoTexto += "--\nRelatório automático diário do sistema ianoradio.";

    // ---- HTML estilizado ----
    const corDestaque = "#111111";
    const corInsight = "#2563EB";
    const fontePadrao = "Arial, sans-serif";

    const secaoInsightTexto = (titulo: string, subtitulo: string, texto: string) => `
      <div style="margin-bottom:22px;">
        <p style="font-size:18px;color:${corInsight};font-weight:700;margin:0 0 4px 0;font-family:${fontePadrao};letter-spacing:0.3px;">${titulo}</p>
        <p style="font-size:16px;color:#888;line-height:1.4;margin:0 0 10px 0;font-family:${fontePadrao};">${subtitulo}</p>
        <p style="font-size:18px;color:#333;line-height:1.6;margin:0;font-family:${fontePadrao};">${texto}</p>
      </div>`;

    const insightsHtml = `
      <div style="padding:0 4px 20px 4px;border-bottom:1px solid #ececec;margin-bottom:20px;">
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 16px 0;font-family:${fontePadrao};">🔎 Insights do dia</h2>
        ${secaoInsightTexto("CONSENSO DE MERCADO:", SUBTITULO_CONSENSO, textoConsenso)}
        ${secaoInsightTexto("ROTAÇÃO DAS RÁDIOS:", SUBTITULO_PERFIL, textoPerfil)}
        ${secaoInsightTexto("APOSTAS:", SUBTITULO_APOSTAS, textoApostas)}
      </div>`;

    let blocosHtml = "";
    if (radiosOrdenadas.length === 0) {
      blocosHtml = `<p style="color:#666;font-family:${fontePadrao};font-size:17px;">Nenhuma execução registrada no dia anterior.</p>`;
    }
    for (const radio of radiosOrdenadas) {
      const top10 = [...porRadio.get(radio)!.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
      const itensHtml = top10
        .map(
          (item, i) => `
            <tr>
              <td style="padding:9px 4px;color:${corDestaque};font-weight:700;width:28px;vertical-align:top;">${i + 1}</td>
              <td style="padding:9px 4px;color:#1a1a1a;">${escapeHtml(item.artista)} <span style="color:#999;">&mdash;</span> ${escapeHtml(item.musica)}</td>
              <td style="padding:9px 4px;color:#999;text-align:right;white-space:nowrap;">${item.plays}x</td>
            </tr>`,
        )
        .join("");

      blocosHtml += `
        <div style="margin-bottom:28px;border:1px solid #ececec;border-radius:10px;overflow:hidden;">
          <div style="background:${corDestaque};padding:12px 18px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;font-family:${fontePadrao};">${escapeHtml(radio)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-family:${fontePadrao};font-size:17px;">
            <tbody>${itensHtml}</tbody>
          </table>
        </div>`;
    }

    const avisoTeste = testEmail
      ? `<div style="background:#FEF3C7;color:#92400E;padding:10px 16px;border-radius:8px;font-size:16px;margin-bottom:20px;font-family:${fontePadrao};">ENVIO DE TESTE &mdash; apenas para ${escapeHtml(testEmail)}</div>`
      : "";

    const corpoHtml = `
      <div style="max-width:600px;margin:0 auto;font-family:${fontePadrao};">
        <div style="padding:24px 4px 16px 4px;">
          <p style="font-size:17px;color:#1a1a1a;margin:0 0 4px 0;">Bom dia, você está recebendo o "TOP 10" das rádios monitoradas pelo sistema "IA NO RÁDIO".</p>
          <p style="font-size:17px;color:#1a1a1a;margin:0 0 12px 0;font-weight:700;">${dataOntemFormatada} (00h às 00h)</p>
          <p style="font-size:16px;color:#666;margin:0 0 16px 0;">Para mais detalhes da programação acesse: <a href="${LINK_MONITORAMENTO}" style="color:#111111;">${LINK_MONITORAMENTO}</a></p>
          ${avisoTeste}
        </div>
        ${insightsHtml}
        ${blocosHtml}
        <p style="color:#aaa;font-size:15px;padding:0 4px;">Relatório automático diário do sistema ianoradio.</p>
      </div>`;

    const assunto = `${testEmail ? "[TESTE] " : ""}TOP 10 RÁDIOS - ${dataOntemFormatada} - MONITORAMENTO IA NO RÁDIO`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Relatório ianoradio <relatorios@ianoradio.com>",
        to: destinatarios,
        subject: assunto,
        html: corpoHtml,
        text: corpoTexto,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      return new Response(JSON.stringify({ error: "resend failed", detail: errText }), { status: 502 });
    }

    return new Response(
      JSON.stringify({ ok: true, radios: radiosOrdenadas.length, linhas_lidas: rowsDia.length, destinatarios }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
