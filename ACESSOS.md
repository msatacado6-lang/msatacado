# Contas e painel local

Abra http://127.0.0.1:4173/#admin para criar o primeiro administrador. Você define o nome, e-mail e senha (mínimo de 10 caracteres). Depois da configuração, essa página passa a pedir login. Não há senha padrão nem contas de teste no banco principal.

Clientes criam suas contas em http://127.0.0.1:4173/#cadastro e entram em /#conta. No carrinho, selecione ao menos seis peças, revise e confirme “Salvar pedido na minha conta”. O histórico fica vinculado ao usuário autenticado. Todas as seleções são simulações: não cobram nem geram entrega, mas descontam as unidades do estoque local ao confirmar. Cancelar devolve as unidades uma única vez; reativar exige estoque novamente. Pedidos antigos não recebem baixa retroativa.

O painel inclui visão geral, lista e situação dos pedidos, clientes cadastrados e edição de nome, lavagem, categoria e descrição dos três modelos ilustrativos. A grade permite tamanhos por letras e números, com quantidade disponível por tamanho. Cadastre a grade antes de testar pedidos: nenhum estoque foi inventado. Produtos novos, preços, recuperação de senha e checkout real ficam para a próxima etapa.

Execute `node server.cjs` na pasta ecommerce para iniciar novamente. Requer Node 24 (SQLite integrado). Mantenha o processo em execução enquanto usa o site. Abrir index.html diretamente não habilita as contas.

Dados persistem em `data/store.sqlite`, fora da pasta pública e ignorados no Git. Senhas usam scrypt com salt; sessões de 24 horas usam cookie HttpOnly/SameSite e tokens armazenados por hash. As APIs verificam o perfil e limitam os pedidos ao titular. O servidor escuta somente em 127.0.0.1.

Para publicação futura, migrar banco e sessões para infraestrutura persistente, adaptar hospedagem, configurar HTTPS/cookies Secure, recuperação e verificação de e-mail, backups e políticas da loja. Não basta publicar dist na Vercel: a autenticação depende deste backend.

Validação: `node qa-accounts.cjs` usa banco temporário isolado e testa contas, permissões, mínimo de seis peças, histórico, edição de catálogo e telas desktop/mobile. Requer Puppeteer disponível no ambiente de desenvolvimento.

Validação de estoque: `node qa-inventory.cjs` testa disputa pela última unidade, rollback integral, cancelamento, reativação, edição concorrente e persistência após reinício, com banco temporário.

Fotos: no cadastro de cada peça, use “Adicionar fotos” (até 8 JPG/PNG/WebP de até 8 MB). O envio salva imediatamente, preservando os outros campos em edição. A primeira foto vira capa; use “Usar como capa” para trocar. As imagens são convertidas em WebP e salvas em data/photos. Remover desassocia do catálogo; arquivos continuam guardados para pedidos históricos. Ao remover todas, volta a imagem ilustrativa. A página do produto exibe a galeria. Dependência: sharp 0.34.5, instalar com npm install em novos ambientes.
