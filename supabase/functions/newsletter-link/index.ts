import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cabecalhosCors, json } from "../_shared/newsletter.ts";

// Confirma ou cancela a inscrição na newsletter.
// - Páginas do ianoradio.com (/news/confirmar e /news/cancelar) chamam com POST JSON { acao, token }.
// - Botão "cancelar inscrição" do Gmail/Outlook (List-Unsubscribe-Post) chama com POST e
//   ?acao=cancelar&token=... na URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cabecalhosCors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, mensagem: "Método não permitido" });

  try {
    const url = new URL(req.url);
    let acao = url.searchParams.get("acao") ?? "";
    let token = url.searchParams.get("token") ?? "";
    if (!acao || !token) {
      try {
        const corpo = await req.json();
        acao = String(corpo?.acao ?? "");
        token = String(corpo?.token ?? "");
      } catch (_e) { /* corpo de formulário (one-click) sem JSON */ }
    }
    if (!["confirmar", "cancelar"].includes(acao) || !UUID.test(token)) {
      return json(req, 400, { ok: false, mensagem: "Link inválido." });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: inscrito } = await supabase.from("newsletter_inscritos")
      .select("id, status").eq("token", token).maybeSingle();
    if (!inscrito) return json(req, 404, { ok: false, mensagem: "Link inválido ou expirado." });

    if (acao === "confirmar") {
      if (inscrito.status === "cancelado") {
        return json(req, 409, { ok: false, mensagem: "Esta inscrição foi cancelada. Faça uma nova inscrição no site." });
      }
      if (inscrito.status !== "ativo") {
        await supabase.from("newsletter_inscritos")
          .update({ status: "ativo", confirmado_em: new Date().toISOString() }).eq("id", inscrito.id);
      }
      return json(req, 200, { ok: true, mensagem: "Inscrição confirmada! Você vai receber o Radar toda segunda-feira." });
    }

    if (inscrito.status !== "cancelado") {
      await supabase.from("newsletter_inscritos")
        .update({ status: "cancelado", cancelado_em: new Date().toISOString() }).eq("id", inscrito.id);
    }
    return json(req, 200, { ok: true, mensagem: "Pronto, você não vai mais receber o Radar." });
  } catch (err) {
    console.error("[newsletter-link]", err);
    return json(req, 500, { ok: false, mensagem: "Tente novamente mais tarde." });
  }
});
