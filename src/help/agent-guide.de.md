# Anleitung zu den KI-Funktionen von Textus

Textus bringt eine eingebaute KI fürs Schreiben mit, Textus AI: Vervollständigung, Grammatikprüfung und Unterhaltungen, die dein Dokument lesen und überarbeiten. Diese Anleitung erklärt, wie du einen Dienst verbindest, was die KI-Funktionen können und wie du Textus AI mit Ordner, Stilprofil, Lexikon, Schreibanweisungen und Skills zu deinem eigenen Schreibassistenten machst.

## Einen Dienst verbinden

Alles rund um die KI steht unter **Einstellungen › Textus AI**, auf vier Seiten: **Modelle**, **Schreibhilfe**, **Agent** und **Externe Werkzeuge**.

1. Wähle auf **Modelle** den Dienst in der Liste **Anbieter**. Melde dich mit deinem Konto an (**Konto**) oder füge einen Schlüssel ein (**API-Schlüssel**) – je nachdem, was der Dienst unterstützt. Ein Punkt in der Liste markiert jeden Dienst, den du eingerichtet hast.
2. Für einen **Eigenen Endpunkt** (jeder OpenAI-kompatible Server: lokale Modelle, Proxys) gibst du die Basis-URL, bei Bedarf einen Schlüssel und den Modellnamen ein und speicherst.
3. Wähle unter **Modellwahl** oben auf derselben Seite den **Anbieter für den Chat** und das **Chat-Modell**, und für Vervollständigung und Grammatik den **Anbieter fürs Schreiben** (standardmäßig **Wie im Chat**) und das **Assistenzmodell**.

Die Anmeldung läuft in deinem Browser. Ob Bilder, Websuche und Änderungen am Dokument verfügbar sind, hängt vom gewählten Dienst und Modell ab.

Die eingebaute Modellliste enthält nur die Standardmodelle jedes Anbieters (bei Anthropic: Claude Sonnet 5.5 für den Chat, Claude Haiku 5.5 für Vervollständigung und Grammatik). Klicke unter **Modelle** eines Anbieters auf **Modelle abrufen**, um seine aktuelle Liste zu laden und daraus ein beliebiges Modell zu wählen.

Für **Doubao (Volcengine)** erstellst du den API-Schlüssel in der [Volcengine-Ark-Konsole](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) und aktivierst dort auch die Modelle, die du nutzen willst: Anfragen an ein Modell, das dein Konto nicht aktiviert hat, lehnt Ark ab.

Die Tastenkürzel unten sind in macOS-Schreibweise angegeben; unter Windows und Linux drückst du Ctrl (Strg) statt Cmd und Alt statt Option. Wenn du ein Tastenkürzel geändert hast, findest du das aktuelle unter **Einstellungen › Tastenkürzel**.

## Im Alltag

Die fünf Wege, die du am häufigsten nutzen wirst – zuerst das Gespräch mit ihr.

### Unterhaltungen

Unterhaltungen öffnen sich als **Tabs**. Klicke auf die Schaltfläche **Textus AI** (die Funken) am rechten Ende der Fensterleiste, drücke <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> oder wähle **Ansicht › KI-Bereich**: Die KI öffnet sich in einer eigenen Insel rechts. Ihre Tabs sind Tabs wie alle anderen: Zieh einen neben ein Dokument, in eine andere Insel oder hinaus in ein eigenes Fenster.

