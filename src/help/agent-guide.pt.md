# Guia dos recursos de IA do Textus

O Textus tem uma IA integrada feita para a escrita, a Textus AI: autocompletar, verificação gramatical e conversas que leem e revisam o seu documento. Este guia mostra como conectar um serviço, como usar os recursos de IA e como adaptar a Textus AI ao seu jeito de escrever com uma pasta de projeto, um perfil de estilo, uma biblioteca, instruções de escrita e habilidades.

## Como conectar um serviço

1. Abra **Ajustes > Textus AI** e escolha o serviço que você quer em **Conexão > Provedor**.
2. Expanda **Login e credenciais** e entre na sua conta ou digite uma chave de API, conforme o que o serviço oferece.
3. Para um **Endpoint personalizado** (qualquer servidor compatível com a API da OpenAI: modelos locais, proxies), digite a URL base, uma chave se ele exigir e o nome do modelo, e salve.
4. Escolha o modelo auxiliar em **Assistência de escrita** e o modelo do chat em **Chat da Textus AI**.

O login acontece no seu navegador. O suporte a imagens, busca na web e edições no documento depende do serviço e do modelo escolhidos.

A lista de modelos integrada traz só os modelos padrão de cada provedor (na Anthropic: Claude Sonnet 5.5 para o chat e Claude Haiku 5.5 para o autocompletar e a verificação gramatical). Clique em **Buscar Modelos** na linha Lista de modelos, em **Conexão**, para carregar a lista atual do provedor e escolher qualquer modelo dela.

Para o **Doubao (Volcengine)**, crie a chave de API no [console do Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) e, nesse mesmo console, ative os modelos que quer usar: o Ark recusa pedidos a um modelo que sua conta não ativou.

Os atalhos abaixo usam a notação do macOS; no Windows e no Linux, leia Cmd como Ctrl e Option como Alt. Se você mudou um atalho, **Ajustes > Atalhos** mostra o atual.

## Os recursos de IA

### 1. Autocompletar

Enquanto você digita, uma continuação em cinza aparece no cursor. Pressione <kbd>Tab</kbd> para aceitá-la, ou <kbd>Cmd</kbd>+<kbd>→</kbd> para aceitar só a próxima palavra e manter o resto como sugestão. <kbd>Esc</kbd> descarta a sugestão. Não há quantidade mínima de texto: o autocompletar funciona desde a primeira frase do documento.

Peça uma continuação quando quiser com <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> ou pelo menu de contexto (o cursor precisa estar no fim de um parágrafo): você recebe uma continuação mais longa, com até três alternativas, e <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> passam de uma para outra.

Em **Ajustes > Textus AI > Assistência de escrita**, você pode escolher um **Tom do autocompletar** (Seguir o documento / Formal / Informal / Acadêmico / Conciso). Quando o documento pertence a um projeto com perfil de estilo ou biblioteca (veja **Personalize a Textus AI**, mais abaixo), o autocompletar também segue esses arquivos.

### 2. Verificação gramatical

Possíveis problemas aparecem sublinhados. Passe o ponteiro sobre um deles, ou leve o cursor até ele, para ver a explicação; **Aplicar** (ou <kbd>Option</kbd>+<kbd>Enter</kbd> com o cursor sobre o trecho) aceita a correção, e **Ignorar** a descarta. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> verifica o parágrafo atual na hora.

### 3. O painel de IA

