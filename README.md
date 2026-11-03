# MS Atacado — e-commerce

Loja: https://msatacado-loja.vercel.app

Frontend HTML/CSS/JavaScript, API Node na Vercel, banco Postgres e fotos no Supabase. A identidade visual usa os arquivos oficiais da MS, Saira/Barlow e as cores da marca.

## Funcionalidades

- Catálogo, busca, filtros, detalhes e galeria de fotos.
- Carrinho com mínimo de seis peças variadas.
- Cadastro, login e histórico por cliente.
- Painel administrativo sem links públicos, com validação de perfil no servidor.
- Estoque por tamanho com baixa atômica e devolução no cancelamento.
- Upload de até oito fotos por peça, capa e remoção.

## Estado comercial

A loja está publicada como prévia. Produtos e fotos de exemplo são ilustrativos; preços, frete e pagamentos reais ainda não estão ativos. Pedidos de demonstração descontam o estoque cadastrado.

## Desenvolvimento

Requer Node 24. Execute npm install. Para a versão SQLite isolada: npm run dev. Para usar o Supabase conectado: npm run dev:cloud (requer Supabase CLI autenticado). Ambas abrem em http://127.0.0.1:4173; execute somente uma por vez.

O banco local, fotos enviadas, backups, credenciais e configurações locais estão ignorados pelo Git. As variáveis de publicação estão descritas em .env.example e devem ser configuradas apenas no servidor. Nunca coloque a chave de serviço no frontend.

## Publicação

Use a raiz deste repositório na Vercel. A configuração está em vercel.json; a API em api/index.js usa cloud-api.cjs. As migrações ficam em supabase/migrations. O banco já foi migrado; não repita a importação inicial. Consulte PUBLICACAO.md para o estado da implantação e as limitações atuais.

## Verificação

npm run check verifica sintaxe. npm test executa testes de contas, estoque e fotos usando bancos temporários; os testes de interface requerem Puppeteer no ambiente de desenvolvimento. O banco real não é usado nesses testes.

## Integração ERP em preparação

A adaptação opcional mantém o modo atual como padrão. Veja [contrato, limites e validação](integrations/fatek/README.md). A conexão real e a escrita de produtos continuam desligadas até o aceite conjunto.