- **Pro Ordner**: Unterhaltungen gehören zu dem Ordner, in dem du arbeitest, nicht zu einem einzelnen Dokument. Jede offene Unterhaltung ist ein Tab; mit der vorderen sprichst du, und zwar über das vordere Dokument. Eine geschlossene Unterhaltung bleibt im Verlauf.
- **Neue Unterhaltung**: Klicke mit rechts auf das leere Papier eines KI-Tabs und wähle **Neue Unterhaltung** (sind noch Änderungen offen, wird vorher nachgefragt). **Gedächtnis** steht im selben Menü.
- **Verlauf**: Die Uhr oben rechts in einem KI-Tab listet frühere Unterhaltungen nach Ordnern auf, oben mit **Unterhaltungen durchsuchen**, um die zu finden, in denen bestimmte Wörter fielen. Ein Klick öffnet eine wieder. Beziehst du dich auf eine frühere Unterhaltung, durchsucht Textus AI sie ebenfalls. Unter **Einstellungen › Datenschutz & Daten** kannst du das Speichern von Unterhaltungen abschalten.
- **Modus und Modell**: Eine Schaltfläche bei den Bedienelementen des Eingabefelds nennt beides, „Allgemein · Modell“. **Allgemein** arbeitet am Dokument: Es entwirft neuen Text (eine Fortsetzung, einen neuen Absatz oder Abschnitt) und ändert den vorhandenen (umschreiben, übersetzen, kürzen). Ist Text ausgewählt, ersetzt eine Änderung daran die Auswahl, und neuer Text kommt dahinter. **Prüfen** beantwortet Fragen, bespricht und kommentiert, ohne etwas zu ändern. **Recherche** nimmt ein Thema, recherchiert es und schreibt daraus einen Text (siehe **Recherche** unten). Die Liste enthält außerdem jedes Modell der Dienste, die du eingerichtet hast, und die **Agenten**, die du hinzugefügt hast (siehe **Externe Agenten**). Eine neue Unterhaltung beginnt in Prüfen; danach behält das Eingabefeld den Modus, den du zuletzt gewählt hast.
- **@-Erwähnungen**: Tippe `@` ins Eingabefeld, um eine Textdatei aus dem Ordner auszuwählen; sie wird an die Nachricht angehängt.
- **Dateien anhängen**: Die Schaltfläche **+** links neben dem Eingabefeld hängt eine oder mehrere Dateien an die Nachricht an: ein PDF, ein Word-Dokument, eine PowerPoint-Präsentation, eine Tabelle, ein EPUB-E-Book, eine RTF- oder HTML-Datei, eine beliebige Text- oder Code-Datei, ein Zip-Archiv oder ein Bild (PNG, JPEG, GIF, WebP, BMP, TIFF und auf dem Mac HEIC und AVIF). Jede Datei wird in den eigenen temporären Ordner der Unterhaltung kopiert, nie in deine Ordner, und Textus AI kann sie dort noch einmal vollständig lesen. Dokumente werden lokal in Text umgewandelt und mit der Nachricht verschickt; von einem langen wird nur ein Teil gesendet, der Chip zeigt „(gekürzt)“, und den Rest liest Textus AI, wenn es ihn braucht. Ein Zip-Archiv wird dort entpackt und seine Dateien werden aufgelistet. Bilder werden in ein Format umgewandelt, das jeder Dienst liest, bei sehr großen verkleinert und als echte Bilder an Anbieter gesendet, die sie sehen können (die anderen sagen das vorher, statt sie stillschweigend wegzulassen).
- **Websuche**: Mit der Lupe neben dem Eingabefeld sucht Textus AI im Web, wenn eine Anfrage es braucht – siehe **Websuche** unten.
- **Gründlich nachdenken**: Die Schaltfläche neben der Websuche (die Glühbirne) lässt das Modell seine Antwort erst gründlich durchdenken – langsamer und teurer, für schwierige Fragen und größere Überarbeitungen. Sie bleibt eingeschaltet, auch in anderen Dokumenten, bis du sie wieder drückst. Während das Modell nachdenkt, zeigt der Tab „Denkt nach · 8 Sekunden“, danach „12 Sekunden nachgedacht“; ein Klick darauf zeigt die Überlegungen, wenn der Anbieter sie mitliefert. Die Schaltfläche erscheint nur bei Modellen, die gründlicher nachdenken können; die Schnellfrage bittet immer um eine schnelle Antwort.
- **Fehler**: Schlägt eine Anfrage fehl, nennt Textus in deiner Sprache über der Meldung des Anbieters die Art des Problems und was zu tun ist (Schlüssel prüfen, ein aufgebrauchtes Guthaben aufladen, kurz warten, ein anderes Modell wählen) – im Chat ebenso wie bei Vervollständigung und Grammatikprüfung.
- **Lange Dokumente**: Bittest du Textus AI, ein langes Dokument Kapitel für Kapitel zu übersetzen oder umzuschreiben, gibt es jedes Kapitel an einen eigenen Helfer, mit einer gemeinsamen Liste, wie wiederkehrende Namen und Begriffe geschrieben werden, sodass sich das ganze Dokument auf einmal ändert.

### Änderungen an deinen Dokumenten

**Einstellungen › Textus AI › Schreibhilfe › Wie Textus AI Dateien ändert** legt fest, wie die Änderungen von Textus AI in deinen Text kommen:

- **Als Überarbeitungen zum Prüfen** (Standard): Jede Änderung ist eine Überarbeitung, die dort angezeigt wird, wo sie landen würde, und nichts ist endgültig, bis du sie annimmst.
- **Direkt geschrieben**: Änderungen werden geschrieben, sobald sie ankommen. Sie bleiben markiert, sodass du siehst, was sich geändert hat, und jede Antwort lässt sich rückgängig machen.

Ein Recherche-Text wird in jedem Fall direkt geschrieben. <kbd>Cmd</kbd>+<kbd>Z</kbd> macht eine angenommene Änderung in einem Schritt rückgängig.

**Wie Überarbeitungen aussehen**: **Überarbeitungen anzeigen** (Schreibhilfe, oder die Augen-Schaltfläche in der Prüfleiste) hat drei Ansichten:
- **Nur das Ergebnis, Original am Rand** (Standard);
- **Original im Text, Änderungen am Rand**;
- **Alles im Text**: Entfernter Text ist durchgestrichen, neuer Text grün.

Neuer Text steht immer im Text. Ist kein Platz für einen Rand (schmales Fenster, Seitenleiste und KI offen), warten die Rand-Ansichten, und der Text zeigt alles.

- **Die Prüfleiste**: Eine Leiste unten im Dokument sammelt alles, was dort wartet, Änderungen wie Notizen. Geh sie mit ‹ › durch (oder <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd>), **Annehmen** oder **Ablehnen** einzeln, oder **Alle annehmen** / **Alle ablehnen**. Jeder geänderte Satz hat außerdem ✓ / ✕ im Text; nimmst du nur einige, zeigt die Leiste „2 von 5 annehmen“. Per Tastatur: <kbd>Cmd</kbd>+<kbd>Return</kbd> nimmt an, <kbd>Cmd</kbd>+<kbd>Delete</kbd> lehnt ab, wenn der Cursor auf einer Änderung steht.
- **Begründungen**: Jede Vorschlagskarte in der Unterhaltung sagt, warum Textus AI die Änderung vorgenommen hat.
- **Am Cursor**: Wenn nichts ausgewählt ist, weiß Textus AI, wo dein Cursor steht – „schreib hier einen Übergang“ fügt also genau dort ein.
- **Kommentare statt Änderungen**: Bitte um eine Durchsicht („Was ist hier schwach?“), und Textus AI heftet Kommentare an Textstellen, ohne sie zu ändern. Jede Kommentarkarte hat **Im Dokument anzeigen**, das die betreffende Stelle auswählt.
- **Eigene Notizen**: Markiere ein paar Wörter, klicke mit rechts und wähle **Notiz hinzufügen**: Deine Notiz kommt an den Rand neben die von Textus AI, markiert mit Ich. Notizen werden neben den eigenen Daten von Textus gespeichert, nicht in deinem Markdown.
- **Meine Änderungen nachverfolgen** (Menü Ansicht): Solange es eingeschaltet ist, erscheinen auch deine eigenen Bearbeitungen als Änderungen – Gelöschtes durchgestrichen, Hinzugefügtes markiert –, jede mit einer Karte am Rand, markiert mit Ich, zum Annehmen oder Ablehnen. Die Datei behält das Original, nur mit den übernommenen Änderungen; die noch offenen werden wie die von Textus AI daneben im Ordner `.textus` gespeichert und sind beim nächsten Öffnen wieder da – teilst du den Ordner, gehen sie mit.