A conversa completa fica em um painel no lado direito do editor. Abra ou feche o painel com o botão **Textus AI** (a pena) na ponta direita da barra da janela ou com <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **Uma conversa por documento**: cada aba tem a sua conversa, e trocar de aba troca o painel junto. **Nova conversa**, no cabeçalho do painel, recomeça do zero (se ainda houver edições sem decisão, o app pergunta antes).
- **Modos**: o campo de mensagem tem três. **Escrever** redige texto novo no documento (uma continuação, um parágrafo ou uma seção nova) e só acrescenta: com texto selecionado, escreve depois da seleção. **Revisar** responde, conversa e deixa comentários sem mudar nada. **Editar** altera o texto que já existe. Cada mudança de Escrever ou Editar é uma proposta que você aceita ou rejeita. O painel começa no modo definido em **Ajustes > Textus AI > Chat da Textus AI > Modo padrão**.
- **Menções com @**: digite `@` no campo para escolher um arquivo de texto da pasta do projeto; ele é anexado à mensagem.
- **Anexar arquivos**: o botão **+** à esquerda do campo anexa à mensagem um PDF, um documento do Word, uma apresentação do PowerPoint, uma planilha, um livro EPUB, um arquivo RTF ou HTML, uma imagem ou um arquivo de texto simples. Tudo, menos as imagens, é convertido em texto no seu computador e vai dentro da mensagem; as imagens são enviadas como imagens de verdade aos provedores que conseguem vê-las (os que não conseguem avisam na hora, em vez de descartá-las sem dizer nada). Um arquivo longo é enviado só em parte, e o anexo mostra “(parcial)” quando isso acontece.
- **Busca na web**: o botão da lupa ao lado do campo de texto deixa a Textus AI buscar na web quando um pedido precisar; veja **7. Busca na web** abaixo.
- **Raciocínio profundo**: o botão ao lado da busca na web (a lâmpada) pede ao modelo que pense bem na resposta antes de responder — mais lento e mais caro, para perguntas difíceis e reescritas maiores. Ele fica ligado, também em outros documentos, até você tocar nele de novo. Enquanto o modelo pensa, o painel mostra "Pensando · 8 segundos" e depois "Pensou por 12 segundos", que você pode clicar para ler o raciocínio quando o provedor o compartilha. O botão só aparece para modelos que conseguem pensar mais a fundo; a Pergunta rápida sempre pede uma resposta rápida.
- **Histórico**: o botão **Histórico** (o relógio), no topo do painel de IA, lista as conversas anteriores agrupadas por pasta. Clique em uma para reabri-la com o documento dela e continuar.
- **Erros**: quando uma solicitação falha, o chat diz que tipo de problema houve e o que fazer (verificar a chave, esperar um pouco, escolher outro modelo), acima da mensagem do próprio provedor.

**Abrir em uma janela separada**, no cabeçalho do painel, leva a conversa para uma janela própria, o que ajuda quando você tem um segundo monitor. Essa janela acompanha você: troque de aba ou de janela e o documento, o título e a seleção mudam junto, e as edições que ela propõe vão para o arquivo que você está editando de fato. Há no máximo uma dessas janelas por janela do editor; **📌**, no cabeçalho dela, a mantém na frente do editor.

### 4. Pergunta rápida

Pressione <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (ou clique com o botão direito > Perguntar à IA…) para abrir uma pequena barra de chat logo abaixo do parágrafo em que você está. Ela fica dentro do documento e empurra o texto seguinte para baixo, em vez de cobri-lo. Se havia texto selecionado quando você a abriu, a seleção vai junto. A Pergunta rápida abre no modo **Editar**, porque normalmente é aberta sobre um trecho que você quer mudar (“encurte isto”); Escrever e Revisar estão a um clique, no seletor de modo.

- **O atalho de novo**: pressionar <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> com a barra aberta leva o cursor para o campo dela; pressionar mais uma vez, a partir do campo, fecha a barra. <kbd>Esc</kbd> em qualquer ponto da barra também a fecha, e o cursor volta ao documento. Se ainda houver edições sem decisão, o app pergunta antes de fechar a barra (ou de começar uma nova conversa).
- A Pergunta rápida tem a sua própria conversa curta, separada da do painel e não salva no histórico. Ela abre mesmo com o painel aberto. **Continuar na conversa completa** (o botão no canto dela) passa a conversa para o painel de IA, onde ela segue e fica salva. Ative **Ajustes > Textus AI > Avançado > Abrir conversas completas em uma janela separada** para mandá-la a uma janela separada.

### 5. Edições no documento

O chat nunca escreve direto no seu documento. Quando você pede a um provedor com chamada de ferramentas que altere o documento, cada alteração é uma proposta mostrada exatamente onde entraria: o texto removido aparece riscado e o texto novo aparece como uma inserção em verde. Nada muda no documento até você aceitar, e <kbd>Cmd</kbd>+<kbd>Z</kbd> desfaz uma edição aceita de uma só vez.

