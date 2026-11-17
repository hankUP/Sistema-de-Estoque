# Controle de Estoque Gravae

Aplicação React com API Node.js e PostgreSQL. Cadastro, estoque, compras e produção usam o mesmo banco central. As regras de reservas, custo médio, histórico de preços e etapas de produção ficam no PostgreSQL.

## Instalação atual: este computador (Windows, sem Docker)

O sistema roda no próprio PC, usando o serviço PostgreSQL 17 instalado (`postgresql-x64-17`, banco `estoque`). Esse banco local é o oficial.

1. O `.env` na pasta do projeto contém a conexão com o banco (não vai para o Git).
2. Para atualizar a interface após mudanças no código: `npm run build`.
3. Para iniciar: `npm run server`. O sistema fica em `http://127.0.0.1:3001`, acessível apenas deste computador.

Como o acesso é local em `http`, o `.env` precisa de `COOKIE_SECURE=false`. Sem essa linha o cookie de login exige HTTPS.

## Alternativa: servidor central com Docker

1. Instale Docker com Compose no computador que ficará ligado para a equipe. Use uma pasta local fora do OneDrive para a instalação; o `.env` contém senhas.
2. Copie `.env.example` para `.env` e defina senhas fortes e diferentes em `PGPASSWORD` e `APP_PASSWORD`. `APP_PASSWORD` serve apenas para criar o primeiro Admin. O arquivo `.env` é ignorado pelo Git.
3. Execute `docker compose up -d --build` na pasta do projeto. O serviço aplica as migrações automaticamente na primeira inicialização.
4. Abra `http://127.0.0.1:3001` no servidor. Entre com o usuário `admin` e a senha inicial `APP_PASSWORD`; o sistema exigirá uma senha nova. Depois disso, remova `APP_PASSWORD` do `.env`.

### Usuários e grupos

Todas as telas exigem login individual. O Admin cria manualmente cada conta em **Usuários e acessos**, define o grupo e uma senha temporária. Não há cadastro público. Senhas são armazenadas com scrypt e sessões podem ser encerradas ao desativar a conta ou redefinir a senha.

| Grupo | Acesso |
| --- | --- |
| Admin | Todas as telas e gestão de usuários |
| Coordenador | Estoque, cadastros, compras (inclui recebimento e histórico de preços), fila e produção |
| Técnico | Consulta de estoque, movimentações e execução da produção |
| Operacional | Consulta de estoque, fila e produção; executa apenas ordens atribuídas à sua conta |

As permissões são aplicadas também na API. Somente Admin e Coordenador alteram ordens de produção (atribuir, voltar para planejada, envio, correção do montador); Técnico e Operacional apenas iniciam e concluem. O Coordenador ou Admin atribui uma ordem planejada ao usuário na tela **Produção**. A senha temporária deve ter pelo menos 8 caracteres e ser trocada no primeiro acesso. Sessões vencidas são apagadas automaticamente.

O Compose publica a aplicação somente no próprio servidor. Para acesso pela internet, crie um registro DNS A do seu domínio apontando para o IP público da instância, mantenha liberadas as portas 80 e 443 e defina `APP_DOMAIN` com o domínio completo no `.env` do servidor (o cookie de login já é seguro por padrão; não defina `COOKIE_SECURE=false` nesse caso). Inicie com `docker compose --profile production up -d --build`. O Caddy obtém e renova o certificado HTTPS automaticamente. Não publique as portas 3001 nem 5432. Os volumes `estoque_postgres`, `caddy_data` e `caddy_config` guardam os dados e devem ser incluídos na política de backup.

O banco novo é criado por `server/migrations/001_initial.sql`. Como ainda não havia dados para migrar, as 39 migrações históricas foram reunidas nesse esquema inicial. Se você chegou a iniciar uma versão anterior do servidor, recrie apenas o banco vazio antes de aplicar esta versão; não apague um volume que contenha dados sem fazer backup.

As áreas de dashboard, indicadores, implantação, análise de custos e relatórios foram removidas. A migração `002_remove_unused_sections.sql` elimina as tabelas e colunas exclusivas dessas áreas. Preços e custos unitários usados por estoque e compras permanecem para registrar entradas e calcular preços efetivos.

### Centros de custo e responsáveis

Cadastre setores ou pessoas em **Centros de Custo** no menu. Ao registrar uma movimentação manual, informe o centro. Nas compras e ordens de produção, escolha o centro ao criar a ordem; as movimentações geradas herdam essa atribuição.

**O responsável é sempre o usuário logado.** O nome não é digitado em nenhuma tela: o servidor registra quem está na sessão em movimentações, recebimentos de compra, ajustes, substituições e produção, e ignora qualquer nome enviado pelo navegador. O responsável de uma movimentação já registrada não pode ser alterado.

O recebimento de um pedido de compra é feito em uma única operação no servidor: entrada no estoque, registro do recebimento e novo saldo do pedido são gravados juntos, e recebimentos simultâneos do mesmo pedido não ultrapassam a quantidade pedida.

O cadastro inicial inclui Administrativo, Comercial, Financeiro, Marketing, Operacional, RH e Tecnologia como setores. Eles podem ser editados ou desativados em **Centros de Custo**.