**Andere Dateien im Ordner**: Textus AI kann auch Dateien ändern, die du nicht geöffnet hast.

- **Als Überarbeitungen zum Prüfen**: Eine Änderung an einer solchen Datei wartet darin als Überarbeitung. Sie erscheint im Text, wenn du die Datei öffnest, zum Annehmen oder Ablehnen wie oben. Der Dateibaum und der Tab der Datei markieren sie mit „3 zu prüfen“.
- **Eine neue Datei, die es anlegt**, wartet darauf, behalten zu werden: **Behalten** oder **Verwerfen** (sie kommt in den Papierkorb).
- **Direkt geschrieben**: Die Änderung wird sofort geschrieben, und der Text davor bleibt erhalten, damit sie sich rückgängig machen lässt.
- **Die Karte der Antwort** listet die Dateien auf, die sie berührt hat, mit **Rückgängig**, **Anwenden**, **Behalten** und **Verwerfen**. Eine Datei, die du in der Zwischenzeit bearbeitet hast, hält ihre Änderung getrennt, markiert mit „Seitdem geändert“; **Verwerfen** lässt sie fallen.

### Vervollständigung

Während du tippst, erscheint am Cursor eine graue Fortsetzung – mit <kbd>Tab</kbd> übernimmst du sie, mit <kbd>Cmd</kbd>+<kbd>→</kbd> nur das nächste Wort, und der Rest bleibt als Vorschlag stehen. <kbd>Esc</kbd> verwirft sie. Eine Mindestmenge an Text braucht es nicht; die Vervollständigung arbeitet schon ab dem ersten Satz eines Dokuments.

Gezielt anfordern kannst du eine mit <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> oder über das Kontextmenü (der Cursor muss am Ende eines Absatzes stehen): Dann bekommst du eine längere Fortsetzung mit bis zu drei Alternativen – mit <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> blätterst du durch sie.

Unter **Einstellungen › Textus AI › Schreibhilfe › Weiterschreiben & Prüfen** kannst du die Vervollständigung ein- oder ausschalten und einen **Tonfall der Vervollständigung** wählen (Passend zum Dokument / Förmlich / Locker / Wissenschaftlich / Knapp). Gehört das Dokument zu einem Ordner mit Stilprofil oder Lexikon (siehe **Textus AI an dich anpassen** weiter unten), richtet sich die Vervollständigung auch danach.

### Grammatikprüfung

Mögliche Fehler werden unterstrichen. Bewege den Zeiger auf eine Unterstreichung oder setze den Cursor hinein, um die Erklärung zu sehen; **Übernehmen** (oder <kbd>Option</kbd>+<kbd>Enter</kbd>, wenn der Cursor darauf steht) korrigiert den Fehler, **Ignorieren** verwirft den Hinweis. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> prüft den aktuellen Absatz sofort. **Prüfstufe** (Schreibhilfe › Weiterschreiben & Prüfen) legt fest, wie viel angemerkt wird.

### Schnellfrage

Mit <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (oder Rechtsklick > **KI fragen…**) öffnest du direkt unter dem aktuellen Absatz eine kleine Chatleiste. Sie sitzt im Dokument und schiebt den Text darunter nach unten, statt ihn zu verdecken. War beim Öffnen Text ausgewählt, wird die Auswahl mitgeschickt. Die Schnellfrage öffnet sich im Modus **Allgemein**, weil man sie meist an einer Textstelle öffnet, die sich ändern soll („kürze das“); Prüfen ist in der Modusauswahl nur einen Klick entfernt.

- **Das Tastenkürzel noch einmal**: Drückst du <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> bei geöffneter Leiste, springt der Cursor in ihr Eingabefeld; drückst du es dort noch einmal, schließt sie sich. Auch <kbd>Esc</kbd> schließt sie von überall in der Leiste, und der Cursor kehrt ins Dokument zurück. Sind noch Änderungen offen, wird vor dem Schließen (oder vor einer neuen Unterhaltung) nachgefragt.
- Die Schnellfrage führt ihre eigene kurze Unterhaltung, getrennt von denen der KI-Tabs und ohne Eintrag im Verlauf. **In der vollständigen Unterhaltung fortsetzen** (die Schaltfläche in ihrer Ecke) übergibt den Austausch an einen KI-Tab, wo er weitergeht und gespeichert wird.

## Textus AI an dich anpassen

Was Textus AI über dich und deine Arbeit weiß, steht in ein paar einfachen Markdown-Dateien, nicht in versteckten Einstellungen. Jede hat genau eine Aufgabe:

| Konzept | Was es ist | Wo es liegt |
| --- | --- | --- |
| **Ordner** | Der Ordner, in dem Textus AI arbeitet und lesen darf | Der Ordner, den du in der Seitenleiste öffnest, oder einer, den du wählst |
| **Stilprofil** | Wie du schreibst | `.textus/style.md` |
| **Lexikon** | Fakten zu Personen, Orten und Begriffen | `.textus/library/` |
| **Schreibanweisungen** | Feste Regeln für jede Unterhaltung | `agent.md` – global und pro Ordner |
| **Gedächtnis** | Was sich Textus AI aus deinen Unterhaltungen merkt | `memory/` im globalen Konfigurationsordner und daneben `projects/<folder>/memory/` für jeden Ordner |
| **Skills** | Wiederverwendbare Anweisungen, die du mit `/name` aufrufst | `skills/` – global und pro Ordner |
| **Globaler Konfigurationsordner** | Was für jedes Dokument gilt | Der Einstellungsordner der App |

„Unterhaltungen“ meint im Folgenden die KI-Tabs und die Schnellfrage. So sieht ein ganzer Ordner auf einen Blick aus:

```
mein-roman/              ← der Ordner
├── kapitel-1.md         ← das Dokument, das du bearbeitest
├── notizen/
│   └── zeitleiste.md    ← Material, das Textus AI lesen kann
└── .textus/              ← die eigenen Einstellungen des Ordners
    ├── style.md         ← Stilprofil
    ├── agent.md         ← Schreibanweisungen für diesen Ordner
    ├── library/
    │   ├── lin-wan.md   ← ein Eintrag pro Figur, Ort oder Begriff
    │   └── harbour-city.md
    └── skills/
        └── straffen.md  ← ein Skill pro Datei
```

Das Ordnermenü legt `.textus/` und die Dateien darin an, sobald du sie zum ersten Mal brauchst; nur Ordner-Skills fügst du von Hand hinzu. Text in `<!-- -->`-Kommentaren ist in all diesen Dateien eine Notiz für dich selbst und wird nie gesendet.

### Der Ordner

**Der Ordner ist der Ort, an dem Textus AI arbeitet.** Es ist der Ordner, den du in der Seitenleiste öffnest (**Datei › Ordner öffnen…**), oder einer, den du wählst – sonst der nächste Ordner über dem Dokument, der einen `.textus/`-Ordner enthält, sodass ein Kapitel in `novel/part-1/` zu `novel/` gehört. Ein Dokument, das du einzeln öffnest, hat keinen Ordner: Textus AI liest dann nur das Dokument und die Dateien, die du anhängst, sodass eine Datei in Downloads oder auf dem Schreibtisch ihm nie den ganzen Ordner öffnet.

- Textus AI kann die Dateien darin auflisten, nach Namen finden, lesen und durchsuchen, um frühere Szenen einer Figur, einen Begriff oder deine Notizen zu finden: Textdateien (Markdown, reiner Text und ähnliche Formate) bis 16 MB, die es abschnittsweise liest, wenn sie lang sind, und den Text von PDF-, Word-, PowerPoint-, Tabellen-, EPUB- und RTF-Dateien. Mit einem Anbieter, der Bilder sehen kann, sieht es sich auch die PNG-, JPEG-, GIF- und WebP-Bilder darin an, bis 6 MB pro Bild. Versteckte Dateien und Ordner, was eine `.gitignore`- oder `.ignore`-Datei ausschließt (wie bei der Dateisuche in der Seitenleiste), Build- und Abhängigkeitsordner (etwa `node_modules`) und gescannte PDFs ohne Textebene bleiben außen vor.
- Tippst du `@` ins Eingabefeld des Chats, hängst du eine seiner Dateien an deine Nachricht an.
- Sein Ordner `.textus/` enthält Stilprofil, Lexikon, Schreibanweisungen und Skills des Ordners.

Klicke mit rechts auf das leere Papier eines KI-Tabs und wähle **Gedächtnis**: Die oberste Zeile zeigt den Namen des Ordners; ein Klick darauf öffnet das **Ordnermenü**. Liegt dein Material nicht neben dem Entwurf, nimm dort **Ordner wählen…** (oder **Einstellungen › Textus AI › Agent › Ordner**). Der gewählte Ordner gilt für jedes Dokument – auch für ungespeicherte Entwürfe –, bis du **Keinen Ordner verwenden** wählst.

> [!TIP]
> Dein Entwurf liegt in `masterarbeit/entwürfe/` und deine Interviewnotizen in `masterarbeit/recherche/`? Wähle `masterarbeit/` als Ordner, dann kann Textus AI `recherche/interviews.md` lesen, während du an `entwürfe/kapitel-2.md` arbeitest.

Alles, was Textus AI liest, muss im Ordner liegen: `..`, absolute Pfade und Links nach außen werden abgewiesen. Ohne geöffneten oder gewählten Ordner gibt es keinen Ordner, und ein zu weit gefasster Ordner – dein Benutzerordner oder ein ganzes Laufwerk – wird abgewiesen. Was Textus AI bei der Arbeit erzeugt (Recherchenotizen, Entwürfe in Arbeit), landet in Textus' eigenen Ordnern oder im temporären Ordner des Systems, nicht in deinem.

### Das Stilprofil – „Meinen Stil lernen“

**Das Stilprofil beschreibt, wie du schreibst**, damit Fortsetzungen und Änderungen nach dir klingen: Stimme und Ton, Satzrhythmus, Wortwahl, Zeichensetzung, was du nie tust. Textus AI richtet sich in Unterhaltungen danach, die Vervollständigung beim Tippen, und zwar in jedem Dokument des Ordners. Es ist die Datei `.textus/style.md`.

Es gibt zwei Wege, eines anzulegen, beide im Ordnermenü:

- **Meinen Stil aus Textproben lernen…** – wähle ein paar Dateien mit eigenen Texten (bis zu acht). Textus AI analysiert sie und entwirft ein Profil – Stimme und Ton, Sätze und Rhythmus, Wortwahl, Zeichensetzung, Aufbau, Tabus und einige kurze Zitate als Beispiele – und öffnet es in einem neuen Tab. Lies es, korrigiere es, ergänze es: Es gehört dir. Lernt Textus AI erneut, bleibt das bisherige Profil als `style.previous.md` erhalten.
- **Stilprofil erstellen** – beginne mit einer leeren Gliederung und schreib es selbst.

Sobald es ein Profil gibt, öffnet es **Stilprofil öffnen** im Ordnermenü (und die Stil-Zeile unter Gedächtnis).

```markdown
# Stilprofil

## Sätze und Rhythmus
- Kurze Sätze, selten über 15 Wörter.
- Beginnt einen Absatz mit einer konkreten Szene, dann folgt die Aussage.

## Tabus
- Keine Ausrufezeichen. Kein „plötzlich“.
```

Konkrete, überprüfbare Punkte funktionieren besser als Adjektive: „kurze Sätze, selten über 15 Wörter“ statt „knapp“. Beschränke dich auf ein bis zwei Seiten; verwendet werden nur die ersten 6.000 Zeichen. Der **Tonfall der Vervollständigung** in den Einstellungen gilt ebenfalls – lass ihn auf *Passend zum Dokument*, wenn dein Stilprofil deine Stimme schon beschreibt.

### Das Lexikon

**Das Lexikon enthält Fakten, die einheitlich bleiben müssen**: eine Markdown-Datei pro Figur, Ort oder Begriff, in `.textus/library/`. **Neuer Lexikoneintrag…** im Ordnermenü fragt nach einem Namen und öffnet den neuen Eintrag; unter Gedächtnis sind alle aufgelistet.

```markdown
---
name: Lin Wan
aliases: [Wan, Frau Lin]
include: detected
---

Protagonistin, 32, unterrichtet Chinesisch an einem Gymnasium in Harbour City.
Linkshänderin. Spricht nie über ihren Bruder.
```

Einträge hängst du nicht selbst an. Ein Eintrag mit `include: detected` (der Standard) geht an Textus AI, sobald sein Name oder einer seiner Aliasse vorkommt: in einer Unterhaltung in deiner Nachricht oder im Dokument, bei der Vervollständigung im Text rund um den Cursor. `always` sendet ihn mit jeder Anfrage, `never` hält ihn heraus. Einträge, die nicht erwähnt werden, kosten nichts – das Lexikon kann also so groß werden, wie dein Projekt es braucht.

### Schreibanweisungen (agent.md)

**Schreibanweisungen sind feste Regeln, die mit jeder Unterhaltung gesendet werden**: worum es im Ordner geht, in welcher Sprache geantwortet wird, Schreibweisen und Begriffe, was Textus AI immer oder nie tun soll. Sie stehen in Dateien namens `agent.md`, auf zwei Ebenen:

- **Global**, für jedes Dokument: **Einstellungen › Textus AI › Agent › Schreibanweisungen (agent.md) › agent.md bearbeiten**.
- **Ordner**, für die Dokumente eines Ordners: `.textus/agent.md`, zu öffnen mit **Schreibanweisungen des Ordners bearbeiten** im Ordnermenü.

Beide öffnen sich in einem Tab und beginnen mit einer kurzen Anleitung in Kommentaren. Gibt es beide, bekommt Textus AI beide – zuerst die globalen Anweisungen, dann die des Ordners –, und wo sie sich widersprechen, gelten die des Ordners.

```markdown
Das Buch ist ein Kriminalroman im Shanghai der 1930er-Jahre, erzählt von Lin Wan in der Ich-Form.
Antworte immer auf Deutsch, auch wenn der Roman auf Chinesisch geschrieben ist.
Schreib „Shanghai“, nie „Schanghai“.
```

Schreibanweisungen gelten nur für Unterhaltungen. Die Vervollständigung liest sie nicht; sie richtet sich nach Stilprofil und Lexikon.

### Was sich Textus AI merkt

**Textus AI merkt sich, worum du bittest und wie du schreibst**, ohne dass du eine Datei schreiben musst. Wenn du etwas sagst, das über eine einzelne Anfrage hinaus gelten soll – „immer Schweizer Rechtschreibung“, „keine Gedankenstriche“, eine Korrektur, die du zweimal machen musstest – oder einen Fakt über dein Werk nennst, etwa wer eine Figur ist, merkt sich Textus AI das und hält sich in späteren Unterhaltungen daran. Jedes Mal zeigt eine Zeile unter der Antwort, was gemerkt wurde und wo: **Rückgängig** nimmt es zurück, **Global machen** oder **Nur für diesen Ordner** verschiebt es.

- **Dieser Ordner**: was dieses Werk betrifft, in `projects/<folder>/memory/` im globalen Konfigurationsordner (Textus verwahrt es dort, nicht in deinem Ordner); Fakten zu Personen, Orten und Begriffen kommen ins Lexikon.
- **Für alle Ordner**: deine allgemeinen Gewohnheiten, in `memory/` im globalen Konfigurationsordner. Ohne Ordner landet alles hier.

**Gedächtnis** (Rechtsklick auf das Papier eines KI-Tabs › Gedächtnis) listet alles auf, jeweils mit Zeitpunkt und Unterhaltung: **Bearbeiten** öffnet einen Eintrag, **Löschen** entfernt ihn. Ab und zu räumt Textus AI sein Gedächtnis auf, führt Erinnerungen zusammen, die dasselbe sagen, und verwirft eine Regel, die eine neuere aufgehoben hat; was es verworfen hat, steht unter **Kürzlich vergessen** und lässt sich zurückholen. Bei einem Widerspruch gelten deine eigenen Schreibanweisungen, und Textus AI ändert nie deine `agent.md` oder dein Stilprofil. Gibt es zu viele Erinnerungen zum Senden, bleiben die ältesten außen vor, und Gedächtnis weist darauf hin. Der Schalter **Gedächtnis** (Einstellungen › Textus AI › Agent) schaltet die Funktion aus.

