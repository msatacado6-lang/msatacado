# Loja conectada ao ERP

Preparação para revisão em PR, sem publicação da loja ou ativação. O modo padrão continua `LEGACY`.
O visual e o painel atual são preservados nesse modo. Nenhum banco existente
é importado, apagado ou migrado por iniciar o código.

## Uma fonte para cada informação

- ERP: produtos, grade, custo/preço, saldo, clientes comerciais e novos pedidos.
- Supabase da loja: Auth dos compradores, sessão e apresentação.
- Painel da loja: apresentação e cadastro simples do mesmo produto do ERP.

O modo `FATEK` usa os endpoints publicados da integração por uma Edge Function.
Cadastro/login, confirmação, recuperação e refresh usam o SDK oficial Supabase.
Senhas e chaves de serviço não são enviadas ao ERP. O login administrativo
existente continua separado, conferido no servidor; uma conta de comprador não
recebe esse acesso. Administradores do painel e usuários de Auth não são unidos
por e-mail automaticamente.

O catálogo lê todas as páginas e mantém os IDs de produto/variante, mesmo com
cores diferentes no mesmo tamanho. Preços e disponibilidade vêm do ERP. O carrinho
consulta entrega por CEP, retirada ou combinação conforme a política da API.
Depois da cotação, registra o pedido e só então oferece o WhatsApp retornado.
Nada abre/envia WhatsApp automaticamente. Pedido não reserva/baixa saldo nem
comprova pagamento. Erros mantêm o carrinho; resultado incerto mantém a mesma
chave/corpo, sem repetir automaticamente nem criar um novo pedido.

## Cadastro pelos dois painéis

`MS_FATEK_PRODUCT_WRITES=1` requer credencial própria `FATEK_PRODUCT_KEY` somente
no servidor, origem fixa, plano compatível e liberação específica no ERP. Não
usar a credencial de consulta do catálogo nem qualquer chave global. O backend
primeiro confere a sessão administrativa existente e depois usa a credencial
restrita. A API confere novamente workspace, responsável, grants atuais, escopo,
origem, flag e plano; pode revogar a delegação sem mudar outros acessos.

O formulário conectado cria/edita nome, categoria, descrição, preço/custo e
grade com os IDs/revisão canônicos. Cadastros novos têm uma intenção persistida
antes do envio: repetir o mesmo cadastro confirma o resultado sem duplicar.
Uma edição antiga não sobrescreve uma mudança feita no ERP. Fotos básicas podem ser enviadas pelo painel e suas URLs são gravadas no ERP. O backend valida o arquivo, normaliza para WebP e usa o storage atual da loja, com chave somente no servidor. Parâmetros
fiscais e demais campos avançados já existentes são preservados.

O formulário exibe preços/custos específicos por combinação; em branco herda os
valores da peça. Grade incompleta é apontada antes do envio: “Completar combinações”
acrescenta as linhas faltantes sem saldo. Combinações não vendidas podem ficar
inativas, respeitando o bloqueio do ERP para variações com saldo. É possível trocar
a capa e remover referências às fotos, junto com o cadastro/revisão; isso não
apaga objetos do storage. A vitrine inclui a capa entre as miniaturas.

Enquanto aguarda gravação, os controles ficam bloqueados. Validação rejeitada
na primeira criação permite corrigir os dados; resultado incerto conserva o
mesmo corpo/UUID após fechar/reabrir, mesmo que uma nova tentativa perca permissão.
O limite do corpo de cadastro é 512 KiB, até 500 combinações, também conferido
antes de enviar. `422 INVALID_GRADE` significa grade rejeitada sem commit;
conflito de revisão exige reabrir a edição. Nunca criar nova intenção para
substituir um resultado incerto.

Saldo é somente leitura no formulário conectado. Entradas e ajustes
continuam no ERP nesta primeira etapa; não existe sincronização de dois saldos.
Excluir produto ou alterar status de pedido pelo backend anterior é bloqueado
no modo conectado. A API administrativa lista até 1.000 produtos; acima disso
retorna erro explícito, sem truncar o catálogo. A vitrine pública é paginada.

## Preparação conjunta

1. Conferir projeto Supabase, domínio/origem e identidade dos administradores.
2. Revisar as tabelas e migrations existentes; há Auth e estoque próprios da
   versão anterior. Não aplicar `session-contract.sql` cegamente. Transformar
   o contrato revisado em migration nova no projeto da loja, sem editar as
   migrations aplicadas. Ele instala sessão atual/revogação e apresentação com
   RLS; não importa senhas, não concede administrador e não altera estoque.
3. Instalar a função `integrations/fatek/supabase/functions/storefront` no projeto
   da loja. Sua configuração usa URL, chave pública, origem, slug `ms-atacado`,
   origem Fatek `https://crm.fatek.solutions` e credencial privada da ponte. A
   função trata autenticação internamente; configurar `verify_jwt=false` apenas
   para essa função, conforme o contrato das chaves publishable.
4. Revisar dados reais e mapear IDs antigos → IDs ERP em operação própria.
   Nenhum preço, mínimo de seis peças, endereço, WhatsApp ou saldo do protótipo
   é promovido automaticamente a regra real. Contas antigas precisam de plano
   de migração para Supabase Auth; não reutilizar hashes/sessões incompatíveis.
