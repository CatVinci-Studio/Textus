# Guia dos recursos de IA do Textus

O Textus tem uma IA integrada feita para a escrita, a Textus AI: autocompletar, verificação gramatical e conversas que leem e revisam o seu documento. Este guia mostra como conectar um serviço, como usar os recursos de IA e como adaptar a Textus AI ao seu jeito de escrever com uma pasta, um perfil de estilo, uma biblioteca, instruções de escrita e habilidades.

## Como conectar um serviço

Tudo sobre a IA fica em **Ajustes › Textus AI**, em quatro páginas: **Modelos**, **Ajuda na escrita**, **Agente** e **Ferramentas externas**.

1. Em **Modelos**, escolha o serviço na lista **Provedores**. Entre na sua conta (**Conta**) ou cole uma chave (**Chave de API**), conforme o que o serviço oferece. Um ponto na lista marca cada serviço que você já configurou.
2. Para um **Endpoint personalizado** (qualquer servidor compatível com a API da OpenAI: modelos locais, proxies), digite a URL base, uma chave se ele exigir e o nome do modelo, e salve.
3. Em **Escolha do modelo**, no topo da mesma página, escolha o **Provedor do chat** e o **Modelo do chat** e, para o autocompletar e a gramática, o **Provedor da escrita** (**Igual ao chat** por padrão) e o **Modelo auxiliar**.

O login acontece no seu navegador. O suporte a imagens, busca na web e edições no documento depende do serviço e do modelo escolhidos.

A lista de modelos integrada traz só os modelos padrão de cada provedor (na Anthropic: Claude Sonnet 5.5 para o chat e Claude Haiku 5.5 para o autocompletar e a verificação gramatical). Em **Modelos**, dentro de um provedor, clique em **Buscar Modelos** para carregar a lista atual dele e escolher qualquer modelo dela.

Para o **Doubao (Volcengine)**, crie a chave de API no [console do Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) e, nesse mesmo console, ative os modelos que quer usar: o Ark recusa pedidos a um modelo que sua conta não ativou.

Os atalhos abaixo usam a notação do macOS; no Windows e no Linux, leia Cmd como Ctrl e Option como Alt. Se você mudou um atalho, **Ajustes › Atalhos** mostra o atual.

## O uso no dia a dia

As cinco maneiras que você mais vai usar, a começar por conversar com ela.

### Conversas

As conversas abrem como **abas**. Clique no botão **Textus AI** (as faíscas) na ponta direita da barra da janela, pressione <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> ou escolha **Visualizar › Painel de IA**: a IA abre numa ilha própria à direita. As abas dela são abas como as outras: arraste uma para o lado de um documento, para outra ilha ou para fora, numa janela própria.

