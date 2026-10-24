# Guide des fonctions IA de Textus

Textus intègre une IA conçue pour l'écriture, Textus AI : complétion, vérification grammaticale et conversations qui lisent et révisent votre document. Ce guide explique comment connecter un service, présente les fonctions IA et montre comment faire de Textus AI votre propre assistant d'écriture grâce au dossier du projet, au profil de style, à la bibliothèque, aux instructions d'écriture et aux compétences.

## Connecter un service

1. Ouvrez **Réglages > Textus AI** et choisissez le service voulu sous **Connexion > Fournisseur**.
2. Développez **Authentification**, puis connectez-vous à votre compte ou saisissez une clé API, selon ce que ce service propose.
3. Pour un **Serveur personnalisé** (tout serveur compatible avec OpenAI : modèles locaux, proxys), saisissez l'URL de base, une clé si le serveur en demande une et le nom du modèle, puis enregistrez.
4. Choisissez le modèle d'écriture avec **Modèle d'assistance**, sous **Aide à l'écriture**, et le modèle de discussion avec **Modèle de discussion**, sous **Discussion avec Textus AI**.

La connexion à un compte se fait dans votre navigateur. La prise en charge des images, de la recherche web et des modifications du document dépend du service et du modèle choisis.

La liste de modèles intégrée ne contient que les modèles par défaut de chaque fournisseur (pour Anthropic : Claude Sonnet 5.5 pour la discussion, Claude Haiku 5.5 pour la complétion et la grammaire). Appuyez sur **Récupérer les modèles**, sur la ligne Liste des modèles de **Connexion**, pour charger la liste actuelle du fournisseur et y choisir n'importe quel modèle.

Pour **Doubao (Volcengine)**, créez la clé d'API dans la [console Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) et, dans cette même console, activez les modèles que vous voulez utiliser : Ark refuse les requêtes vers un modèle que votre compte n'a pas activé.

Les raccourcis ci-dessous suivent la notation de macOS ; sous Windows et Linux, remplacez Cmd par Ctrl et Option par Alt. Si vous avez modifié un raccourci, **Réglages > Raccourcis** indique celui qui est en vigueur.

## Les fonctions IA

### 1. Complétion

Pendant que vous tapez, une suite grisée apparaît au curseur : appuyez sur <kbd>Tab</kbd> pour l'accepter, ou sur <kbd>Cmd</kbd>+<kbd>→</kbd> pour n'accepter que le mot suivant et garder le reste en suggestion. <kbd>Esc</kbd> la fait disparaître. Aucune quantité minimale de texte n'est requise : la complétion fonctionne dès la première phrase d'un document.

