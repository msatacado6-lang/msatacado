# MS Atacado — loja publicada

Loja: https://msatacado-loja.vercel.app

Painel (acesso direto, sem links na área pública): https://msatacado-loja.vercel.app/msadm

Projeto Vercel: msatacado-loja, conta gabs-projects-d4b32cc2.
Supabase: qdjjcewniayemmsiinec, nome msatacado.
O site anterior msatacado.vercel.app é o link da bio e foi preservado.

## Dados e acesso

Contas, produtos, grade, pedidos e referências de fotos foram migrados do SQLite. Senhas protegidas foram preservadas, portanto o administrador usa o mesmo e-mail e senha. Sessões não foram migradas: faça login novamente. Backup anterior à migração: data/backups/ (ignorado pelo Git).

As tabelas ficam no schema ms_private, com RLS habilitada, sem permissões para anon/authenticated. O frontend não recebe chaves de serviço e não acessa tabelas diretamente. Somente a API da loja chama a função ms_store com a chave de serviço guardada na Vercel. A função valida a sessão e o perfil em cada operação. Cadastro público sempre cria customer. A criação inicial de administrador não existe na API publicada. Migração administrativa temporária removida após importação.

Sessões usam cookies HttpOnly, SameSite=Strict e Secure em produção. Senhas continuam com scrypt e salt. Cada cliente consulta apenas seus próprios pedidos. O estoque é descontado atomicamente; cancelamento devolve uma vez. Edição do estoque usa controle de versão para impedir sobrescrita de saldo alterado por pedidos.

Fotos ficam no bucket privado ms-product-photos. A API entrega apenas imagens de catálogo em /api/images/<uuid>.webp; acesso administrativo é necessário para enviar, escolher capa ou remover. As imagens são convertidas em WebP e redimensionadas no navegador antes de enviar (limite de requisição da Vercel) e validadas novamente no servidor. Chaves não são gravadas em arquivos ou no frontend.

## Desenvolvimento

`npm run dev:cloud` abre a prévia em 127.0.0.1:4173 usando os mesmos dados online. Requer login do Supabase CLI já configurado. `npm run dev` continua sendo a versão SQLite isolada para desenvolvimento, sem sincronização automática. Não use import-cloud.cjs novamente: a importação foi concluída e a função temporária foi removida.

`vercel --prod` publica a pasta ecommerce no projeto já vinculado. Variáveis production/preview: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (sensível), APP_ORIGINS. Para domínio próprio, ajustar APP_ORIGINS. Dependências travadas em package-lock.json.

## Estado comercial

O site está online, mas continua uma prévia: catálogo ilustrativo, preços não configurados, sem pagamento, frete calculado ou transação comercial ativa. Os pedidos salvos movimentam o estoque cadastrado. Recuperação de senha por e-mail, checkout e políticas comerciais ainda precisam ser implementados antes de ativar vendas reais.

## Verificação executada

Testes na integração Supabase: autenticação, autorização, bloqueio da chave pública, compra concorrente do último estoque, cancelamento sem devolução duplicada, armazenamento de imagens e restrição de origem. Testes no endereço publicado: cookie seguro, login/reload/logout, painel, bloqueio de comprador, cadastro de administrador desativado, ausência de links públicos para o painel e layout mobile. Contas, pedidos e produto temporários de QA foram excluídos antes da entrega. Hashes das contas reais comparados ao SQLite original sem revelar valores.

A autenticação administrativa usa /api/admin/login e sessões com escopo admin. O login comum em Minha conta gera somente sessão customer, inclusive para o e-mail do administrador. /msadm exige autenticação administrativa; compradores nunca podem criar essa sessão. Sessões anteriores à separação precisam de novo login administrativo.