- **Por pasta**: as conversas pertencem à pasta em que você trabalha, não a um documento. Cada conversa aberta é uma aba; a que está na frente é aquela com que você está falando, sobre o documento que está na frente. Uma conversa fechada continua no histórico.
- **Nova conversa**: clique com o botão direito no papel vazio de uma aba de IA e escolha **Nova conversa** (se ainda houver edições sem decisão, o app pergunta antes). **Memória** fica no mesmo menu.
- **Histórico**: o relógio no canto superior direito de uma aba de IA lista as conversas anteriores agrupadas por pasta, com **Pesquisar conversas** no topo para achar aquelas em que certas palavras foram ditas. Clique em uma para reabri-la. Quando você se refere a uma conversa anterior, a Textus AI também pesquisa nelas. Em **Ajustes › Privacidade e dados** você pode deixar de salvar as conversas.
- **Modo e modelo**: um botão entre os controles do campo mostra as duas coisas, "Geral · modelo". **Geral** trabalha no documento: redige texto novo (uma continuação, um parágrafo ou uma seção nova) e altera o texto que já existe (reescrever, traduzir, cortar). Com texto selecionado, uma mudança nele o substitui, e texto novo vai depois dele. **Revisar** responde, conversa e deixa comentários sem mudar nada. **Pesquisa** recebe um tema, pesquisa sobre ele e o redige como um texto (veja **Pesquisa** abaixo). A lista também traz todos os modelos dos serviços que você configurou e os **Agentes** que você adicionou (veja **Agentes externos**). Uma conversa nova começa em Revisar; depois, o campo mantém o último modo que você escolheu.
- **Menções com @**: digite `@` no campo para escolher um arquivo de texto da pasta; ele é anexado à mensagem.
- **Anexar arquivos**: o botão **+** à esquerda do campo anexa à mensagem um ou mais arquivos: um PDF, um documento do Word, uma apresentação do PowerPoint, uma planilha, um livro EPUB, um arquivo RTF ou HTML, qualquer arquivo de texto ou de código, um arquivo zip ou uma imagem (PNG, JPEG, GIF, WebP, BMP, TIFF e, no Mac, HEIC e AVIF). Cada arquivo é copiado para a pasta temporária própria da conversa, nunca para as suas pastas, e a Textus AI pode lê-lo ali de novo por inteiro. Os documentos são convertidos em texto no seu computador e vão dentro da mensagem; um documento longo é enviado só em parte, o anexo mostra "(parcial)" e a Textus AI lê o resto quando precisa. Um arquivo zip é descompactado ali e seus arquivos são listados. As imagens são convertidas para um formato que qualquer serviço lê, reduzidas quando são muito grandes e enviadas como imagens de verdade aos provedores que conseguem vê-las (os que não conseguem avisam na hora, em vez de descartá-las sem dizer nada).
- **Busca na web**: o botão da lupa ao lado do campo de texto deixa a Textus AI buscar na web quando um pedido precisar; veja **Busca na web** abaixo.
- **Raciocínio profundo**: o botão ao lado da busca na web (a lâmpada) pede ao modelo que pense bem na resposta antes de responder — mais lento e mais caro, para perguntas difíceis e reescritas maiores. Ele fica ligado, também em outros documentos, até você clicar nele de novo. Enquanto o modelo pensa, a aba mostra "Pensando · 8 segundos" e depois "Pensou por 12 segundos", que você pode clicar para ler o raciocínio quando o provedor o compartilha. O botão só aparece para modelos que conseguem pensar mais a fundo; a Pergunta rápida sempre pede uma resposta rápida.
- **Erros**: quando uma solicitação falha, o Textus diz no seu idioma que tipo de problema houve e o que fazer (verificar a chave, recarregar um saldo que acabou, esperar um pouco, escolher outro modelo), acima da mensagem do próprio provedor — no chat e também no autocompletar e na verificação gramatical.
- **Documentos longos**: quando você pede para traduzir ou reescrever um documento longo capítulo por capítulo, a Textus AI entrega cada capítulo a um ajudante próprio, com uma lista comum de como os nomes e termos recorrentes são escritos, e assim o documento inteiro muda de uma vez.

### Alterações nos seus documentos

**Ajustes › Textus AI › Ajuda na escrita › Como o Textus AI altera arquivos** decide como as alterações da Textus AI chegam ao seu texto:

- **Como revisões para revisar** (o padrão): cada alteração é uma revisão mostrada onde entraria, e nada é definitivo até você aceitar.
- **Escritas direto**: as alterações são escritas conforme chegam. Elas ficam marcadas, para você ver o que mudou, e cada resposta pode ser desfeita.

Um texto de Pesquisa é escrito direto de qualquer forma. <kbd>Cmd</kbd>+<kbd>Z</kbd> desfaz uma alteração aceita de uma só vez.

**Como as revisões aparecem**: **Mostrar revisões** (em Ajuda na escrita, ou o botão do olho na barra de revisão) tem três visualizações:
- **Só o resultado, original na margem** (o padrão);
- **Original no texto, alterações na margem**;
- **Tudo no texto**: o texto removido riscado, o texto novo em verde.

O texto novo sempre aparece no texto. Sem espaço para uma margem (janela estreita, com a barra lateral e a IA abertas), as visualizações com margem esperam e o texto mostra tudo.

- **A barra de revisão**: uma única barra no pé do documento reúne tudo o que está pendente ali, alterações e notas. Percorra os itens com ‹ › (ou <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd>), use **Aceitar** ou **Rejeitar** em cada um, ou **Aceitar todas** / **Rejeitar todas**. Cada frase alterada também tem ✓ / ✕ no texto; aceite só algumas e a barra mostra "Aceitar 2 de 5". Pelo teclado: <kbd>Cmd</kbd>+<kbd>Return</kbd> aceita, e <kbd>Cmd</kbd>+<kbd>Delete</kbd> com o cursor sobre uma alteração a rejeita.
- **Motivos**: cada cartão de proposta na conversa diz por que a Textus AI fez aquela alteração.
- **No cursor**: sem nada selecionado, a Textus AI sabe onde está o seu cursor, então "escreva uma transição aqui" insere o texto exatamente ali.
- **Comentários em vez de edições**: peça uma revisão ("o que está fraco aqui?") e a Textus AI fixa comentários nos trechos sem alterá-los. Cada cartão de comentário tem **Mostrar no documento**, que seleciona o trecho a que ele se refere.
- **As suas próprias notas**: selecione algumas palavras, clique com o botão direito e escolha **Adicionar nota**: a sua nota vai para a margem ao lado das da Textus AI, marcada como Eu. As notas ficam junto aos dados do próprio Textus, não no seu Markdown.
- **Controlar minhas alterações** (menu Visualizar): enquanto está ligado, as suas próprias edições também aparecem como alterações (o que você apagou, riscado; o que você acrescentou, marcado), cada uma com um cartão na margem, marcado como Eu, para aceitar ou rejeitar. O arquivo guarda o original, só com as alterações que você aceitou; as que faltam decidir ficam ao lado, na pasta `.textus`, como as da Textus AI, e voltam quando você abre o documento de novo: compartilhe a pasta e elas vão junto.

