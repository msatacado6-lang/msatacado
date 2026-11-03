# Loja conectada ao ERP

Preparação local, sem publicação ou ativação. O modo padrão continua `LEGACY`.
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
Uma edição antiga não sobrescreve uma mudança feita no ERP. Fotos, parâmetros
fiscais e demais campos avançados já existentes são preservados.

Saldo é somente leitura no formulário conectado. Entradas, ajustes e fotos
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

Por padrão nenhuma variável ativa a integração. Não há push, CI remota, novo
domínio ou mudança de hospedagem nesta preparação. A hospedagem atual do código
continua suportada; migrar para Cloudflare/R2 é uma etapa separada.

## Validação local

`npm run build:fatek` recompila `dist/fatek-client.js` a partir do adaptador e do
cliente tipado. `npm run check` confere sintaxe; `npm run test:fatek` verifica
isolamento, configuração, DTO, paginação, perfil, incerteza de pedido e proxy
restrito. `npm test` mantém as suítes anteriores, com bancos temporários.
Puppeteer pode usar Chrome local por `PUPPETEER_EXECUTABLE_PATH`; não usar perfil
ou cookies de produção nos testes. A homologação externa real continua pendente.

Em rollback, pausar a conexão e a delegação de escrita no ERP antes do código.
Não voltar ao banco antigo como fallback para falha de API. Preservar produtos,
pedidos, IDs e intentos existentes. Voltar a `LEGACY` é mudança de fonte de dados
e exige reconciliação/autorização, não é um mecanismo automático de recuperação.