**Es lernt auch aus deinen Überarbeitungsentscheidungen.** Wenn du dieselbe Art von Änderung mehrmals ablehnst – 「」 zu “” gemacht, ein Wort gegen ein anderes getauscht, Sätze geteilt, ein Oxford-Komma eingefügt –, bietet Textus AI nach der Durchsicht an, sie als Vorgabe zu merken: **Merken** speichert sie unter **Gedächtnis**, **Jetzt nicht** wartet auf mehr, und **Nicht mehr fragen** fragt nach dieser Art nicht mehr. Es fragt höchstens einmal am Tag, und gespeichert wird nur auf deinen Klick, auch wenn das Gedächtnis ausgeschaltet ist. Gezählt wird nur eine kurze Notiz, welche Arten von Änderungen du angenommen oder abgelehnt hast – auf diesem Computer neben deinen Erinnerungen gespeichert und nie gesendet.

### Skills (/name)

**Ein Skill ist eine wiederverwendbare Sammlung von Anweisungen mit einem Namen** – „straffen“, „gliedern“, „Quellenangaben prüfen“ –, gespeichert in einer Markdown-Datei: oben ein Name und eine einzeilige Beschreibung, darunter die vollständigen Anweisungen.

```markdown
---
name: straffen
description: Strafft die ausgewählte Passage, ohne ihre Bedeutung zu ändern
---

Überarbeite den Text Satz für Satz: Streiche überflüssige Wörter,
teile zu lange Sätze und bewahre Bedeutung und Ton des Originals.
Gib nur den überarbeiteten Text aus.
```

Einen Skill kannst du auf zwei Arten verwenden:

1. **Aufrufen**: Tippe `/` ins Eingabefeld des Chats und wähle ihn aus dem Menü, oder tippe seinen Namen und danach deine Bitte: `/straffen sieh dir das noch einmal an`.
2. **Einfach fragen** (nur bei Anbietern mit Tool Calling): Textus AI kennt Namen und Beschreibung jedes Skills; passt deine Anfrage zu einem, lädt Textus AI von selbst die vollständigen Anweisungen und befolgt sie.

War deine Bitte ein eigenes Vorgehen – Schritte, die du wieder brauchen wirst –, bietet Textus AI unter seiner Antwort an, es als Skill zu behalten, für jedes Dokument oder nur für diesen Ordner. Gespeichert wird nur, wenn du es auswählst.

Skills gibt es auf denselben zwei Ebenen wie Schreibanweisungen: globale Skills im Ordner `skills/` des globalen Konfigurationsordners (**Skill importieren…** oben bei Skills unter **Einstellungen › Textus AI › Agent** kopiert eine Skill-Datei dorthin), Ordner-Skills in `.textus/skills/` (ein versteckter Ordner – im Finder von macOS blendet <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> ihn ein). Ein Ordner-Skill mit demselben Namen wie ein globaler ersetzt diesen.

### Integrierte Skills

Textus bringt vier Skills mit. **Korrektur lesen** im Modus Prüfen prüft Rechtschreibung, Grammatik, Zeichensetzung und Zahlen nach den Regeln der Sprache des Textes. **Design entwerfen**, **Plugin bauen** und **Fähigkeit erstellen** machen nach deiner Beschreibung ein Editor-Design, ein kleines Plugin oder einen eigenen Skill, jeweils in einem eigenen Tab: **Eigenes Theme erstellen** steht im Theme-Store unter Darstellung, **Eigenes Plugin erstellen** im Menü **⋯** des Bereichs Plugins. Weitere Skills – Ausbauen, Straffen, Übersetzen, Zusammenfassen, Kontinuität prüfen, E-Mail, Protokoll und andere – findest du unter **Verfügbar** am Ende von Skills unter **Einstellungen › Textus AI › Agent**. Tipp `/` und wähl einen aus, oder gib seinen Namen in einer beliebigen Sprache der App ein: `/proofread`, `/校对` und `/校正` rufen denselben Skill auf. Textus AI wählt auch selbst einen Skill, wenn deine Anfrage dazu passt. **Design entwerfen** schreibt das CSS des Designs in die Antwort: **Dieses Design verwenden** darunter installiert es; oder speichere es als .css-Datei und füge es mit **Design aus einer CSS-Datei hinzufügen** unter **Einstellungen › Darstellung** hinzu.

Die integrierten Skills stehen oben bei Skills unter **Einstellungen › Textus AI › Agent** und sind immer aktiv. **Anpassen…** kopiert einen Skill in den Ordner `skills/` des globalen Konfigurationsordners und öffnet die Kopie, damit du seine Anweisungen ändern kannst; ab dann läuft deine Kopie. **Zurücksetzen** löscht die Kopie und stellt die integrierte Fassung wieder her. Darunter stehen die Skills, die du hinzugefügt hast. Jeder zeigt die Modi, in denen er arbeitet – ein Klick ändert sie –, und sein Schalter schaltet ihn vorerst aus; die Modi bleiben erhalten, bis du ihn wieder einschaltest. Ein eigener Skill mit dem Namen eines integrierten ersetzt diesen.

### Schreibkonventionen