**Outros arquivos da pasta**: a Textus AI pode alterar arquivos que você não tem abertos.

- **Como revisões para revisar**: uma alteração num desses arquivos fica esperando nele como revisões. Elas entram no texto quando você o abre, para aceitar ou rejeitar como acima. A árvore de arquivos e a aba do arquivo o marcam: "3 para revisar".
- **Um arquivo novo que ela cria** espera a sua decisão: **Manter** fica com ele, **Descartar** o descarta (ele vai para a Lixeira).
- **Escritas direto**: a alteração é escrita na hora, e o texto anterior é guardado para que possa ser desfeita.
- **O cartão da resposta** lista os arquivos que ela alterou, com **Desfazer**, **Aplicar**, **Manter** e **Descartar**. Um arquivo que você editou nesse meio-tempo mantém a alteração à parte, marcada como "Alterado desde então"; **Dispensar** a deixa de lado.

### Autocompletar

Enquanto você digita, uma continuação em cinza aparece no cursor. Pressione <kbd>Tab</kbd> para aceitá-la, ou <kbd>Cmd</kbd>+<kbd>→</kbd> para aceitar só a próxima palavra e manter o resto como sugestão. <kbd>Esc</kbd> descarta a sugestão. Não há quantidade mínima de texto: o autocompletar funciona desde a primeira frase do documento.

Peça uma continuação quando quiser com <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> ou pelo menu de contexto (o cursor precisa estar no fim de um parágrafo): você recebe uma continuação mais longa, com até três alternativas, e <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> passam de uma para outra.

Em **Ajustes › Textus AI › Ajuda na escrita › Continuar e revisar**, você pode ligar ou desligar o autocompletar e escolher um **Tom do autocompletar** (Seguir o documento / Formal / Informal / Acadêmico / Conciso). Quando o documento pertence a uma pasta com perfil de estilo ou biblioteca (veja **Personalize a Textus AI**, mais abaixo), o autocompletar também segue esses arquivos.

### Verificação gramatical

Possíveis problemas aparecem sublinhados. Passe o ponteiro sobre um deles, ou leve o cursor até ele, para ver a explicação; **Aplicar** (ou <kbd>Option</kbd>+<kbd>Enter</kbd> com o cursor sobre o trecho) aceita a correção, e **Ignorar** a descarta. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> verifica o parágrafo atual na hora. **Nível de verificação** (Ajuda na escrita › Continuar e revisar) define quanto ela aponta.

### Pergunta rápida

Pressione <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (ou clique com o botão direito › **Perguntar à IA…**) para abrir uma pequena barra de chat logo abaixo do parágrafo em que você está. Ela fica dentro do documento e empurra o texto seguinte para baixo, em vez de cobri-lo. Se havia texto selecionado quando você a abriu, a seleção vai junto. A Pergunta rápida abre no modo **Geral**, porque normalmente é aberta sobre um trecho que você quer mudar ("encurte isto"); Revisar está a um clique, no seletor de modo.

- **O atalho de novo**: pressionar <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> com a barra aberta leva o cursor para o campo dela; pressionar mais uma vez, a partir do campo, fecha a barra. <kbd>Esc</kbd> em qualquer ponto da barra também a fecha, e o cursor volta ao documento. Se ainda houver edições sem decisão, o app pergunta antes de fechar a barra (ou de começar uma nova conversa).
- A Pergunta rápida tem a sua própria conversa curta, separada da das abas de IA e não salva no histórico. **Continuar na conversa completa** (o botão no canto dela) passa a conversa para uma aba de IA, onde ela segue e fica salva.

## Personalize a Textus AI

A Textus AI aprende sobre você e o seu trabalho a partir de alguns arquivos Markdown comuns, e não de configurações escondidas. Cada um tem uma função:

| Conceito | O que é | Onde fica |
| --- | --- | --- |
| **Pasta** | A pasta em que a Textus AI trabalha e que ela pode ler | A pasta que você abre na barra lateral ou uma que você escolher |
| **Perfil de estilo** | Como você escreve | `.textus/style.md` |
| **Biblioteca** | Fatos sobre pessoas, lugares e termos | `.textus/library/` |
| **Instruções de escrita** | Regras fixas para toda conversa | `agent.md`, global e por pasta |
| **Memória** | O que a Textus AI guarda das suas conversas | `memory/` na pasta de configuração global e, ao lado, `projects/<pasta>/memory/` para cada pasta |
| **Habilidades** | Instruções reutilizáveis que você chama com `/nome` | `skills/`, global e por pasta |
| **Pasta de configuração global** | O que vale para todos os documentos | A pasta de configurações do app |