Pour en demander une explicitement, utilisez <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> ou le menu contextuel (le curseur doit se trouver à la fin d'un paragraphe) : vous obtenez une suite plus longue, avec jusqu'à trois variantes, que <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> font défiler.

Sous **Réglages > Textus AI > Aide à l'écriture**, vous pouvez régler le **Ton de la complétion** (Adapté au document / Soutenu / Décontracté / Académique / Concis). Lorsque le document appartient à un projet doté d'un profil de style ou d'une bibliothèque (voir **Personnaliser Textus AI** plus bas), la complétion en tient compte aussi.

### 2. Vérification grammaticale

Les problèmes possibles sont soulignés. Survolez-en un, ou placez le curseur dedans, pour voir l'explication ; **Appliquer** (ou <kbd>Option</kbd>+<kbd>Enter</kbd> avec le curseur dessus) applique la correction, **Ignorer** la fait disparaître. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> vérifie immédiatement le paragraphe en cours.

### 3. Le panneau IA

La conversation complète se trouve dans un panneau à droite de l'éditeur. Ouvrez-le ou fermez-le avec le bouton **Textus AI** (la plume) à l'extrémité droite de la barre de la fenêtre, ou avec <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **Une conversation par document** : chaque onglet a sa propre conversation, et changer d'onglet change aussi celle du panneau. **Nouvelle conversation**, dans l'en-tête du panneau, repart de zéro (s'il reste des modifications en attente, une confirmation est d'abord demandée).
- **Modes** : la zone de saisie en propose deux. **Écrire** travaille sur le document : il rédige du texte nouveau (une suite, un paragraphe ou une section) et modifie le texte existant (réécrire, traduire, couper). Avec du texte sélectionné, un changement de ce texte le remplace, et du texte nouveau va après lui. **Relire** répond, discute et laisse des commentaires sans rien modifier. Chaque changement d'Écrire est une proposition que vous acceptez ou refusez. Le panneau s'ouvre dans le mode choisi sous **Réglages > Textus AI > Discussion avec Textus AI > Mode par défaut**.
- **Mentions @** : tapez `@` dans la zone de saisie pour choisir un fichier texte du dossier du projet ; il est joint au message.
- **Pièces jointes** : le bouton **+**, à gauche de la zone de saisie, joint au message un PDF, un document Word, une présentation PowerPoint, une feuille de calcul, un livre EPUB, un fichier RTF ou HTML, une image ou un fichier texte. Tout, sauf les images, est converti en texte sur votre appareil et voyage dans le message ; les images sont envoyées telles quelles aux fournisseurs capables de les voir (les autres le signalent d'emblée au lieu de les ignorer en silence). Un long fichier n'est envoyé qu'en partie, et sa pastille affiche alors « (tronqué) ».
- **Recherche web** : le bouton loupe à côté du champ de saisie permet à Textus AI de chercher sur le web quand une demande l'exige ; voir **7. Recherche web** plus bas.
- **Réflexion approfondie** : le bouton à côté de la recherche web (l'ampoule) demande au modèle de bien réfléchir avant de répondre — plus lent et plus cher, pour les questions difficiles et les grosses réécritures. Il reste activé, d'un document à l'autre, jusqu'à ce que vous appuyiez de nouveau dessus. Pendant que le modèle réfléchit, le panneau affiche « Réflexion · 8 secondes », puis « A réfléchi 12 secondes », sur lequel vous pouvez cliquer pour lire le raisonnement quand le fournisseur le partage. Le bouton n'apparaît qu'avec les modèles capables de réfléchir davantage ; Question rapide demande toujours une réponse rapide.
- **Historique** : le bouton **Historique** (l'horloge), en haut du panneau IA, liste les conversations passées, groupées par dossier. Cliquez sur l'une d'elles pour la rouvrir avec son document et la poursuivre.
- **Erreurs** : quand une requête échoue, la discussion indique le type de problème et la marche à suivre (vérifier la clé, patienter un instant, choisir un autre modèle), au-dessus du message du fournisseur.

**Ouvrir dans une fenêtre séparée**, dans l'en-tête du panneau, déplace la conversation dans sa propre fenêtre, ce qui est pratique sur un second écran. Cette fenêtre vous suit : changez d'onglet ou de fenêtre, et son document, son titre et sa sélection suivent ; les modifications qu'elle propose arrivent dans le fichier que vous êtes réellement en train de modifier. Il n'y en a jamais qu'une par fenêtre d'éditeur ; **📌**, dans son en-tête, la garde au-dessus de l'éditeur.

### 4. Question rapide

Appuyez sur <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (ou faites un clic droit > Demander à l'IA…) pour ouvrir une petite barre de discussion juste sous le paragraphe où vous êtes. Elle s'insère dans le document et repousse le texte qui suit au lieu de le recouvrir. Si du texte était sélectionné à l'ouverture, la sélection est incluse. Question rapide s'ouvre en mode **Écrire**, car on l'ouvre le plus souvent sur un passage pour le changer (« raccourcis ce passage ») ; Relire est à un clic, dans le sélecteur de mode.

- **Le raccourci, une deuxième fois** : appuyer sur <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> quand la barre est ouverte place le curseur dans sa zone de saisie ; appuyer encore une fois depuis la zone de saisie la ferme. <kbd>Esc</kbd>, n'importe où dans la barre, la ferme aussi, et le curseur revient dans le document. S'il reste des modifications en attente, la fermeture (ou une nouvelle conversation) demande d'abord confirmation.
- Question rapide garde sa propre conversation, courte, distincte de celle du panneau et non enregistrée dans l'historique. Elle s'ouvre même quand le panneau est ouvert. **Continuer dans la conversation complète** (le bouton dans son coin) transmet l'échange au panneau IA, où il se poursuit et est enregistré. Activez **Réglages > Textus AI > Avancé > Ouvrir les conversations complètes dans une fenêtre séparée** pour l'envoyer plutôt dans une fenêtre séparée.

### 5. Modifications dans le document

La discussion n'écrit jamais directement dans votre document. Quand vous demandez à un fournisseur compatible avec les appels d'outils de modifier le document, chaque changement devient une proposition, affichée à l'endroit même où il s'appliquerait : le texte supprimé est barré, le nouveau texte apparaît en vert. Rien n'est appliqué au document tant que vous n'avez pas accepté, et <kbd>Cmd</kbd>+<kbd>Z</kbd> annule une modification acceptée en une seule fois.

- **Accepter / Refuser** : depuis la barre flottante à côté de la modification, la carte de la proposition dans le panneau, ou au clavier (<kbd>Cmd</kbd>+<kbd>Return</kbd> accepte ; avec le curseur sur la modification, <kbd>Cmd</kbd>+<kbd>Delete</kbd> refuse). Les propositions d'une même réponse s'affichent toutes en aperçu ; passez de l'une à l'autre avec ‹› et utilisez Tout accepter / Tout refuser.
- **Raisons** : chaque carte de proposition indique pourquoi Textus AI a fait ce changement.
- **Seulement certaines phrases** : quand une proposition réécrit plusieurs phrases, sa carte propose « Choisir les phrases (N) » ; cochez celles que vous voulez garder, puis appuyez sur **Accepter K sur N**.
- **Au curseur** : si rien n'est sélectionné, Textus AI sait où se trouve votre curseur ; « écris une transition ici » l'insère exactement à cet endroit.
- **Des commentaires plutôt que des modifications** : demandez une relecture (« quels sont les points faibles ? ») et Textus AI épingle des commentaires à des passages sans les modifier. Chaque carte de commentaire propose **Afficher dans le document**, qui sélectionne le passage concerné.

### 6. Images

Textus AI peut créer une image pour votre document dès que vous choisissez un **Modèle d'image** dans **Réglages > Textus AI**. C'est **Aucun** jusque-là, car chaque image coûte un peu auprès du service. Choisissez un service et un modèle : OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow ou tout point d'accès compatible OpenAI. Si vous utilisez déjà ce service pour la conversation, sa clé est reprise ; sinon, les Réglages vous en demandent une.

- Demandez-la en mode Écrire (« ajoute une image du port après le premier paragraphe »), ou faites un clic droit sur un paragraphe et choisissez **Illustrer ce paragraphe**.
- L'image arrive comme une proposition à sa place, comme toute insertion. Rien n'est enregistré avant que vous acceptiez : elle est alors enregistrée comme **Réglages > Images** le prévoit pour une image collée, et insérée comme image Markdown. Refuser ne laisse rien.
- Si le service refuse la description, le panneau affiche la raison qu'il a donnée. Une demande crée au plus deux images.

### 7. Recherche web

Activez le bouton **Recherche web** à côté du champ de saisie (ou **Réglages > Textus AI > Discussion avec Textus AI > Recherche web** pour qu'il soit actif dès le départ) : Textus AI cherche alors sur le web quand une demande a besoin de faits récents ou dont il n'est pas sûr. Il peut aussi lire une page dont vous collez l'adresse.

- **Qui cherche** : les modèles qui cherchent eux-mêmes — OpenAI, Claude, Grok, OpenRouter, Groq, Qwen et Zhipu GLM — utilisent leur propre recherche. Pour tout autre modèle (DeepSeek, Gemini, Mistral, Kimi, modèles locaux, points d'accès personnalisés), c'est Textus qui cherche, avec le **Service de recherche** choisi sous Recherche web dans les réglages : **Automatique** utilise une clé DeepSeek, Zhipu ou Kimi déjà enregistrée pour la discussion ; vous pouvez aussi choisir Bocha, Tavily, Brave Search ou Exa et coller sa clé, ou SearXNG et saisir l'adresse de votre propre serveur. La ligne indique où partent vos recherches. Quand rien ne permet de chercher, le bouton affiche un point rouge.
- **Sources** : la réponse cite ce qu'elle a trouvé avec [1], [2] et liste ces pages en dessous ; cliquez sur l'une pour l'ouvrir dans votre navigateur. Les numéros restent les mêmes pendant toute la conversation.
- **Sources en notes de bas de page** : quand une proposition s'appuie sur le web, sa carte affiche **Ajouter les sources en notes de bas de page**. Coché, l'accepter ajoute des notes de bas de page Markdown pour ses sources à la fin du document ; décoché, le texte entre sans elles. La carte retient votre dernier choix.
- **Les pages sont lues, pas obéies** : ce que dit une page n'est jamais une instruction pour Textus AI, qui ne fait toujours que proposer des modifications. Textus ne lit que des pages du web public, jamais celles de votre ordinateur ou de votre réseau local.

## Personnaliser Textus AI

Textus AI apprend à vous connaître, vous et votre travail, à partir de quelques fichiers Markdown ordinaires, et non de réglages cachés. Chacun a un seul rôle :

| Concept | Ce que c'est | Où il se trouve |
| --- | --- | --- |
| **Dossier du projet** | Le dossier où Textus AI travaille et qu'il peut lire | Le dossier du document, ou un dossier que vous choisissez |
| **Profil de style** | Votre façon d'écrire | `.textus/style.md` |
| **Bibliothèque** | Les faits sur les personnes, les lieux et les termes | `.textus/library/` |
| **Instructions d'écriture** | Des règles permanentes pour chaque conversation | `agent.md`, global et par projet |
| **Mémoire** | Ce que Textus AI retient de vos conversations | `.textus/memory/`, et `memory/` dans le dossier de configuration globale |
| **Compétences** | Des instructions réutilisables, appelées avec `/nom` | `skills/`, global et par projet |
| **Dossier de configuration globale** | Ce qui s'applique à tous les documents | Le dossier des réglages de l'application |

Ci-dessous, « conversations » désigne le panneau IA et Question rapide. Voici un projet complet en un coup d'œil :

```
mon-roman/               ← le dossier du projet
├── chapitre-1.md        ← le document que vous modifiez
├── notes/
│   └── chronologie.md   ← documentation que Textus AI peut lire
└── .textus/              ← les réglages propres au projet
    ├── style.md         ← le profil de style
    ├── agent.md         ← les instructions d'écriture de ce projet
    ├── library/
    │   ├── lin-wan.md   ← une fiche par personnage, lieu ou terme
    │   └── harbour-city.md
    └── skills/
        └── peaufiner.md ← une compétence par fichier
```

Le menu du projet crée `.textus/` et ses fichiers pour vous la première fois que vous les demandez ; seules les compétences du projet s'ajoutent à la main. Dans tous ces fichiers, le texte placé dans des commentaires `<!-- -->` est une note pour vous-même et n'est jamais envoyé.

### Le dossier du projet

**Le dossier du projet est le dossier dans lequel Textus AI travaille.** Par défaut, c'est le dossier du document que vous modifiez (ou le dossier le plus proche au-dessus qui contient un dossier `.textus/`, si bien qu'un chapitre dans `novel/part-1/` appartient à `novel/`) : enregistrez un document, et son dossier devient le dossier du projet.

- Textus AI peut lister, trouver par leur nom, lire et fouiller les fichiers qu'il contient pour retrouver les scènes précédentes d'un personnage, un terme ou vos notes : les fichiers texte (Markdown, texte brut et formats similaires) jusqu'à 16 Mo, qu'il lit par parties quand ils sont longs, et le texte des fichiers PDF, Word, PowerPoint, EPUB, RTF et des feuilles de calcul. Avec un fournisseur capable de voir les images, il regarde aussi les images PNG, JPEG, GIF et WebP du dossier, jusqu'à 6 Mo chacune. Les fichiers et dossiers cachés, ce qu'un fichier `.gitignore` ou `.ignore` exclut (comme dans la recherche de fichiers de la barre latérale), les dossiers de compilation et de dépendances (comme `node_modules`) et les PDF numérisés sans couche de texte sont ignorés.
- Taper `@` dans la zone de saisie de la discussion joint l'un de ses fichiers à votre message.
- Son dossier `.textus/` contient le profil de style, la bibliothèque, les instructions d'écriture et les compétences du projet.

La barre située sous l'en-tête du panneau IA affiche le nom du dossier du projet ; cliquez dessus pour ouvrir le **menu du projet**. Si votre documentation ne se trouve pas à côté du brouillon, utilisez **Choisir le dossier du projet…** dans ce menu (ou **Réglages > Textus AI > Dossier du projet**). Le dossier choisi sert pour tous les documents, brouillons non enregistrés compris, jusqu'à ce que vous choisissiez de nouveau **Utiliser le dossier du document**.

> [!TIP]
> Votre brouillon est dans `thèse/brouillons/` et vos notes d'entretien dans `thèse/recherche/` ? Choisissez `thèse/` comme dossier du projet : Textus AI pourra lire `recherche/entretiens.md` pendant que vous travaillez sur `brouillons/chapitre-2.md`.

Tout ce que Textus AI lit doit se trouver dans le dossier du projet : `..`, les chemins absolus et les liens qui pointent vers l'extérieur sont refusés. Un brouillon non enregistré n'a pas de dossier du projet, sauf si vous en avez choisi un, et un dossier trop vaste (votre dossier personnel ou un disque entier) est refusé.

### Le profil de style — « Apprendre mon style »

**Le profil de style décrit votre façon d'écrire**, pour que les suites et les modifications vous ressemblent : voix et ton, rythme des phrases, choix des mots, ponctuation, ce que vous ne faites jamais. Textus AI le suit dans les conversations, et la complétion le suit pendant que vous tapez, dans tous les documents du projet. C'est le fichier `.textus/style.md`.

Il y a deux façons d'en créer un, toutes deux dans le menu du projet :

- **Apprendre mon style à partir d'exemples…** : choisissez quelques fichiers que vous avez écrits (jusqu'à huit). Textus AI les étudie et rédige un profil (voix et ton, phrases et rythme, choix des mots, ponctuation, structure, ce que vous ne faites jamais, et quelques courtes citations en guise d'exemples), puis l'ouvre dans un nouvel onglet. Lisez-le, corrigez-le, complétez-le : il vous appartient. Un nouvel apprentissage conserve le profil précédent sous le nom `style.previous.md`.
- **Créer un profil de style** : partez d'un plan vide et rédigez-le vous-même.

Une fois le profil créé, la pastille **Style**, à côté du nom du dossier, l'ouvre.

```markdown
# Profil de style

## Phrases et rythme
- Phrases courtes, rarement plus de 15 mots.
- Ouvre un paragraphe sur une scène concrète, puis passe à l'idée.

## À proscrire
- Pas de points d'exclamation. Jamais « soudain ».
```

Des points concrets et vérifiables fonctionnent mieux que des adjectifs : « phrases courtes, rarement plus de 15 mots » plutôt que « concis ». Tenez-vous-en à une ou deux pages ; seuls les 6 000 premiers caractères sont utilisés. Le **Ton de la complétion** des réglages s'applique aussi : laissez-le sur *Adapté au document* si votre profil de style décrit déjà votre voix.

### La bibliothèque

**La bibliothèque contient les faits qui doivent rester cohérents** : un fichier Markdown par personnage, lieu ou terme, dans `.textus/library/`. **Nouvelle fiche de bibliothèque…**, dans le menu du projet, demande un nom et ouvre la nouvelle fiche ; la pastille **Bibliothèque** indique combien il y en a.

```markdown
---
name: Lin Wan
aliases: [Wan, Mme Lin]
include: detected
---

Protagoniste, 32 ans, professeure de chinois dans un collège de Harbour City.
Gauchère. Ne parle jamais de son frère.
```

Vous n'avez pas à joindre les fiches vous-même. Une fiche avec `include: detected` (la valeur par défaut) est transmise à Textus AI dès que son nom ou l'un de ses alias apparaît : dans votre message ou dans le document pendant une conversation, dans le texte autour du curseur pendant la complétion. `always` l'envoie avec chaque requête ; `never` l'écarte. Les fiches qui ne sont pas mentionnées ne coûtent rien : la bibliothèque peut grandir autant que votre projet l'exige.

### Instructions d'écriture (agent.md)

**Les instructions d'écriture sont des règles permanentes envoyées avec chaque conversation** : ce qu'est le projet, dans quelle langue répondre, l'orthographe et les termes, ce que Textus AI doit toujours faire ou ne jamais faire. Elles se trouvent dans des fichiers nommés `agent.md`, à deux niveaux :

- **Global**, pour tous les documents : **Réglages > Textus AI > Instructions d'écriture (agent.md) > Modifier agent.md**.
- **Projet**, pour les documents d'un projet : `.textus/agent.md`, que l'on ouvre avec **Modifier les instructions d'écriture du projet** dans le menu du projet.

Les deux s'ouvrent dans un onglet et commencent par un court mode d'emploi en commentaires. Quand les deux existent, Textus AI reçoit les deux (d'abord les instructions globales, puis celles du projet) et, en cas de contradiction, celles du projet l'emportent.

```markdown
Le livre est un roman policier situé dans le Shanghai des années 1930, raconté par Lin Wan à la première personne.
Toujours répondre en français, même si le roman est en chinois.
Écrire « Harbour City », jamais « Harbor City ».
```

Les instructions d'écriture ne s'appliquent qu'aux conversations. La complétion ne les lit pas ; elle suit le profil de style et la bibliothèque.

### Ce que Textus AI retient

**Textus AI retient ce que vous lui demandez et votre façon d'écrire**, sans que vous ayez à écrire de fichier. Quand vous lui dites une chose qui doit valoir au-delà d'une seule demande (« toujours l'orthographe rectifiée », « pas de tiret cadratin », une correction que vous avez dû faire deux fois) ou un fait sur votre œuvre, comme l'identité d'un personnage, il la retient et la suit dans les conversations suivantes. À chaque fois, une ligne sous sa réponse indique ce qu'il a retenu et où : **Annuler** le retire, et **Rendre personnel** ou **Passer au projet** le déplace.

- **Ce projet** : ce qui concerne cette œuvre, dans `.textus/memory/` ; les faits sur les personnes, les lieux et les termes vont dans la bibliothèque.
- **Pour tous les projets** : vos habitudes générales, dans `memory/` du dossier de configuration globale. Sans dossier du projet, tout va ici.

L'onglet **Projet** du panneau IA liste le tout sous **Mémoire**, avec le moment et la conversation où chaque élément a été retenu : **Modifier** l'ouvre, **Supprimer** l'efface. Vos propres instructions d'écriture l'emportent en cas de désaccord, et Textus AI ne modifie jamais votre `agent.md` ni votre profil de style. Quand il y a trop de souvenirs à envoyer, les plus anciens sont laissés de côté et l'onglet Projet le signale. **Réglages > Textus AI > Retenir automatiquement** désactive cette fonction.

**Il apprend aussi de vos choix de révision.** Quand vous refusez plusieurs fois le même genre de modification — des 「」 changés en “”, un mot remplacé par un autre, des phrases coupées, une virgule d'Oxford ajoutée —, Textus AI propose, une fois la relecture terminée, de le retenir comme exigence : **Retenir** l'enregistre sous **Mémoire**, **Pas maintenant** attend d'en voir davantage et **Ne plus demander** cesse de poser la question pour ce genre. Il ne demande qu'une fois par jour au plus, et rien n'est enregistré sans votre clic, y compris quand Retenir automatiquement est désactivé. Ce qu'il compte n'est qu'une courte note des genres de modification acceptés ou refusés, gardée sur cet ordinateur à côté de vos souvenirs et jamais envoyée.

### Compétences (/nom)

**Une compétence est un ensemble d'instructions réutilisable, doté d'un nom** (« peaufiner », « plan », « vérifier les citations ») et rangé dans un seul fichier Markdown : un nom et une description d'une ligne en haut, les instructions complètes en dessous.

```markdown
---
name: peaufiner
description: Resserrer le passage sélectionné sans en changer le sens
---

Peaufine le texte donné phrase par phrase : supprime les mots superflus,
coupe les phrases trop longues, et garde le sens et la voix d'origine.
Ne renvoie que le texte peaufiné.
```

Il y a deux façons d'utiliser une compétence :

1. **L'appeler** : tapez `/` dans la zone de saisie de la discussion et choisissez-la dans le menu, ou tapez son nom suivi de votre demande, par exemple `/peaufiner reprends ce passage`.
2. **Demander simplement** (fournisseurs compatibles avec les appels d'outils uniquement) : Textus AI connaît le nom et la description de chaque compétence ; quand votre demande correspond à l'une d'elles, il charge ses instructions complètes et les suit de lui-même.

Les compétences existent aux deux mêmes niveaux que les instructions d'écriture : les compétences globales dans le dossier `skills/` du dossier de configuration globale (**Réglages > Textus AI > Compétences > Importer une compétence…** y copie un fichier de compétence), les compétences du projet dans `.textus/skills/` (un dossier caché : dans le Finder de macOS, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> l'affiche). Une compétence du projet qui porte le même nom qu'une compétence globale la remplace.

### Compétences intégrées

Textus propose 19 compétences pour les tâches d'écriture courantes. Le menu `/` les range en **Écrire** (continuer l'histoire, décrire un personnage ou un lieu, peaufiner les dialogues, imiter un style), **Retravailler** (développer, resserrer, changer de ton, retirer le ton IA, traduire et peaufiner), **Vérifier** (relire et corriger, vérifier la cohérence) et **Formats** (rédiger un courriel, avis ou document officiel, compte rendu, style académique, publication réseaux sociaux, titre, résumer, créer un thème). Tapez `/` et choisissez-en une, ou tapez son nom dans n'importe quelle langue de l'application : `/proofread`, `/corriger` et `/校对` appellent la même compétence. Textus AI choisit aussi de lui-même la plupart d'entre elles quand votre demande s'y prête ; **Développer**, **Resserrer**, **Changer de ton** et **Résumer** ne s'exécutent que si vous les appelez. **Créer un thème** écrit dans la réponse, en CSS, un thème pour l'éditeur d'après votre description : **Utiliser ce thème**, en dessous, l'installe et l'applique ; sinon, enregistrez-le dans un fichier .css et importez-le avec **Réglages > Éditeur et apparence > Importer du CSS…**.

**Réglages > Textus AI > Compétences intégrées** les liste toutes. L'interrupteur en désactive une : elle disparaît du menu `/` et Textus AI ne s'en sert plus. **Personnaliser…** copie la compétence dans le dossier `skills/` du dossier de configuration globale et ouvre la copie, pour que vous en modifiiez les instructions ; c'est ensuite votre copie qui s'exécute. **Réinitialiser** supprime la copie et rétablit la version intégrée. Une compétence à vous qui porte le nom d'une compétence intégrée la remplace.

### Conventions d'écriture

**Réglages > Textus AI > Aide à l'écriture > Conventions d'écriture** détermine les règles de ponctuation, d'espacement et d'écriture des nombres que suivent Textus AI et la vérification grammaticale. **Automatique** applique la norme nationale quand la langue en a une (GB/T pour le chinois simplifié, JTF pour le japonais, par exemple) ; sinon, il suit l'usage le plus fréquent dans votre document et ne signale que les incohérences. Choisissez un profil, par exemple **France** ou **Canada** pour le français, et les documents dans cette langue s'y conforment.

Un projet peut choisir le sien : ajoutez une ligne `conventions:` entre les deux lignes `---` en tête de son profil de style (`.textus/style.md`). Pour les documents de ce projet, elle l'emporte sur le réglage.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### Le dossier de configuration globale

**Le dossier de configuration globale contient ce qui s'applique à tous les documents** : votre `agent.md` global et vos compétences globales. Il appartient à l'application, pas à un projet ; **Réglages > Textus AI > Dossier de configuration globale > Afficher** l'affiche.

```
agent/                ← le dossier de configuration globale
├── agent.md          ← les instructions d'écriture globales
└── skills/
    └── plan.md       ← une compétence globale
```

Il n'existe ni profil de style ni bibliothèque globaux : ils décrivent un ensemble de textes précis, et appartiennent donc à un projet.

### Ce qui s'applique, et quand

| | Conversations | Complétion | Vérification grammaticale |
| --- | :---: | :---: | :---: |
| Fichiers du projet (lecture, recherche, `@`) | ✓ | | |
| Profil de style | ✓ | ✓ | |
| Fiches de la bibliothèque mentionnées | ✓ | ✓ | |
| Instructions d'écriture | ✓ | | |
| Ce que Textus AI a retenu | ✓ | | |
| Compétences | ✓ | | |
| Ton de la complétion (réglages) | | ✓ | |

- **D'abord le global, puis le projet.** Les instructions d'écriture des deux niveaux sont envoyées, celles du projet en dernier, et celles du projet l'emportent en cas de conflit. Une compétence du projet remplace une compétence globale du même nom.
- **Un seul dossier du projet à la fois.** Seul son `.textus/` compte : si vous avez choisi un dossier du projet, un `.textus/` situé à côté du document n'est pas lu.
- **Aucun redémarrage nécessaire.** Modifiez l'un de ces fichiers et la requête suivante utilise la nouvelle version (en une dizaine de secondes pour la complétion).

### Quel fichier pour quoi ?

- Le ton et le style de votre texte → le **profil de style**.
- Qui est qui, et ce que désigne chaque terme → la **bibliothèque**.
- Ce que Textus AI doit savoir ou toujours faire dans une conversation → les **instructions d'écriture**.
- Une tâche que vous demandez encore et encore → une **compétence**.
- Notes, recherches, chapitres précédents → des fichiers ordinaires dans le **dossier du projet** ; Textus AI les lit quand une demande le nécessite.

## Désactiver Textus AI

Un clic droit sur le bouton **Textus AI**, au bout droit de la barre de la fenêtre, met Textus AI en pause pendant une heure ou la désactive. Tant qu'elle est désactivée, la plume est barrée, et un clic dessus propose de la réactiver ; une pause se termine d'elle-même au bout de l'heure. **Réglages > Textus AI > Activer Textus AI** et un raccourci que vous pouvez définir dans **Réglages > Raccourcis** l'activent ou la désactivent aussi ; sur iPhone, c'est dans le menu.

Tant qu'elle est désactivée, rien n'est envoyé à aucun service d'IA, dès l'ouverture de Textus : ni complétion, ni vérification grammaticale, ni conversation, ni mémoire. Le panneau IA, la question rapide et les entrées IA du menu contextuel disparaissent, et une réponse en cours de rédaction s'arrête. Les modifications déjà proposées dans le document restent, pour que vous les acceptiez ou les refusiez. Chaque fonction garde son propre réglage, et toutes s'appliquent de nouveau dès que Textus AI est réactivée.

## À propos de la confidentialité

Votre document, les fichiers joints ou mentionnés avec @, vos instructions d'écriture, le profil de style, les fiches de la bibliothèque mentionnées et les fichiers du projet que Textus AI lit sont envoyés au fournisseur choisi avec chaque requête ; **Apprendre mon style** envoie les exemples que vous choisissez. Avec la recherche web activée, les recherches partent vers votre fournisseur ou vers le service de recherche affiché dans les réglages, et les pages que lit Textus AI sont téléchargées depuis cet ordinateur. Désactivez une fonction dans les réglages si vous ne voulez pas de cet envoi.
