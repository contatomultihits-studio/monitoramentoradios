# Newsletter "IA NO RÁDIO - Radar Rádios de São Paulo"

Cadastro feito no ianoradio.com; envio semanal (segunda, 9h) com o resumo e o TOP 10 do
mercado, **sem nomes de rádio**. Kiss FM, Gazeta FM e Mix Rio FM (Rio de Janeiro) ficam fora.

| Função | O que faz | Quem chama |
|---|---|---|
| `newsletter-inscricao` | Recebe o cadastro, anti-robô (campo escondido, tempo mínimo, 5/hora por IP, 300/hora geral), grava como `pendente` e envia o e-mail de confirmação | Formulário do ianoradio.com |
| `newsletter-link` | `confirmar` (pendente → ativo) e `cancelar` (→ cancelado); aceita também o "cancelar inscrição" de 1 clique do Gmail/Outlook | Páginas `/news/confirmar` e `/news/cancelar` do ianoradio.com |
| `newsletter-semanal` | Monta e envia a news para os `ativo` (lotes de 100 no Resend); `{"test_email": "..."}` envia só para um e-mail | Agendamento semanal (cabeçalho `x-relatorio-secret`) |

`_shared/newsletter.ts`: textos, links, remetente e moldura do e-mail. Publicado junto com cada função.

## Banco (`public`, RLS ligado e sem políticas: só as funções acessam)
- `newsletter_inscritos`: e-mail, nome, empresa, cargo, status, token dos links, consentimento (LGPD).
- `newsletter_tentativas`: hash do IP de cada tentativa (limite anti-robô).
- `newsletter_envios`: histórico de cada envio (semana, enviados, erros).

## Remetente
`news@novidades.ianoradio.com`, subdomínio separado para não afetar a entrega dos relatórios
dos clientes. Enquanto o subdomínio não estiver verificado no Resend, o teste sai por
`relatorios@ianoradio.com` e o envio real fica **bloqueado** (resposta 409).

## Agendamento
Cron `newsletter-radar-segunda-9h` (`0 12 * * 1` = segunda 9h de Brasília) chama
`newsletter-semanal` com o segredo `cron_shared_secret`. Para pausar:
`select cron.alter_job((select jobid from cron.job where jobname='newsletter-radar-segunda-9h'), active := false);`

## Páginas no ianoradio.com
Formulário de cadastro, `/news/confirmar` e `/news/cancelar` (feitas no repositório do site).
O token de cada inscrito não expira: é o mesmo dos links de confirmar e de cancelar em toda
news. Com ele só é possível confirmar ou cancelar aquela inscrição.