Daqui em diante, "conversas" quer dizer as abas de IA e a Pergunta rápida. Veja uma pasta inteira de relance:

```
meu-romance/             ← a pasta
├── capitulo-1.md        ← o documento que você está editando
├── notas/
│   └── cronologia.md    ← material de referência que a Textus AI pode ler
└── .textus/              ← as configurações da própria pasta
    ├── style.md         ← perfil de estilo
    ├── agent.md         ← instruções de escrita desta pasta
    ├── library/
    │   ├── lin-wan.md   ← uma entrada por personagem, lugar ou termo
    │   └── harbour-city.md
    └── skills/
        └── polir.md     ← uma habilidade por arquivo
```

O menu da pasta cria a pasta `.textus/` e os arquivos dela na primeira vez que você precisa deles; as habilidades da pasta são a única coisa que você adiciona à mão. Em qualquer um desses arquivos, o texto dentro de comentários `<!-- -->` é uma nota para você mesmo e nunca é enviado.

### A pasta

**A pasta é aquela em que a Textus AI trabalha.** É a pasta que você abre na barra lateral (**Arquivo › Abrir Pasta…**) ou uma que você escolher; se não houver nenhuma, é a pasta mais próxima acima do documento que tenha uma pasta `.textus/`, de modo que um capítulo em `novel/part-1/` pertence a `novel/`. Um documento que você abre sozinho não tem pasta: a Textus AI lê então só o documento e os arquivos que você anexar, e assim um arquivo em Downloads ou na Mesa nunca abre para ela essa pasta inteira.

- A Textus AI pode listar, encontrar pelo nome, ler e buscar os arquivos dessa pasta para encontrar as cenas anteriores de um personagem, um termo ou as suas notas: arquivos de texto (Markdown, texto simples e formatos parecidos) de até 16 MB, que ela lê por partes quando são longos, e o texto de arquivos PDF, Word, PowerPoint, EPUB, RTF e de planilhas. Com um provedor que consegue ver imagens, ela também vê as imagens PNG, JPEG, GIF e WebP da pasta, de até 6 MB cada. Arquivos e pastas ocultos, o que um arquivo `.gitignore` ou `.ignore` exclui (como na busca de arquivos da barra lateral), pastas de build e de dependências (como `node_modules`) e PDFs digitalizados sem camada de texto ficam de fora.
- Digitar `@` no campo do chat anexa um dos arquivos dela à sua mensagem.
- A pasta `.textus/` dela guarda o perfil de estilo, a biblioteca, as instruções de escrita e as habilidades da pasta.

Clique com o botão direito no papel vazio de uma aba de IA e escolha **Memória**: a linha do topo mostra o nome da pasta; clique nela para abrir o **menu da pasta**. Quando o seu material de referência não está ao lado do rascunho, use **Escolher pasta…** nesse menu (ou **Ajustes › Textus AI › Agente › Pasta**). A pasta escolhida vale para todos os documentos, inclusive rascunhos não salvos, até você escolher **Não usar nenhuma pasta**.

> [!TIP]
> Seu rascunho está em `tese/rascunhos/` e as notas das entrevistas em `tese/pesquisa/`? Escolha `tese/` como pasta, e a Textus AI poderá ler `pesquisa/entrevistas.md` enquanto você trabalha em `rascunhos/capitulo-2.md`.

Tudo o que a Textus AI lê precisa estar dentro da pasta: `..`, caminhos absolutos e links que apontam para fora são recusados. Sem uma pasta aberta ou escolhida não há pasta, e uma pasta ampla demais (sua pasta pessoal ou um disco inteiro) é recusada. O que a Textus AI cria enquanto trabalha (notas de pesquisa, rascunhos em andamento) vai para as pastas próprias do Textus ou para a pasta temporária do sistema, não para a sua.

### O perfil de estilo — "Aprender meu estilo"

**O perfil de estilo descreve como você escreve**, para que as continuações e edições soem como você: voz e tom, ritmo das frases, escolha de palavras, pontuação, o que você nunca faz. A Textus AI o segue nas conversas, e o autocompletar o segue enquanto você digita, em todos os documentos da pasta. Ele é o arquivo `.textus/style.md`.

Há duas maneiras de criar um, ambas no menu da pasta:

- **Aprender meu estilo com amostras…**: escolha alguns arquivos com textos seus (até oito). A Textus AI estuda esses textos e faz um rascunho do perfil (voz e tom, frases e ritmo, escolha de palavras, pontuação, estrutura, o que você nunca faz e algumas citações curtas como exemplos), que abre em uma nova aba. Leia, corrija, complete: o perfil é seu. Ao aprender de novo, a Textus AI guarda o perfil anterior como `style.previous.md`.
- **Criar perfil de estilo**: comece de um esboço vazio e escreva tudo você mesmo.

Quando já existe um perfil, **Abrir perfil de estilo** no menu da pasta (e a linha do estilo em Memória) abre o arquivo.

```markdown
# Perfil de estilo

## Frases e ritmo
- Frases curtas, raramente com mais de 15 palavras.
- Abre o parágrafo com uma cena concreta e só depois traz a ideia.

## Nunca
- Nada de pontos de exclamação. Nada de “de repente”.
```

Pontos concretos e verificáveis funcionam melhor do que adjetivos: "frases curtas, raramente com mais de 15 palavras" em vez de "conciso". Mantenha o perfil em uma ou duas páginas; só os primeiros 6.000 caracteres são usados. O **Tom do autocompletar** nos Ajustes também vale; deixe em *Seguir o documento* quando o seu perfil de estilo já descreve a sua voz.

### A biblioteca

**A biblioteca guarda fatos que precisam se manter coerentes**: um arquivo Markdown por personagem, lugar ou termo, em `.textus/library/`. **Nova entrada na biblioteca…**, no menu da pasta, pede um nome e abre a nova entrada; Memória lista todas.

```markdown
---
name: Lin Wan
aliases: [Wan, professora Lin]
include: detected
---

Protagonista, 32 anos, professora de chinês em uma escola de ensino médio de Harbour City.
Canhota. Nunca fala do irmão.
```

Você não precisa anexar entradas. Uma entrada com `include: detected` (o padrão) vai para a Textus AI sempre que o nome dela ou um dos nomes alternativos (`aliases`) aparece: na sua mensagem ou no documento, durante uma conversa, e no texto em volta do cursor, durante o autocompletar. `always` envia a entrada em toda solicitação; `never` a deixa de fora. Entradas que não são mencionadas não custam nada, então a biblioteca pode crescer o quanto o seu projeto precisar.

### Instruções de escrita (agent.md)

**Instruções de escrita são regras fixas enviadas em toda conversa**: do que se trata a pasta, em que idioma responder, grafias e termos, o que a Textus AI deve sempre ou nunca fazer. Elas ficam em arquivos chamados `agent.md`, em dois níveis:

- **Global**, para todos os documentos: **Ajustes › Textus AI › Agente › Instruções de escrita (agent.md) › Editar agent.md**.
- **Pasta**, para os documentos de uma pasta: `.textus/agent.md`, que se abre com **Editar instruções de escrita da pasta**, no menu da pasta.

Os dois abrem em uma aba e começam com um breve guia em comentários. Quando os dois existem, a Textus AI recebe ambos (primeiro as instruções globais, depois as da pasta) e, onde eles divergem, valem as da pasta.

```markdown
O livro é um romance policial ambientado na Xangai dos anos 1930, narrado por Lin Wan em primeira pessoa.
Responda sempre em português, mesmo que o romance seja em inglês.
Escreva “Harbour City”, nunca “Harbor City”.
```

As instruções de escrita valem só para as conversas. O autocompletar não as lê; ele segue o perfil de estilo e a biblioteca.

### O que a Textus AI lembra

**A Textus AI lembra o que você pede e como você escreve**, sem que você precise escrever um arquivo. Quando você diz algo que deve valer além de um pedido ("sempre com a grafia de Portugal", "sem travessões", uma correção que você teve de fazer duas vezes) ou um fato sobre a sua obra, como quem é um personagem, ela guarda isso e segue nas conversas seguintes. A cada vez, uma linha abaixo da resposta diz o que ela lembrou e onde: **Desfazer** volta atrás, e **Tornar global** ou **Só para esta pasta** muda o lugar.

- **Esta pasta**: o que é sobre esta obra, em `projects/<pasta>/memory/` na pasta de configuração global (o Textus guarda isso ali, não na sua pasta); fatos sobre pessoas, lugares e termos vão para a biblioteca.
- **Para todas as pastas**: os seus hábitos gerais, em `memory/` na pasta de configuração global. Sem pasta, tudo vai para cá.

**Memória** (clique com o botão direito no papel de uma aba de IA › Memória) lista tudo, com quando e em qual conversa cada item foi lembrado: **Editar** abre, **Apagar** remove. De tempos em tempos, a Textus AI organiza a memória, juntando memórias que dizem a mesma coisa e descartando uma regra que outra mais nova anulou; o que ela descartou fica em **Esquecido recentemente**, para você recuperar. As suas próprias instruções de escrita vencem quando as duas discordam, e a Textus AI nunca altera o seu `agent.md` nem o seu perfil de estilo. Quando há memórias demais para enviar, as mais antigas ficam de fora e Memória avisa. O interruptor **Memória** (Ajustes › Textus AI › Agente) desativa o recurso.

