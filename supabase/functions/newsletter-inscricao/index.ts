import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  cabecalhosCors, esc, json, LINK_CONFIRMAR, moldura, NOME_NEWS,
  REMETENTE_NEWS, REMETENTE_PROVISORIO, subdominioVerificado,
} from "../_shared/newsletter.ts";

// Cadastro na newsletter, chamado pelo formulário do ianoradio.com.
// Corpo (JSON): { email, nome?, empresa?, cargo?, consentimento: true,
//                 site: "" (campo escondido anti-robô), tempo_ms: tempo de preenchimento }
// Sempre responde a mesma mensagem genérica para não revelar quem já é inscrito.

const TEXTO_CONSENTIMENTO =
  "Aceito receber por e-mail, uma vez por semana, a newsletter IA NO RÁDIO - Radar Rádios de São Paulo, " +
  "e sei que posso cancelar a qualquer momento pelo link em cada e-mail.";
const MAX_POR_IP_HORA = 5;
const MAX_GERAL_HORA = 300;
const MAX_CONFIRMACOES_DIA = 3;
const TEMPO_MINIMO_MS = 2500; // robôs preenchem o formulário instantaneamente
const RESPOSTA_OK = { ok: true, mensagem: "Pronto! Enviamos um e-mail para você confirmar a inscrição." };

const limpar = (v: unknown, max = 100) => String(v ?? "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max) || null;

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cabecalhosCors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, mensagem: "Método não permitido" });

  try {
    let corpo: any;
    try { corpo = await req.json(); } catch (_e) { return json(req, 400, { ok: false, mensagem: "Dados inválidos" }); }

    // Anti-robô: campo escondido preenchido ou envio rápido demais → finge sucesso e ignora.
    if (String(corpo?.site ?? "") !== "" || Number(corpo?.tempo_ms ?? 0) < TEMPO_MINIMO_MS) {
      return json(req, 200, RESPOSTA_OK);
    }

    const email = String(corpo?.email ?? "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return json(req, 400, { ok: false, mensagem: "Informe um e-mail válido." });
    }
    if (corpo?.consentimento !== true) {
      return json(req, 400, { ok: false, mensagem: "É preciso aceitar receber a newsletter." });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: sal }, { data: resendKey }] = await Promise.all([
      supabase.rpc("get_app_secret", { secret_name: "cron_shared_secret" }),
      supabase.rpc("get_app_secret", { secret_name: "resend_api_key" }),
    ]);
    if (!resendKey) return json(req, 500, { ok: false, mensagem: "Tente novamente mais tarde." });

    // Limite de tentativas por IP (guardado só como hash) e limite geral.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";
    const ipHash = await sha256(`${sal}|${ip}`);
    const umaHoraAtras = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: doIp }, { count: geral }] = await Promise.all([
      supabase.from("newsletter_tentativas").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("criado_em", umaHoraAtras),
      supabase.from("newsletter_tentativas").select("id", { count: "exact", head: true }).gte("criado_em", umaHoraAtras),
    ]);
    if ((doIp ?? 0) >= MAX_POR_IP_HORA || (geral ?? 0) >= MAX_GERAL_HORA) {
      return json(req, 429, { ok: false, mensagem: "Muitas tentativas. Tente novamente mais tarde." });
    }
    await supabase.from("newsletter_tentativas").insert({ ip_hash: ipHash });

    const dados = {
      nome: limpar(corpo?.nome),
      empresa: limpar(corpo?.empresa),
      cargo: limpar(corpo?.cargo),
    };
    const { data: existente } = await supabase.from("newsletter_inscritos")
      .select("id, status, token, confirmacoes_enviadas, ultima_confirmacao_em").eq("email", email).maybeSingle();

    if (existente?.status === "ativo") return json(req, 200, RESPOSTA_OK); // já inscrito: nada a fazer

    let token: string;
    let enviadasHoje = 0;
    if (!existente) {
      const { data: novo, error } = await supabase.from("newsletter_inscritos").insert({
        email, ...dados, status: "pendente",
        consentimento_em: new Date().toISOString(), consentimento_texto: TEXTO_CONSENTIMENTO,
      }).select("token").single();
      if (error) throw error;
      token = novo.token;
    } else {
      // Pendente ou cancelado voltando: no máximo 3 e-mails de confirmação por dia.
      const ultima = existente.ultima_confirmacao_em ? new Date(existente.ultima_confirmacao_em).getTime() : 0;
      enviadasHoje = Date.now() - ultima < 86400_000 ? existente.confirmacoes_enviadas : 0;
      if (enviadasHoje >= MAX_CONFIRMACOES_DIA) return json(req, 200, RESPOSTA_OK);
      const { data: atual, error } = await supabase.from("newsletter_inscritos").update({
        ...dados, status: "pendente", cancelado_em: null,
        consentimento_em: new Date().toISOString(), consentimento_texto: TEXTO_CONSENTIMENTO,
        confirmacoes_enviadas: enviadasHoje,
      }).eq("id", existente.id).select("token").single();
      if (error) throw error;
      token = atual.token;
    }

    const verificado = await subdominioVerificado(resendKey);
    const saudacao = dados.nome ? `Olá, ${esc(dados.nome.split(" ")[0])}!` : "Olá!";
    const link = LINK_CONFIRMAR + token;
    const html = moldura(`
      <p style="font-size:16px;margin:0 0 12px 0;">${saudacao}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px 0;">Falta só um passo para você receber, toda segunda-feira, o <b>${esc(NOME_NEWS)}</b>: as músicas que mais tocaram nas rádios de São Paulo, o que está subindo e os lançamentos que estão se espalhando.</p>
      <p style="text-align:center;margin:0 0 20px 0;"><a href="${link}" style="display:inline-block;background:#D0FF03;color:#0D0056;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;">Confirmar inscrição</a></p>
      <p style="font-size:13px;color:#777;line-height:1.5;margin:0;">Se o botão não funcionar, copie este endereço no navegador:<br><span style="color:#0D0056;word-break:break-all;">${link}</span></p>`,
      "Se você não pediu esta inscrição, é só ignorar este e-mail: sem a confirmação, você não recebe nada.");

    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: verificado ? REMETENTE_NEWS : REMETENTE_PROVISORIO,
        to: [email],
        subject: "Confirme sua inscrição no Radar Rádios de São Paulo",
        html,
        text: `${saudacao.replace(/<[^>]+>/g, "")}\n\nConfirme sua inscrição no ${NOME_NEWS}: ${link}\n\nSe você não pediu, ignore este e-mail.`,
      }),
    });
    if (!envio.ok) {
      console.error("[newsletter-inscricao] Resend:", await envio.text());
      return json(req, 502, { ok: false, mensagem: "Não conseguimos enviar o e-mail agora. Tente novamente mais tarde." });
    }
    await supabase.from("newsletter_inscritos").update({
      confirmacoes_enviadas: enviadasHoje + 1,
      ultima_confirmacao_em: new Date().toISOString(),
    }).eq("email", email);

    return json(req, 200, RESPOSTA_OK);
  } catch (err) {
    console.error("[newsletter-inscricao]", err);
    return json(req, 500, { ok: false, mensagem: "Tente novamente mais tarde." });
  }
});