- **Aceitar / Rejeitar**: pela barra flutuante ao lado da edição, pelo cartão da proposta no painel ou pelo teclado: <kbd>Cmd</kbd>+<kbd>Return</kbd> aceita, e <kbd>Cmd</kbd>+<kbd>Delete</kbd> com o cursor sobre a edição rejeita. Várias propostas na mesma resposta aparecem em prévia ao mesmo tempo; passe de uma para outra com ‹› e use Aceitar todas / Rejeitar todas.
- **Motivos**: cada cartão de proposta diz por que a Textus AI fez aquela alteração.
- **Só algumas frases**: quando uma proposta reescreve várias frases, o cartão oferece **Escolher frases (N)**; marque as que você quer e clique no botão de aceitar, que passa a mostrar quantas você marcou (por exemplo, **Aceitar 2 de 3**).
- **No cursor**: sem nada selecionado, a Textus AI sabe onde está o seu cursor, então “escreva uma transição aqui” insere o texto exatamente ali.
- **Comentários em vez de edições**: peça uma revisão (“o que está fraco aqui?”) e a Textus AI fixa comentários nos trechos sem alterá-los. Cada cartão de comentário tem **Mostrar no documento**, que seleciona o trecho a que ele se refere.

### 6. Imagens

A Textus AI pode criar uma imagem para o seu documento assim que você escolher um **Modelo de imagem** em **Ajustes > Textus AI**. Até lá ele fica em **Nenhum**, porque cada imagem custa um pouco no serviço. Escolha um serviço e um modelo: OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow ou qualquer endpoint compatível com OpenAI. Se você já usa esse serviço no chat, a chave dele é reaproveitada; senão, os Ajustes pedem uma.

- Peça no modo Escrever ou Editar ("adicione uma imagem do porto depois do primeiro parágrafo"), ou clique com o botão direito num parágrafo e escolha **Ilustrar este parágrafo**.
- A imagem chega como uma proposta no lugar, como qualquer inserção. Nada é salvo até você aceitar: aí ela é salva como **Ajustes > Imagens** diz para uma imagem colada e inserida como imagem Markdown. Rejeitar não deixa nada.
- Se o serviço recusar a descrição, o painel mostra o motivo que ele deu. Cada pedido cria no máximo duas imagens.

### 7. Busca na web

Ative o botão **Busca na web** ao lado do campo de texto (ou **Ajustes > Textus AI > Chat da Textus AI > Busca na web** para que comece ativado) e a Textus AI pesquisa na web quando um pedido precisa de fatos atuais ou de que ela não tem certeza. Ela também pode ler uma página cujo endereço você colar.

- **Quem busca**: os modelos que buscam sozinhos — OpenAI, Claude, Grok, OpenRouter, Groq, Qwen e Zhipu GLM — usam a própria busca. Com qualquer outro modelo (DeepSeek, Gemini, Mistral, Kimi, modelos locais, endpoints personalizados), quem busca é a Textus, com o **Serviço de busca** escolhido em Busca na web nos Ajustes: **Automático** usa uma chave da DeepSeek, Zhipu ou Kimi que você já salvou para o chat; ou escolha Bocha, Tavily, Brave Search ou Exa e cole a chave dele, ou SearXNG e informe o endereço do seu próprio servidor. A linha mostra para onde vão as suas buscas. Sem nada com que buscar, o botão mostra um ponto vermelho.
- **Fontes**: a resposta cita o que encontrou como [1], [2] e lista essas páginas embaixo; clique em uma para abri-la no navegador. Os números continuam os mesmos durante toda a conversa.
- **Fontes como notas de rodapé**: quando uma proposta se baseia na web, o cartão dela mostra **Adicionar as fontes como notas de rodapé**. Marcado, aceitar adiciona notas de rodapé em Markdown com as fontes no fim do documento; desmarcado, o texto entra sem elas. O cartão lembra a sua última escolha.
- **Páginas são lidas, não obedecidas**: o que uma página diz nunca é uma instrução para a Textus AI, que continua só propondo edições. A Textus lê apenas páginas da web pública, nunca do seu computador ou da sua rede local.