**Também aprende com as suas escolhas de revisão.** Quando você recusa várias vezes o mesmo tipo de alteração — 「」 trocadas por “”, uma palavra trocada por outra, frases divididas, uma vírgula de Oxford acrescentada —, a Textus AI oferece, ao fim da revisão, lembrar isso como requisito: **Lembrar** guarda em **Memória**, **Agora não** espera por mais casos e **Não perguntar mais** deixa de perguntar sobre esse tipo. Pergunta no máximo uma vez por dia, e nada é guardado sem o seu clique, também com a memória desligada. O que conta é só uma nota curta dos tipos de alteração que você aceitou ou recusou, guardada neste computador junto às suas memórias e nunca enviada.

### Habilidades (/nome)

**Uma habilidade é um conjunto de instruções reutilizável, com um nome** ("polir", "esboço", "conferir as citações"), guardado em um arquivo Markdown: um nome e uma descrição de uma linha no topo e, abaixo, as instruções completas.

```markdown
---
name: polir
description: Deixa o trecho selecionado mais enxuto, sem mudar o sentido
---

Revise o texto recebido frase por frase: corte palavras redundantes,
divida frases longas demais e mantenha o sentido e a voz originais.
Devolva apenas o texto revisado.
```

Há duas maneiras de usar uma habilidade:

1. **Chamar pelo nome**: digite `/` no campo do chat e escolha a habilidade no menu, ou digite o nome dela seguido do seu pedido: `/polir dê mais uma olhada nisto`.
2. **Só pedir** (apenas em provedores com chamada de ferramentas): a Textus AI conhece o nome e a descrição de cada habilidade e, quando o seu pedido corresponde a uma delas, carrega as instruções completas e as segue por conta própria.

Quando o que você pediu era um procedimento seu, passos que você vai querer de novo, a Textus AI oferece, abaixo da resposta, guardá-lo como habilidade, para todos os documentos ou só para esta pasta. Nada é guardado a menos que você escolha.

As habilidades ficam nos mesmos dois níveis que as instruções de escrita: as globais na pasta `skills/` da pasta de configuração global (**Importar Habilidade…**, no topo de Habilidades em **Ajustes › Textus AI › Agente**, copia um arquivo de habilidade para lá) e as da pasta em `.textus/skills/` (uma pasta oculta; no Finder do macOS, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> a mostra). Uma habilidade da pasta com o mesmo nome de uma global substitui a global.

### Habilidades integradas

O Textus traz quatro habilidades. **Revisar**, no modo Revisar, verifica ortografia, gramática, pontuação e números segundo as normas do idioma do texto. **Criar um tema**, **Criar um plugin** e **Criar uma habilidade** fazem um tema para o editor, um pequeno plugin ou uma habilidade sua a partir da sua descrição, numa aba própria: **Crie seu tema** fica na loja de temas de Aparência, e **Crie seu plugin**, no menu **⋯** do painel Plugins. Mais habilidades — expandir, enxugar, traduzir, resumir, verificar continuidade, e-mail, ata de reunião e outras — estão em **Disponíveis**, no fim de Habilidades em **Ajustes › Textus AI › Agente**. Digite `/` e escolha uma, ou digite o nome dela em qualquer idioma do app: `/proofread`, `/校对` e `/校正` chamam a mesma habilidade. A Textus AI também escolhe uma sozinha quando o seu pedido combina com ela. **Criar um tema** coloca o CSS do tema na resposta: **Usar este tema**, logo abaixo, instala o tema; ou salve-o como arquivo .css e adicione com **Adicionar um tema de um arquivo CSS** em **Ajustes › Aparência**.

As habilidades integradas abrem a lista de Habilidades em **Ajustes › Textus AI › Agente** e estão sempre ativas. **Personalizar…** copia uma para a pasta `skills/` da pasta de configuração global e abre a cópia para você mudar as instruções; dali em diante, é a sua cópia que roda. **Restaurar** apaga a cópia e traz de volta a versão integrada. Abaixo delas ficam as habilidades que você adicionou. Cada uma indica os modos em que funciona (clique para mudar), e o interruptor ao lado a desativa por enquanto; os modos ficam guardados para quando você a ativar de novo. Uma habilidade sua com o nome de uma integrada substitui a integrada.

### Normas de escrita

**Normas de escrita** (Ajustes › Textus AI › Ajuda na escrita › Continuar e revisar) define quais regras de pontuação, espaços e números a Textus AI e a verificação gramatical seguem. **Automático** aplica a norma nacional quando o idioma tem uma (GB/T para o chinês simplificado e JTF para o japonês, por exemplo); nos outros casos, segue o que o seu documento já faz com mais frequência e aponta só as inconsistências. Ao escolher um perfil, como **Ficção** em chinês simplificado ou **Reino Unido · GOV.UK** em inglês, os documentos nesse idioma passam a seguir esse perfil.

