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

Armazenamento das fotos: quando as variáveis R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET existem na Vercel, a API (r2.cjs) grava e lê as fotos no Cloudflare R2, um bucket privado acessado só pela API. Se uma foto ainda não estiver no R2, a leitura cai no Supabase Storage, então a troca não derruba imagem nenhuma. Sem essas variáveis, tudo continua no Supabase. O endereço público não muda (/api/images/<uuid>.webp) e o banco não precisa de alteração. Como cada foto tem um nome único e nunca é reescrita, a resposta sai com cache de 1 ano (s-maxage), e a CDN da Vercel serve as repetições sem chamar a API. Para copiar as fotos que já existem: `node scripts/photos-to-r2.cjs`, com as chaves num arquivo local .env.r2 (ignorado pelo git e pelo deploy). O script não apaga nada do Supabase e pode ser rodado de novo, porque pula o que já foi copiado.

## Desenvolvimento

`npm run dev:cloud` abre a prévia em 127.0.0.1:4173 usando os mesmos dados online. Requer login do Supabase CLI já configurado. `npm run dev` continua sendo a versão SQLite isolada para desenvolvimento, sem sincronização automática. Não use import-cloud.cjs novamente: a importação foi concluída e a função temporária foi removida.

`vercel --prod` publica a pasta ecommerce no projeto já vinculado. Variáveis production/preview: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (sensível), APP_ORIGINS. Para domínio próprio, ajustar APP_ORIGINS. Dependências travadas em package-lock.json.

## Estado comercial

O site está online, mas continua uma prévia: catálogo ilustrativo, preços não configurados, sem pagamento, frete calculado ou transação comercial ativa. Os pedidos salvos movimentam o estoque cadastrado. Recuperação de senha por e-mail, checkout e políticas comerciais ainda precisam ser implementados antes de ativar vendas reais.

## Verificação executada

Testes na integração Supabase: autenticação, autorização, bloqueio da chave pública, compra concorrente do último estoque, cancelamento sem devolução duplicada, armazenamento de imagens e restrição de origem. Testes no endereço publicado: cookie seguro, login/reload/logout, painel, bloqueio de comprador, cadastro de administrador desativado, ausência de links públicos para o painel e layout mobile. Contas, pedidos e produto temporários de QA foram excluídos antes da entrega. Hashes das contas reais comparados ao SQLite original sem revelar valores.

A autenticação administrativa usa /api/admin/login e sessões com escopo admin. O login comum em Minha conta gera somente sessão customer, inclusive para o e-mail do administrador. /msadm exige autenticação administrativa; compradores nunca podem criar essa sessão. Sessões anteriores à separação precisam de novo login administrativo.