## Personalize a Textus AI

A Textus AI aprende sobre você e o seu trabalho a partir de alguns arquivos Markdown comuns, e não de configurações escondidas. Cada um tem uma função:

| Conceito | O que é | Onde fica |
| --- | --- | --- |
| **Pasta do projeto** | A pasta em que a Textus AI trabalha e que ela pode ler | A pasta do documento ou uma que você escolher |
| **Perfil de estilo** | Como você escreve | `.textus/style.md` |
| **Biblioteca** | Fatos sobre pessoas, lugares e termos | `.textus/library/` |
| **Instruções de escrita** | Regras fixas para toda conversa | `agent.md`, global e por projeto |
| **O que a IA lembrou** | O que a Textus AI guarda das suas conversas | `.textus/memory/` e `memory/` na pasta de configuração global |
| **Habilidades** | Instruções reutilizáveis que você chama com `/nome` | `skills/`, global e por projeto |
| **Pasta de configuração global** | O que vale para todos os documentos | A pasta de configurações do app |

Daqui em diante, “conversas” quer dizer o painel de IA e a Pergunta rápida. Veja um projeto inteiro de relance:

```
meu-romance/             ← a pasta do projeto
├── capitulo-1.md        ← o documento que você está editando
├── notas/
│   └── cronologia.md    ← material de referência que a Textus AI pode ler
└── .textus/              ← as configurações do próprio projeto
    ├── style.md         ← perfil de estilo
    ├── agent.md         ← instruções de escrita deste projeto
    ├── library/
    │   ├── lin-wan.md   ← uma entrada por personagem, lugar ou termo
    │   └── harbour-city.md
    └── skills/
        └── polir.md     ← uma habilidade por arquivo
```

O menu do projeto cria a pasta `.textus/` e os arquivos dela na primeira vez que você precisa deles; as habilidades do projeto são a única coisa que você adiciona à mão. Em qualquer um desses arquivos, o texto dentro de comentários `<!-- -->` é uma nota para você mesmo e nunca é enviado.

### A pasta do projeto

**A pasta do projeto é a pasta em que a Textus AI trabalha.** Por padrão, é a pasta do documento que você está editando (ou a pasta mais próxima acima dela que tenha uma pasta `.textus/`, de modo que um capítulo em `novel/part-1/` pertence a `novel/`): salve um documento e a pasta dele se torna a pasta do projeto.

- A Textus AI pode listar, encontrar pelo nome, ler e buscar os arquivos dessa pasta para encontrar as cenas anteriores de um personagem, um termo ou as suas notas: arquivos de texto (Markdown, texto simples e formatos parecidos) de até 16 MB, que ela lê por partes quando são longos, e o texto de arquivos PDF, Word, PowerPoint, EPUB, RTF e de planilhas. Com um provedor que consegue ver imagens, ela também vê as imagens PNG, JPEG, GIF e WebP da pasta, de até 6 MB cada. Arquivos e pastas ocultos, o que um arquivo `.gitignore` ou `.ignore` exclui (como na busca de arquivos da barra lateral), pastas de build e de dependências (como `node_modules`) e PDFs digitalizados sem camada de texto ficam de fora.
- Digitar `@` no campo do chat anexa um dos arquivos dela à sua mensagem.
- A pasta `.textus/` dela guarda o perfil de estilo, a biblioteca, as instruções de escrita e as habilidades do projeto.

A barra abaixo do cabeçalho do painel de IA mostra o nome da pasta do projeto; clique nele para abrir o **menu do projeto**. Quando o seu material de referência não está ao lado do rascunho, use **Escolher pasta do projeto…** nesse menu (ou **Ajustes > Textus AI > Pasta do projeto**). A pasta escolhida vale para todos os documentos, inclusive rascunhos não salvos, até você escolher **Usar a pasta do documento** de novo.

> [!TIP]
> Seu rascunho está em `tese/rascunhos/` e as notas das entrevistas em `tese/pesquisa/`? Escolha `tese/` como pasta do projeto, e a Textus AI poderá ler `pesquisa/entrevistas.md` enquanto você trabalha em `rascunhos/capitulo-2.md`.