Uma pasta pode ter a própria escolha: adicione uma linha `conventions:` entre as duas linhas `---` no início do perfil de estilo (`.textus/style.md`). Nos documentos dessa pasta, ela vale mais que o ajuste.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### A pasta de configuração global

**A pasta de configuração global guarda o que vale para todos os documentos**: o seu `agent.md` global e as suas habilidades globais. Ela pertence ao app, não a uma pasta; **Ajustes › Textus AI › Agente › Pasta de configuração global › Mostrar** a mostra.

```
agent/                ← a pasta de configuração global
├── agent.md          ← instruções de escrita globais
└── skills/
    └── esboco.md     ← uma habilidade global
```

Não existe perfil de estilo nem biblioteca global: eles descrevem uma obra específica, então pertencem a uma pasta.

### O que vale em cada caso

| | Conversas | Autocompletar | Verificação gramatical |
| --- | :---: | :---: | :---: |
| Arquivos da pasta (ler, buscar, `@`) | ✓ | | |
| Perfil de estilo | ✓ | ✓ | |
| Entradas da biblioteca mencionadas | ✓ | ✓ | |
| Instruções de escrita | ✓ | | |
| O que a Textus AI lembrou | ✓ | | |
| Habilidades | ✓ | | |
| Tom do autocompletar (Ajustes) | | ✓ | |

- **Global primeiro, pasta depois.** As instruções de escrita dos dois níveis são enviadas, as da pasta por último, e as da pasta vencem em caso de conflito. Uma habilidade da pasta substitui uma global com o mesmo nome.
- **Uma pasta por vez.** Só a `.textus/` dela conta: quando você escolheu uma pasta, uma `.textus/` ao lado do documento não é lida.
- **Não é preciso reiniciar.** Edite qualquer um desses arquivos e a próxima solicitação já usa a nova versão (no autocompletar, em cerca de dez segundos).

### Qual arquivo para quê?

- Como o seu texto deve soar → o **perfil de estilo**.
- Quem é quem, o que é o quê → a **biblioteca**.
- O que a Textus AI deve saber ou sempre fazer em uma conversa → as **instruções de escrita**.
- Uma tarefa que você pede várias vezes → uma **habilidade**.
- Notas, pesquisa, capítulos anteriores → arquivos comuns na **pasta**; a Textus AI os lê quando um pedido precisa deles.

## Mais

### Pesquisa

Escolha **Pesquisa** no botão de modo e envie um tema em vez de um pedido: a Textus AI pesquisa sobre ele (na web, na sua pasta, nos artigos que você anexar), monta um esboço e escreve o texto no documento. Digite `/` para escolher o tipo de texto (um ensaio, um relatório, uma revisão bibliográfica e outros), ou deixe em **Escolher por mim**. **Pesquisar com subagentes** (Ajuda na escrita) deixa que ela divida partes da pesquisa entre ajudantes que trabalham ao mesmo tempo; **Verificar citações** faz cada frase citada ser conferida com as fontes antes de o texto ficar pronto. O texto é escrito direto no documento, seja qual for o ajuste de **Como o Textus AI altera arquivos**.

### Busca na web

Ative o botão **Busca na web** ao lado do campo de texto, e a Textus AI pesquisa na web quando um pedido precisa de fatos atuais ou de que ela não tem certeza. Ela também pode ler uma página cujo endereço você colar.

- **Quem busca**: os modelos que buscam sozinhos — OpenAI, Claude, Grok, OpenRouter, Groq, Qwen e Zhipu GLM — usam a própria busca. Com qualquer outro modelo (DeepSeek, Gemini, Mistral, Kimi, modelos locais, endpoints personalizados), quem busca é o Textus, com o **Serviço de busca** escolhido em **Ajustes › Textus AI › Ajuda na escrita › Web e proxy**: **Automático** usa uma chave da DeepSeek, Zhipu ou Kimi que você já salvou para o chat; ou escolha Bocha, Tavily, Brave Search ou Exa e cole a chave dele, ou SearXNG e informe o endereço do seu próprio servidor. A linha mostra para onde vão as suas buscas. Sem nada com que buscar, o botão mostra um ponto vermelho.
- **Fontes**: a resposta cita o que encontrou como [1], [2] e lista essas páginas embaixo; clique em uma para abri-la no navegador. Os números continuam os mesmos durante toda a conversa.
- **Fontes como notas de rodapé**: quando uma proposta se baseia na web, o cartão dela mostra **Adicionar as fontes como notas de rodapé**. Marcado, aceitar adiciona notas de rodapé em Markdown com as fontes no fim do documento; desmarcado, o texto entra sem elas. O cartão lembra a sua última escolha.
- **Páginas são lidas, não obedecidas**: o que uma página diz nunca é uma instrução para a Textus AI, que continua só propondo edições. O Textus lê apenas páginas da web pública, nunca do seu computador ou da sua rede local.