No histórico de **Movimentações**, os filtros de **Setor** e **Pessoa** podem ser usados juntos. Setor corresponde ao centro de custo cadastrado como setor; Pessoa corresponde ao usuário registrado como responsável da movimentação.

No cadastro de um item, **Quantidade inicial em estoque** é opcional. Se houver saldo físico, informe a quantidade na unidade do item. O setor é opcional nesse cadastro; o responsável é o usuário logado. O sistema registra uma movimentação `INICIAL`; o estoque mínimo continua sendo apenas um limite de alerta.

Em **Posição de Estoque**, o botão **Editar** permite informar o saldo físico total após uma nova contagem. Se ele for diferente do saldo atual, o sistema registra apenas a diferença como movimentação `AJUSTE`, mantendo o histórico anterior. O setor é opcional nesse ajuste.

Quando o setor não é informado no cadastro ou ajuste de quantidade, a movimentação fica identificada como **Sem atribuição (cadastro)** no histórico. Movimentações antigas, anteriores ao login individual, podem aparecer como **Não informado (cadastro)**; esses valores não representam uma pessoa ou setor real.

Centros desativados deixam de aparecer para novos registros, mas continuam identificados no histórico e nas ordens já criadas. As migrações `003_movement_cost_centers.sql` e `004_allow_existing_orders_with_inactive_centers.sql` adicionam o vínculo, preservam ordens existentes e marcam movimentações antigas sem centro como histórico sem atribuição. Os nomes registrados manualmente antes do login individual permanecem como histórico e não comprovam quem realizou aquelas ações.

### Montagem com BOM

Em **Estruturas (BOM)**, selecione um produto final ou submontagem e cadastre seus componentes fixos. Com a estrutura pronta, clique em **Enviar à fila** no próprio produto. A janela pede quantidade, destino e centro de custo; para envio ao cliente, pede também o nome do cliente. A **Fila de Montagem** mostra os materiais, as faltas e a prioridade, que pode ser reordenada. A reserva não baixa o estoque físico. Cada variante de estrutura precisa de um produto cadastrado.

Em **Produção**, inicie a ordem: quem inicia fica registrado como montador. Se a ordem foi iniciada por outra pessoa (por exemplo, o Admin iniciou pelo operador), Admin ou Coordenador podem corrigir o montador na tela da ordem, escolhendo um usuário ativo; as movimentações continuam registrando quem realmente executou cada ação. Ao concluir, o servidor confere a fila, baixa os componentes e altera o status em uma transação. Uma BOM em uso por ordem ativa não pode ser alterada. Ordens concluídas por esta versão podem ser revertidas com suas movimentações exatas; conclusões anteriores exigem revisão manual.

**Submontagens (SUB)** são componentes intermediários: as ordens de produção delas têm destino obrigatório **Estoque**. **Produtos finais (PF)** podem ter destino **Cliente** ou **Estoque**. A regra é validada no banco; o histórico de ordens anteriores não é alterado.

O configurador de kits personalizados foi retirado da interface. Os kits concluídos e os rascunhos anteriores permanecem preservados no banco. Se algum kit antigo já estiver na fila ou em produção, ele ainda poderá ser finalizado pelo fluxo legado, sem permitir criar novos kits pela interface.

### Backup

**Instalação atual (este PC):** a tarefa agendada do Windows **Gravae - Backup do estoque** roda `scripts/backup-db.ps1` todo dia às 12:30 (ou assim que o PC for ligado, se estava desligado). O script gera o dump, confere se ele pode ser lido pelo `pg_restore` e mantém os últimos 14 dias em `backups\diario` (ao lado da pasta do projeto). Confira o `backup.log` dessa pasta: linhas com `ERRO` indicam falha.

```powershell
# Backup imediato
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# Com cópia para outra unidade (HD externo, OneDrive etc.)
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -CopiaExterna "E:\Backups\estoque"
# Restaurar um backup (substitui o conteúdo do banco: faça um backup antes)
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -h 127.0.0.1 -U estoque -d estoque --clean --if-exists "caminho\estoque-AAAA-MM-DD_HHMM.dump"
```

Mantenha também cópias fora deste computador. **Com Docker**, exemplo manual:

```powershell
docker compose exec db pg_dump -U estoque -d estoque -Fc -f /tmp/estoque.dump
docker compose cp db:/tmp/estoque.dump ./estoque.dump
```

Teste a restauração em uma instalação separada antes de depender dos backups. Evite copiar diretamente os arquivos do volume enquanto o banco está ativo.

## Desenvolvimento local

Requer Node.js 22.22.0 ou posterior e um PostgreSQL acessível. Copie `.env.example` para `.env` e ajuste `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` e `APP_PASSWORD` para a criação do Admin inicial.

```powershell
npm ci
npm run db:migrate
npm run server
```

Em outro terminal:

```powershell
npm run dev
```

O Vite abre em `http://127.0.0.1:8080` e encaminha `/api` para a API em `127.0.0.1:3001`. Para produção, `npm run build` gera `dist/`, servido pela API.

## Verificação

```powershell
npx tsc -p tsconfig.app.json --noEmit
npm run test
npm run test:server
npm run build
npm run lint
```

O teste do servidor executa todas as migrações em um PostgreSQL de teste em memória. Cada usuário entra com sua própria conta; movimentações antigas conservam os nomes informados na época.