Tudo o que a Textus AI lê precisa estar dentro da pasta do projeto: `..`, caminhos absolutos e links que apontam para fora são recusados. Um rascunho não salvo não tem pasta do projeto, a menos que você tenha escolhido uma, e uma pasta ampla demais (sua pasta pessoal ou um disco inteiro) é recusada.

### O perfil de estilo — “Aprender meu estilo”

**O perfil de estilo descreve como você escreve**, para que as continuações e edições soem como você: voz e tom, ritmo das frases, escolha de palavras, pontuação, o que você nunca faz. A Textus AI o segue nas conversas, e o autocompletar o segue enquanto você digita, em todos os documentos do projeto. Ele é o arquivo `.textus/style.md`.

Há duas maneiras de criar um, ambas no menu do projeto:

- **Aprender meu estilo com amostras…**: escolha alguns arquivos com textos seus (até oito). A Textus AI estuda esses textos e faz um rascunho do perfil (voz e tom, frases e ritmo, escolha de palavras, pontuação, estrutura, o que você nunca faz e algumas citações curtas como exemplos), que abre em uma nova aba. Leia, corrija, complete: o perfil é seu. Ao aprender de novo, a Textus AI guarda o perfil anterior como `style.previous.md`.
- **Criar perfil de estilo**: comece de um esboço vazio e escreva tudo você mesmo.

Quando já existe um perfil, o botão **Estilo**, ao lado do nome da pasta, abre o arquivo.

```markdown
# Perfil de estilo

## Frases e ritmo
- Frases curtas, raramente com mais de 15 palavras.
- Abre o parágrafo com uma cena concreta e só depois traz a ideia.

## Nunca
- Nada de pontos de exclamação. Nada de “de repente”.
```

Pontos concretos e verificáveis funcionam melhor do que adjetivos: “frases curtas, raramente com mais de 15 palavras” em vez de “conciso”. Mantenha o perfil em uma ou duas páginas; só os primeiros 6.000 caracteres são usados. O **Tom do autocompletar** nos Ajustes também vale; deixe em *Seguir o documento* quando o seu perfil de estilo já descreve a sua voz.

### A biblioteca

**A biblioteca guarda fatos que precisam se manter coerentes**: um arquivo Markdown por personagem, lugar ou termo, em `.textus/library/`. **Nova entrada na biblioteca…**, no menu do projeto, pede um nome e abre a nova entrada; o botão **Biblioteca** mostra quantas entradas existem.

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

**Instruções de escrita são regras fixas enviadas em toda conversa**: do que se trata o projeto, em que idioma responder, grafias e termos, o que a Textus AI deve sempre ou nunca fazer. Elas ficam em arquivos chamados `agent.md`, em dois níveis:

- **Global**, para todos os documentos: **Ajustes > Textus AI > Instruções de escrita (agent.md) > Editar agent.md**.
- **Projeto**, para os documentos de um projeto: `.textus/agent.md`, que se abre com **Editar instruções de escrita do projeto**, no menu do projeto.

Os dois abrem em uma aba e começam com um breve guia em comentários. Quando os dois existem, a Textus AI recebe ambos (primeiro as instruções globais, depois as do projeto) e, onde eles divergem, valem as do projeto.

```markdown
O livro é um romance policial ambientado na Xangai dos anos 1930, narrado por Lin Wan em primeira pessoa.
Responda sempre em português, mesmo que o romance seja em inglês.
Escreva “Harbour City”, nunca “Harbor City”.
```

As instruções de escrita valem só para as conversas. O autocompletar não as lê; ele segue o perfil de estilo e a biblioteca.

### O que a Textus AI lembra

**A Textus AI lembra o que você pede e como você escreve**, sem que você precise escrever um arquivo. Quando você diz algo que deve valer além de um pedido (“sempre com a grafia de Portugal”, “sem travessões”, uma correção que você teve de fazer duas vezes) ou um fato sobre a sua obra, como quem é um personagem, ela guarda isso e segue nas conversas seguintes. A cada vez, uma linha abaixo da resposta diz o que ela lembrou e onde: **Desfazer** volta atrás, e **Tornar pessoal** ou **Passar para o projeto** muda o lugar.