**Schreibkonventionen** (Einstellungen › Textus AI › Schreibhilfe › Weiterschreiben & Prüfen) legt fest, welchen Regeln für Zeichensetzung, Leerzeichen und Zahlen Textus AI und die Grammatikprüfung folgen. **Automatisch** wendet die nationale Norm an, wo eine Sprache eine hat (etwa GB/T für vereinfachtes Chinesisch oder JTF für Japanisch); sonst folgt es dem, was dein Dokument schon überwiegend tut, und weist nur auf Uneinheitliches hin. Wählst du ein Profil, zum Beispiel **DIN 5008** für Deutsch oder **GOV.UK** für britisches Englisch, werden Dokumente in dieser Sprache danach geprüft.

Ein Ordner kann ein eigenes festlegen: Füg im Stilprofil (`.textus/style.md`) zwischen den beiden `---`-Zeilen am Anfang eine Zeile `conventions:` ein. Für die Dokumente dieses Ordners hat sie Vorrang vor der Einstellung.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### Der globale Konfigurationsordner

**Der globale Konfigurationsordner enthält, was für jedes Dokument gilt**: deine globale `agent.md` und deine globalen Skills. Er gehört zur App, nicht zu einem Ordner; **Einstellungen › Textus AI › Agent › Globaler Konfigurationsordner › Anzeigen** zeigt ihn.

```
agent/                ← der globale Konfigurationsordner
├── agent.md          ← globale Schreibanweisungen
└── skills/
    └── gliedern.md   ← ein globaler Skill
```

Ein globales Stilprofil oder Lexikon gibt es nicht: Beide beschreiben ein bestimmtes Werk und gehören deshalb zu einem Ordner.

### Was wann gilt

| | Unterhaltungen | Vervollständigung | Grammatikprüfung |
| --- | :---: | :---: | :---: |
| Dateien des Ordners (lesen, suchen, `@`) | ✓ | | |
| Stilprofil | ✓ | ✓ | |
| Lexikoneinträge, die vorkommen | ✓ | ✓ | |
| Schreibanweisungen | ✓ | | |
| Was sich Textus AI gemerkt hat | ✓ | | |
| Skills | ✓ | | |
| Tonfall der Vervollständigung (Einstellungen) | | ✓ | |

- **Erst global, dann Ordner.** Schreibanweisungen beider Ebenen werden gesendet, die des Ordners zuletzt, und bei einem Widerspruch gelten die des Ordners. Ein Ordner-Skill ersetzt einen globalen Skill gleichen Namens.
- **Immer nur ein Ordner.** Nur dessen `.textus/` zählt: Hast du einen Ordner gewählt, wird ein `.textus/` neben dem Dokument nicht gelesen.
- **Kein Neustart nötig.** Bearbeite eine dieser Dateien, und die nächste Anfrage verwendet die neue Fassung (die Vervollständigung nach etwa zehn Sekunden).

### Welche Datei wofür?

- Wie dein Text klingen soll → das **Stilprofil**.
- Wer ist wer, was ist was → das **Lexikon**.
- Was Textus AI in einer Unterhaltung wissen oder immer tun soll → die **Schreibanweisungen**.
- Eine Aufgabe, um die du immer wieder bittest → ein **Skill**.
- Notizen, Recherche, frühere Kapitel → normale Dateien im **Ordner**; Textus AI liest sie, wenn eine Anfrage sie braucht.

## Mehr

### Recherche

Wähle **Recherche** in der Modus-Schaltfläche und schick ein Thema statt einer Bitte: Textus AI recherchiert es – im Web, in deinem Ordner, in den Papers, die du anhängst –, erstellt eine Gliederung und schreibt den Text ins Dokument. Tippe `/`, um die Art des Textes zu wählen (ein Essay, ein Bericht, ein Literaturüberblick und anderes), oder lass es auf **Automatisch wählen**. **Mit Unteragenten recherchieren** (Schreibhilfe) lässt es Teile der Recherche an Helfer abgeben, die gleichzeitig arbeiten; **Zitate prüfen** lässt jeden zitierten Satz an seinen Quellen prüfen, bevor der Text fertig ist. Ein Recherche-Text wird direkt ins Dokument geschrieben, ganz gleich, was **Wie Textus AI Dateien ändert** sagt.

### Websuche

Schalte die Schaltfläche **Websuche** neben dem Eingabefeld ein, und Textus AI schlägt im Web nach, wenn eine Anfrage aktuelle Fakten braucht oder solche, bei denen es unsicher ist. Es kann auch eine Seite lesen, deren Adresse du einfügst.

- **Wer sucht**: Modelle, die selbst suchen – OpenAI, Claude, Grok, OpenRouter, Groq, Qwen und Zhipu GLM –, nutzen ihre eigene Suche. Bei jedem anderen Modell (DeepSeek, Gemini, Mistral, Kimi, lokale Modelle, eigene Endpunkte) sucht Textus, mit dem **Suchdienst**, der unter **Einstellungen › Textus AI › Schreibhilfe › Web und Proxy** gewählt ist: **Automatisch** nimmt einen DeepSeek-, Zhipu- oder Kimi-Schlüssel, den du schon für den Chat gespeichert hast; oder wähle Bocha, Tavily, Brave Search oder Exa und füge dessen Schlüssel ein, oder SearXNG und gib die Adresse deines eigenen Servers an. Die Zeile sagt, wohin deine Suchanfragen gehen. Ist nichts zum Suchen eingerichtet, zeigt die Schaltfläche einen roten Punkt.
- **Quellen**: Die Antwort zitiert, was sie gefunden hat, als [1], [2] und listet diese Seiten darunter auf; ein Klick öffnet eine im Browser. Die Nummern bleiben in der ganzen Unterhaltung gleich.
- **Quellen als Fußnoten**: Stützt sich ein Vorschlag auf das Web, zeigt seine Karte **Quellen als Fußnoten einfügen**. Angehakt fügt das Annehmen am Ende des Dokuments Markdown-Fußnoten für seine Quellen ein; ohne Haken kommt der Text ohne sie. Die Karte merkt sich deine letzte Wahl.
- **Seiten werden gelesen, nicht befolgt**: Was auf einer Seite steht, ist nie eine Anweisung an Textus AI, und es schlägt Änderungen weiterhin nur vor. Textus liest nur Seiten aus dem öffentlichen Web, nie von deinem Computer oder aus deinem lokalen Netzwerk.

