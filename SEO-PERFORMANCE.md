# SEO e desempenho — 05/11/2026

Domínio principal: https://msatacado-rs.com.br

Páginas públicas possuem HTML pré-renderizado, URLs próprias, título, descrição, canonical e metadados sociais. Home e loja têm ClothingStore JSON-LD apenas com informações confirmadas. Área administrativa, conta e cadastro usam noindex. Não foram adicionados preços, avaliações ou horários fictícios.

robots.txt aponta para /sitemap.xml. A função sitemap.cjs gera o XML com produtos ativos; cloud-api.cjs atende /sitemap.xml e /api/sitemap. Cache compartilhado máximo de 5 minutos. Não contém clientes ou pedidos.

A pré-renderização é uma fotografia pública para primeira pintura e leitura sem JS; estoque, cadastro, fotos e frete continuam sendo consultados e validados pela API ao abrir a página. No HTML de produto, a compra fica desabilitada até essa atualização. Novos IDs têm fallback /product.html. Atualizações administrativas continuam funcionando.

Para atualizar HTML e CSS agrupado antes de publicar: node scripts/prerender.cjs (Node 24 e Puppeteer instalado). O script lê apenas /api/products, /api/home e /api/categories da produção, não cria registros. Template: scripts/page-template.html. Nunca editar somente dist/site.css: é gerado dos arquivos CSS. Imagens responsivas e fontes WOFF2 estão versionadas. Os TTF originais continuam disponíveis como fonte de edição.

A integração da PR #1 não foi mesclada. Preservar mudanças locais de cadastro/telefone e frete.

Indexação não foi solicitada ao Google: Search Console requer login e verificação da propriedade. SEO técnico pronto não garante indexação imediata nem posição nos resultados.