5. Validar cadastro, confirmação, reset, logout, sessão revogada, perfil,
   colisões no CRM, pedidos repetidos, indisponibilidade, grade e frete sandbox.
6. Só após aceite e autorização, configurar o modo conectado e a delegação de
   produtos. O teste padrão atual da MS não concede o recurso de loja Pro.

Por padrão nenhuma variável ativa a integração. A branch de revisão
`codex/fatek-api-adapter` tem deploy automático Vercel desativado exclusivamente
para ela em `git.deploymentEnabled`. As outras branches conservam o comportamento
anterior. Validação remota para merge fica pendente da revisão conjunta. Sem novo
domínio ou mudança de hospedagem nesta preparação. A hospedagem atual do código
continua suportada; migrar para Cloudflare/R2 é uma etapa separada.

## Validação local

`npm run build:fatek` recompila `dist/fatek-client.js` a partir do adaptador e do
cliente tipado. `npm run check` confere sintaxe; `npm run test:fatek` verifica
isolamento, configuração, DTO, paginação, perfil, incerteza de pedido e proxy
restrito. `npm test` mantém as suítes anteriores, com bancos temporários.
Puppeteer pode usar Chrome local por `PUPPETEER_EXECUTABLE_PATH`; não usar perfil
ou cookies de produção nos testes. `node qa-fatek.cjs` cobre vitrine/galeria,
formulário desktop/mobile, preço por combinação/herança, capa, grade incompleta,
correção após rejeição, replay após resultado incerto/perda de permissão e bloqueio
dos controles durante gravação. O backend real nega leitura/escrita administrativa
a visitantes e compradores. O navegador usa transporte sintético; a homologação
externa real continua pendente.

Em rollback, pausar a conexão e a delegação de escrita no ERP antes do código.
Não voltar ao banco antigo como fallback para falha de API. Preservar produtos,
pedidos, IDs e intentos existentes. Voltar a `LEGACY` é mudança de fonte de dados
e exige reconciliação/autorização, não é um mecanismo automático de recuperação.

Fotos enviadas antes de salvar o produto podem ficar sem referência se o cadastro for abandonado. Não apagar esses objetos automaticamente durante resultado incerto; definir limpeza com conferência de referências na operação de mídia. A migração desse upload para R2 preserva o contrato de URL e é separada.

## Recuperação do site publicado — 03/11

Origem confirmada: `https://msatacado-rs.com.br`; projeto público:
`https://qdjjcewniayemmsiinec.supabase.co`. Isso identifica os destinos, sem
credenciais, alteração do Auth ou ativação. O manifesto `site-recovery-20261103.json`
guarda hashes dos assets públicos comparados com o main do repositório.

Foram conciliados os ajustes de layout, telefone, fotos/estoque e as telas de
frete com o formulário canônico da PR. O acesso integrado mantém e-mail/senha no
Supabase; informar um e-mail sozinho não cria sessão nem concede acesso ao histórico.
O WhatsApp é dado de contato: edição no CRM exige o perfil próprio e a revisão
exibida; metadata do Auth não sobrescreve automaticamente uma ficha existente.
Na versão SQLite de desenvolvimento, contatos ficam em tabela aditiva separada,
compatível com o formato anterior de `users`; rollback preserva essa tabela.

A calculadora do produto preserva a interface recuperada. No modo FATEK exige
sessão, combinação selecionada e cotação canônica com o mínimo atual. Ela não
cota contra o saldo antigo. O carrinho continua usando a revisão/recibo ERP;
o painel de frete aponta para as configurações autorizadas do ERP. A interface
legada recuperada de frete ainda depende de conciliar o backend original.

`security-headers.cjs` é a fonte da política servida localmente e registrada em
`vercel.json`. Permite conexões somente à própria origem e ao projeto Supabase
acima, imagens da própria origem/projeto/CRM e o hash exato do bootstrap inline.
Não libera wildcard, scripts inline genéricos ou unsafe-eval. Uma mudança de
projeto ou outro provedor de imagens exige revisar a lista de destinos e os
testes. O teste de navegador confere o SDK real com CSP efetiva e transporte
sintético, inclusive bloqueio de destino não aprovado.

Configuração prevista do Auth, **não aplicada**: Site URL
`https://msatacado-rs.com.br/`, redirects exatos
`https://msatacado-rs.com.br/#conta` e
`https://msatacado-rs.com.br/#conta/nova-senha`. Conferir SMTP, confirmação,
recuperação e refresh no projeto real antes de considerar isso homologado.
A prova TXT do domínio e as credenciais restritas permanecem pendentes.

**Dependência externa antes de rollout:** recuperar o fonte do backend que gerou
a versão publicada e das migrations `20261031115850_shipping_melhor_envio` e
`20261102224102_passwordless_customers_phone`. Elas foram vistas no banco real,
mas não estão no main consultado. Não inventar seu conteúdo, reaplicá-las ou
sobrescrever o backend publicado usando apenas esta recuperação de frontend.
Gabriel pode fornecer o fonte por arquivo ou repositório, sem novo deploy.
`recover-live-migrations.sql` é uma consulta somente leitura das duas versões
para recuperar seu SQL no projeto dedicado. Guardar a saída em privado e revisar
possíveis segredos antes de versioná-la; a consulta não executa as migrations.
Acesso à Vercel ajuda a inspecionar configuração, mas não garante o fonte completo.
O gate de deploy da branch de revisão continua desligado; CI remota segue pendente.
