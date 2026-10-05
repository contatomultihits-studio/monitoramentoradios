# TOP 10 das rádios (`relatorio-diario-radios`)

Edge Function do Supabase chamada pelo cron `relatorio-diario-radios-10h-seg-qua`
(segunda e quarta, 10h de Brasília). Envia o TOP 10 por e-mail (Resend).

| Arquivo | O que é |
|---|---|
| `index.ts` | Versão publicada (v19, 06/10/2026): TOP 10 analítico com NOVIDADE / VOLTOU |
| `backup-v18.ts` | TOP 10 analítico com o selo "NOVA" (v18). |
| `backup-v17.ts` | Versão anterior (TOP 10 do dia anterior + 3 insights). Use para voltar atrás. |

## O que a v18 mostra
- Semana (7 dias completos até a 00h do dia do envio) comparada com os 7 dias anteriores.
- Resumo de 3 linhas: mais tocada do mercado, maior alta e lançamento se espalhando
  (ou maior queda, se não houver lançamento).
- TOP 10 do mercado: todas as rádios juntas, ordenado por número de rádios e depois execuções.
- Quem tocou primeiro: lançamentos (1ª execução depois de 14 dias de monitoramento) já em
  2+ rádios, na ordem em que cada rádio começou a tocar.
- TOP 10 por rádio com movimento (▲/▼ = posições no ranking, =) e cobertura de dados (aviso abaixo de 80%).
- Sem execução na semana anterior: **NOVIDADE** (nunca tocou na rádio desde o início do monitoramento)
  ou **VOLTOU** (já tinha tocado antes). No TOP 10 do mercado, NOVIDADE = nenhuma rádio tinha tocado.
- Kiss FM e Gazeta FM fora (`RADIOS_EXCLUIDAS`).

## Teste
Com `{"test_email": "alguem@exemplo.com"}` no corpo, envia só para esse e-mail.

## Como voltar para a v17
Publicar `backup-v17.ts` como `index.ts` da função `relatorio-diario-radios` (verify_jwt = false).