- **Este projeto**: o que é sobre esta obra, em `.textus/memory/`; fatos sobre pessoas, lugares e termos vão para a biblioteca.
- **Para todos os projetos**: os seus hábitos gerais, em `memory/` na pasta de configuração global. Sem pasta do projeto, tudo vai para cá.

A aba **Memória** do painel de IA lista tudo em **O que a IA lembrou**, com quando e em qual conversa cada item foi lembrado: **Editar** abre, **Apagar** remove. As suas próprias instruções de escrita vencem quando as duas discordam, e a Textus AI nunca altera o seu `agent.md` nem o seu perfil de estilo. Quando há memórias demais para enviar, as mais antigas ficam de fora e a aba Memória avisa. **Ajustes > Textus AI > Lembrar automaticamente** desativa o recurso.

**Também aprende com as suas escolhas de revisão.** Quando você recusa várias vezes o mesmo tipo de alteração — 「」 trocadas por “”, uma palavra trocada por outra, frases divididas, uma vírgula de Oxford acrescentada —, a Textus AI oferece, ao fim da revisão, lembrar isso como requisito: **Lembrar** guarda em **O que a IA lembrou**, **Agora não** espera por mais casos e **Não perguntar mais** deixa de perguntar sobre esse tipo. Pergunta no máximo uma vez por dia, e nada é guardado sem o seu clique, também com Lembrar automaticamente desligado. O que conta é só uma nota curta dos tipos de alteração que você aceitou ou recusou, guardada neste computador junto às suas memórias e nunca enviada.

### Habilidades (/nome)

**Uma habilidade é um conjunto de instruções reutilizável, com um nome** (“polir”, “esboço”, “conferir as citações”), guardado em um arquivo Markdown: um nome e uma descrição de uma linha no topo e, abaixo, as instruções completas.

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

As habilidades ficam nos mesmos dois níveis que as instruções de escrita: as globais na pasta `skills/` da pasta de configuração global (**Ajustes > Textus AI > Habilidades > Importar Habilidade…** copia um arquivo de habilidade para lá) e as do projeto em `.textus/skills/` (uma pasta oculta; no Finder do macOS, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> a mostra). Uma habilidade do projeto com o mesmo nome de uma global substitui a global.

### Habilidades integradas

O Textus traz 19 habilidades para as tarefas de escrita mais comuns. O menu `/` as agrupa em **Escrever** (continuar a história, descrever personagem ou cena, polir diálogos, imitar um estilo), **Reescrever** (expandir, enxugar, mudar o tom, tirar o tom de IA, traduzir e polir), **Verificar** (revisar, verificar continuidade) e **Formatos** (escrever e-mail, aviso ou documento oficial, ata de reunião, revisão acadêmica, post para redes sociais, título, resumir, criar um tema). Digite `/` e escolha uma, ou digite o nome dela em qualquer idioma do app: `/proofread`, `/revisar` e `/校对` chamam a mesma habilidade. O Textus AI também escolhe sozinho a maioria delas quando o seu pedido combina com uma; **Expandir**, **Enxugar**, **Mudar o tom** e **Resumir** só rodam quando você as chama. **Criar um tema** escreve na resposta, em CSS, um tema para o editor a partir da sua descrição: **Usar este tema**, logo abaixo, instala e ativa o tema; ou salve-o como arquivo .css e importe com **Ajustes > Editor e aparência > Importar CSS…**.

**Ajustes > Textus AI > Habilidades integradas** mostra todas. O botão desativa uma: ela some do menu `/` e o Textus AI deixa de usá-la. **Personalizar…** copia a habilidade para a pasta `skills/` da pasta de configuração global e abre a cópia para você mudar as instruções; dali em diante, é a sua cópia que roda. **Restaurar** apaga a cópia e traz de volta a versão integrada. Uma habilidade sua com o nome de uma integrada a substitui.

### Normas de escrita

**Ajustes > Textus AI > Assistência de escrita > Normas de escrita** define quais regras de pontuação, espaços e números o Textus AI e a verificação gramatical seguem. **Automático** aplica a norma nacional quando o idioma tem uma (para o português, a norma brasileira; para o japonês, a JTF); nos outros casos, segue o que o seu documento já faz com mais frequência e aponta só as inconsistências. Ao escolher um perfil, como **Portugal** ou **Brasil · Documentos oficiais**, os documentos nesse idioma passam a seguir esse perfil.

