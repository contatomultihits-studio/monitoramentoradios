# Coleta das rádios (`smooth-action`)

Edge Function do Supabase que roda a cada minuto (cron `monitoramento-musical`)
e grava em `radio_airplay` a música tocando em cada rádio.

| Arquivo | O que é |
|---|---|
| `monitoramento-musical.ts` | Versão publicada (v104, 04/10/2026) |
| `backup-v103.ts` | Versão anterior (v103). Use para voltar atrás da v104. |
| `backup-v102.ts` | Versão v102. |
| `backup-v101.ts` | Versão v101, que funcionava até 04/10/2026. |

## Mudanças da v104 em relação à v103
- BPM não é mais estimado pela duração da música: sem BPM real (Deezer/AcousticBrainz),
  a música fica sem BPM.
- O histórico não reaproveita BPM com valor da antiga estimativa (128, 120, 110, 100,
  95, 90), porque não dá para saber se era real ou inventado; nesses casos busca de novo.

## Mudanças da v103 em relação à v102
- Pré-checagem de repetição **antes** de buscar capa/gênero/BPM: se a execução já
  está gravada (mesmo horário vindo da rádio, ou mesma música da última tocada há
  menos de 10 min), pula sem consultar Deezer/iTunes/Last.fm/MusicBrainz.
  A deduplicação original continua no mesmo lugar, como segunda barreira.
- Reaproveitamento do histórico corrigido: busca em MAIÚSCULAS (como o banco grava)
  e não exige mais Tom/Camelot (só ~13% das músicas têm), então músicas já
  conhecidas não são pesquisadas de novo.

## Mudanças da v102 em relação à v101
- Pedidos às rádios com identificação de navegador completa (antes `Mozilla/5.0` sozinho,
  e a Educadora sem identificação nenhuma).
- Recuo após bloqueio: se uma rádio responder 403/429, a coleta espera 15 min antes
  de tentar de novo (estado em `public.coleta_bloqueios`), em vez de insistir a cada minuto.
- Kiss FM fora da lista (não publica o nome das músicas desde 14/09/2026).

## Como voltar atrás
Publicar `backup-v103.ts` (ou `backup-v102.ts` / `backup-v101.ts`) como entrypoint `monitoramento-musical.ts`
da função `smooth-action` (verify_jwt = true).

## Como voltar para a v101
Publicar `backup-v101.ts` como entrypoint `monitoramento-musical.ts` da função
`smooth-action` (verify_jwt = true). A tabela `public.coleta_bloqueios` pode ficar;
a v101 não a usa.

## Relacionado (no banco)
- `coleta.metropolitana_coletar()` + cron `metropolitana-via-banco`: coleta da
  Metropolitana pelo banco, criada quando o m985.com.br bloqueou a Edge Function (30/09/2026).
- `coleta.verificar_coleta()` + cron `monitor-coleta-alertas`: e-mail quando a coleta para/volta.