### Bilder

Textus AI kann Bilder für dein Dokument erstellen. **Bilddienst** (Einstellungen › Textus AI › Modelle › Modellwahl) folgt standardmäßig deinem Chat-Anbieter: Bist du mit ChatGPT angemeldet, gehen die Bilder vom Kontingent deines Abos ab (als experimentell markiert – es ist keine veröffentlichte API); bei einem anderen Anbieter, der Bilder erstellt, von dessen eigenem, mit demselben Schlüssel. Ein Anbieter, der keine Bilder erstellt, bietet keine an, bis du einen Dienst wählst – OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow oder einen OpenAI-kompatiblen Endpunkt – und dann dessen Modell.

- Bitte im Modus Allgemein darum („füge nach dem ersten Absatz ein Bild vom Hafen ein“) oder klicke mit rechts auf einen Absatz und wähle **Diesen Absatz bebildern**.
- Text und Bilder kommen zusammen: Der Text erscheint, während er geschrieben wird, und jedes Bild zeigt sich an seiner Stelle als sanft bewegter Rahmen, bis es fertig ist. Du kannst es annehmen, bevor es fertig ist; gespeichert wird es, wenn es ankommt.
- Gespeichert wird erst, wenn du annimmst: dann so, wie **Einstellungen › Bearbeiten › Bilder** es für ein eingefügtes Bild vorsieht, und als Markdown-Bild eingesetzt. Ablehnen hinterlässt nichts.
- Soll ein vorgeschlagenes Bild neu gezeichnet werden, zeig darauf, wähle **Neu zeichnen…** und sag, was sich ändern soll; nur dieses Bild wird neu gezeichnet. Bilder in einem Text behalten dieselben Personen und denselben Stil: Wer wiederkommt, wird mit denselben Worten beschrieben, und wo das Bildmodell ein Vorlagebild annimmt, geht ein neues Bild von ihnen von einem früheren aus.
- Um ein Bild zu ändern, klicke mit rechts darauf, wähle **Dieses Bild mit Textus AI ändern…** und sag, wie. Das neue wird an seiner Stelle vorgeschlagen; sobald du es annimmst, wirst du gefragt, ob die alte Datei in den Papierkorb soll – sie bleibt, solange du nichts anderes sagst.
- Sag, wie viele Bilder du willst, und Textus AI macht so viele, bis zu **Bilder pro Anfrage** (Modelle › Modellwahl; zwei, solange du es nicht änderst). Lehnt der Dienst eine Beschreibung ab, zeigt der Platz des Bildes die Begründung, die er gegeben hat.

### Externe Agenten

Coding-Agenten wie Claude Code oder Codex können über Plugins in Textus arbeiten. Ist einer hinzugefügt, hat er eine Schaltfläche neben der Schaltfläche Textus AI in der Fensterleiste und steht in der Gruppe **Agenten** der Modus-Schaltfläche: Wählst du ihn, gehen deine Nachrichten an ihn statt an ein Modell. Bevor er eine Datei ändert, fragt er dich in der Unterhaltung. **Einstellungen › Textus AI › Externe Werkzeuge** listet sie unter **ACP Agent** auf (**Agents holen…** öffnet den Bereich Plugins), und darüber die **MCP-Server**, deren Werkzeuge Textus AI nutzen darf.

## Textus AI ausschalten

Ein Rechtsklick auf die Schaltfläche **Textus AI** am rechten Ende der Fensterleiste pausiert Textus AI für eine Stunde oder schaltet sie aus. Solange sie aus ist, sind die Funken durchgestrichen, und ein Klick darauf bietet an, Textus AI wieder einzuschalten; eine Pause endet nach der Stunde von selbst. Die Befehlspalette (**Textus AI ein- oder ausschalten**) und ein Tastenkürzel, das du unter **Einstellungen › Tastenkürzel** festlegen kannst, tun das ebenfalls; auf dem iPhone steht es im Menü.

Solange sie aus ist, wird ab dem Start von Textus nichts an einen KI-Dienst gesendet: keine Vervollständigung, keine Grammatikprüfung, keine Unterhaltung, nichts wird gemerkt. Die KI-Tabs, die Schnellfrage und die KI-Einträge im Kontextmenü verschwinden, und eine Antwort, die gerade geschrieben wird, hält an. Bereits vorgeschlagene Änderungen im Dokument bleiben, damit du sie annehmen oder ablehnen kannst. Jede Funktion behält ihre eigene Einstellung, und alle gelten wieder, sobald Textus AI wieder an ist.

## Ein Hinweis zum Datenschutz

Dein Dokument, angehängte und per @ erwähnte Dateien, deine Schreibanweisungen, das Stilprofil, die vorkommenden Lexikoneinträge und alle Dateien im Ordner, die Textus AI liest, werden mit jeder Anfrage an den gewählten Anbieter gesendet; **Meinen Stil lernen** sendet die Textproben, die du auswählst. Bei eingeschalteter Websuche gehen Suchanfragen an deinen Anbieter oder an den Suchdienst, den die Einstellungen anzeigen, und die Seiten, die Textus AI liest, werden von diesem Computer abgerufen. Schalte in den Einstellungen jede Funktion aus, bei der du das nicht möchtest.