Um projeto pode ter a própria escolha: adicione uma linha `conventions:` entre as duas linhas `---` no início do perfil de estilo (`.textus/style.md`). Nos documentos desse projeto, ela vale mais que o ajuste.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### A pasta de configuração global

**A pasta de configuração global guarda o que vale para todos os documentos**: o seu `agent.md` global e as suas habilidades globais. Ela pertence ao app, não a um projeto; **Ajustes > Textus AI > Pasta de configuração global > Mostrar** a mostra.

```
agent/                ← a pasta de configuração global
├── agent.md          ← instruções de escrita globais
└── skills/
    └── esboco.md     ← uma habilidade global
```

Não existe perfil de estilo nem biblioteca global: eles descrevem uma obra específica, então pertencem a um projeto.

### O que vale em cada caso

| | Conversas | Autocompletar | Verificação gramatical |
| --- | :---: | :---: | :---: |
| Arquivos do projeto (ler, buscar, `@`) | ✓ | | |
| Perfil de estilo | ✓ | ✓ | |
| Entradas da biblioteca mencionadas | ✓ | ✓ | |
| Instruções de escrita | ✓ | | |
| O que a Textus AI lembrou | ✓ | | |
| Habilidades | ✓ | | |
| Tom do autocompletar (Ajustes) | | ✓ | |

- **Global primeiro, projeto depois.** As instruções de escrita dos dois níveis são enviadas, as do projeto por último, e as do projeto vencem em caso de conflito. Uma habilidade do projeto substitui uma global com o mesmo nome.
- **Uma pasta de projeto por vez.** Só a `.textus/` dela conta: quando você escolhe uma pasta de projeto, uma `.textus/` ao lado do documento não é lida.
- **Não é preciso reiniciar.** Edite qualquer um desses arquivos e a próxima solicitação já usa a nova versão (no autocompletar, em cerca de dez segundos).

### Qual arquivo para quê?

- Como o seu texto deve soar → o **perfil de estilo**.
- Quem é quem, o que é o quê → a **biblioteca**.
- O que a Textus AI deve saber ou sempre fazer em uma conversa → as **instruções de escrita**.
- Uma tarefa que você pede várias vezes → uma **habilidade**.
- Notas, pesquisa, capítulos anteriores → arquivos comuns na **pasta do projeto**; a Textus AI os lê quando um pedido precisa deles.

## Desativar a Textus AI

Clique com o botão direito no botão **Textus AI**, na ponta direita da barra da janela, para pausar a Textus AI por uma hora ou desativá-la. Enquanto está desativada, a pena aparece riscada, e um clique nele oferece ativá-la de novo; uma pausa termina sozinha depois da hora. **Ajustes > Textus AI > Ativar Textus AI** e um atalho que você pode definir em **Ajustes > Atalhos** também a ativam ou desativam; no iPhone, fica no menu.

Enquanto está desativada, nada é enviado a nenhum serviço de IA desde que o Textus abre: nem complementação, nem verificação gramatical, nem conversa, nada é lembrado. O painel de IA, a pergunta rápida e os itens de IA do menu de contexto somem, e uma resposta que ainda estava sendo escrita para. As edições já propostas no documento continuam, para você aceitar ou rejeitar. Cada recurso mantém a própria configuração, e todos voltam a valer assim que a Textus AI é ativada de novo.

## Uma observação sobre privacidade

O seu documento, os arquivos anexados ou mencionados com @, as suas instruções de escrita, o perfil de estilo, as entradas da biblioteca mencionadas e os arquivos do projeto que a Textus AI lê são enviados, em cada solicitação, ao provedor que você escolheu; **Aprender meu estilo** envia as amostras que você escolher. Com a busca na web ativada, as buscas vão para o seu provedor ou para o serviço de busca mostrado nos Ajustes, e as páginas que a Textus AI lê são baixadas deste computador. Desative nos Ajustes qualquer recurso que você não queira usar dessa forma.