### Imagens

A Textus AI pode criar imagens para o seu documento. **Serviço de imagens** (Ajustes › Textus AI › Modelos › Escolha do modelo) segue por padrão o seu provedor do chat: com login no ChatGPT, as imagens saem da cota do seu plano (marcado como experimental, pois não é uma API publicada); com outro provedor que cria imagens, as dele, com a mesma chave. Um provedor que não cria imagens não oferece nenhuma até você escolher um serviço (OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow ou qualquer endpoint compatível com OpenAI) e depois o modelo dele.

- Peça no modo Geral ("adicione uma imagem do porto depois do primeiro parágrafo"), ou clique com o botão direito num parágrafo e escolha **Ilustrar este parágrafo**.
- Texto e imagens chegam juntos: o texto aparece à medida que é escrito, e cada imagem aparece como um quadro que se move suavemente no lugar dela até ficar pronta. Você pode aceitá-la antes de terminar; ela é salva quando chega.
- Nada é salvo até você aceitar: aí a imagem é salva como **Ajustes › Edição › Imagens** diz para uma imagem colada e inserida como imagem Markdown. Rejeitar não deixa nada.
- Para que uma imagem proposta seja desenhada de novo, aponte para ela e escolha **Redesenhar…**, depois diga o que deve mudar; só aquela imagem é redesenhada. As imagens de um mesmo texto mantêm as mesmas pessoas e o mesmo visual: quem aparece de novo é descrito com as mesmas palavras e, quando o modelo de imagem aceita uma imagem de referência, uma nova imagem dessa pessoa parte de uma anterior.
- Para mudar uma imagem, clique nela com o botão direito e escolha **Mudar esta imagem com o Textus AI…**, depois diga como. A nova é proposta no lugar dela; quando você a aceita, o app pergunta se o arquivo antigo deve ir para a Lixeira — ele fica, a menos que você diga o contrário.
- Diga quantas imagens você quer e a Textus AI cria essa quantidade, até **Imagens por pedido** (Modelos › Escolha do modelo; duas, se você não mudar). Se o serviço recusar uma descrição, o lugar da imagem mostra o motivo que ele deu.

### Agentes externos

Agentes de programação como Claude Code ou Codex podem trabalhar no Textus por meio de plugins. Depois de adicionado, um agente ganha um botão ao lado do botão Textus AI na barra da janela e aparece no grupo **Agentes** do botão de modo: escolha-o, e as suas mensagens vão para ele em vez de para um modelo. Antes de alterar um arquivo, ele pergunta a você, na conversa. **Ajustes › Textus AI › Ferramentas externas** os lista em **ACP Agent** (**Obter agentes…** abre o painel Plugins) e, acima deles, os **Servidores MCP** cujas ferramentas a Textus AI pode usar.

## Desativar a Textus AI

Clique com o botão direito no botão **Textus AI**, na ponta direita da barra da janela, para pausar a Textus AI por uma hora ou desativá-la. Enquanto está desativada, as faíscas aparecem riscadas, e um clique no botão oferece ativá-la de novo; uma pausa termina sozinha depois da hora. A paleta de comandos (**Ativar ou desativar Textus AI**) e um atalho que você pode definir em **Ajustes › Atalhos** também fazem isso; no iPhone, fica no menu.

Enquanto está desativada, nada é enviado a nenhum serviço de IA desde que o Textus abre: nem autocompletar, nem verificação gramatical, nem conversa, nada é lembrado. As abas de IA, a Pergunta rápida e os itens de IA do menu de contexto somem, e uma resposta que ainda estava sendo escrita para. As edições já propostas no documento continuam, para você aceitar ou rejeitar. Cada recurso mantém a própria configuração, e todos voltam a valer assim que a Textus AI é ativada de novo.

## Uma observação sobre privacidade

O seu documento, os arquivos anexados ou mencionados com @, as suas instruções de escrita, o perfil de estilo, as entradas da biblioteca mencionadas e os arquivos da pasta que a Textus AI lê são enviados, em cada solicitação, ao provedor que você escolheu; **Aprender meu estilo** envia as amostras que você escolher. Com a busca na web ativada, as buscas vão para o seu provedor ou para o serviço de busca mostrado nos Ajustes, e as páginas que a Textus AI lê são baixadas deste computador. Desative nos Ajustes qualquer recurso que você não queira usar dessa forma.
