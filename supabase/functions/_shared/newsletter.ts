// Partes comuns da newsletter "IA NO RÁDIO - Radar Rádios de São Paulo".
// Importado pelas funções newsletter-* (publicado junto com cada uma).

export const NOME_NEWS = "IA NO RÁDIO - Radar Rádios de São Paulo";
export const SITE = "https://ianoradio.com";
export const LINK_CONFIRMAR = `${SITE}/news/confirmar?token=`;
export const LINK_CANCELAR = `${SITE}/news/cancelar?token=`;
export const LINK_CANCELAR_DIRETO =
  "https://ojtdpnrjulrlhxvbmsnr.supabase.co/functions/v1/newsletter-link?acao=cancelar&token=";

export const DOMINIO_NEWS = "novidades.ianoradio.com";
export const REMETENTE_NEWS = `IA NO RÁDIO <news@${DOMINIO_NEWS}>`;
// Usado só em testes enquanto o subdomínio não estiver verificado no Resend.
export const REMETENTE_PROVISORIO = "IA NO RÁDIO <relatorios@ianoradio.com>";

// Origens que podem chamar as funções pelo navegador (site oficial e prévias da Vercel).
export function cabecalhosCors(req: Request): Record<string, string> {
  const origem = req.headers.get("Origin") ?? "";
  let permitido = SITE;
  try {
    const host = new URL(origem).hostname;
    if (host === "ianoradio.com" || host.endsWith(".ianoradio.com") || host.endsWith(".vercel.app") || host === "localhost") {
      permitido = origem;
    }
  } catch (_e) { /* sem origem */ }
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhosCors(req), "Content-Type": "application/json" },
  });
}

// O subdomínio só é usado depois de verificado no Resend (registros de DNS criados).
export async function subdominioVerificado(resendKey: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${resendKey}` } });
    const d = await r.json();
    return (d?.data ?? []).some((x: any) => x.name === DOMINIO_NEWS && x.status === "verified");
  } catch (_e) {
    return false;
  }
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Moldura visual dos e-mails da newsletter (cores do IA NO RÁDIO).
export function moldura(conteudo: string, rodape: string): string {
  return `
  <div style="background:#F5F6FA;padding:24px 12px;font-family:Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <div style="background:#0D0056;padding:20px 24px;">
        <div style="color:#D0FF03;font-size:12px;font-weight:700;letter-spacing:1.5px;">IA NO RÁDIO</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:4px;">Radar Rádios de São Paulo</div>
      </div>
      <div style="padding:24px;color:#1a1a1a;">${conteudo}</div>
      <div style="padding:16px 24px;background:#FAFAFB;border-top:1px solid #EEE;color:#888;font-size:12px;line-height:1.6;">${rodape}</div>
    </div>
  </div>`;
}
