# Anleitung zu den KI-Funktionen von Textus

Textus bringt eine eingebaute KI fürs Schreiben mit, Textus AI: Vervollständigung, Grammatikprüfung und Unterhaltungen, die dein Dokument lesen und überarbeiten. Diese Anleitung erklärt, wie du einen Dienst verbindest, was die KI-Funktionen können und wie du Textus AI mit Projektordner, Stilprofil, Lexikon, Schreibanweisungen und Skills zu deinem eigenen Schreibassistenten machst.

## Einen Dienst verbinden

1. Öffne **Einstellungen > Textus AI** und wähle unter **Verbindung > Anbieter** den gewünschten Dienst.
2. Klappe **Anmeldung & Zugangsdaten** auf und melde dich mit deinem Konto an oder gib einen API-Schlüssel ein – je nachdem, was der Dienst unterstützt.
3. Wählst du **Eigener Endpunkt** (jeder OpenAI-kompatible Server: lokale Modelle, Proxys), gib die Basis-URL, bei Bedarf einen Schlüssel und den Modellnamen ein und speichere.
4. Wähle unter **Schreibassistenz** das **Assistenzmodell** und unter **Chat mit Textus AI** das **Chat-Modell**.

Die Anmeldung läuft in deinem Browser. Ob Bilder, Websuche und Änderungen am Dokument verfügbar sind, hängt vom gewählten Dienst und Modell ab.

Die eingebaute Modellliste enthält nur die Standardmodelle jedes Anbieters (bei Anthropic: Claude Sonnet 5.5 für den Chat, Claude Haiku 5.5 für Vervollständigung und Grammatik). Klicke in der Zeile **Modellliste** unter **Verbindung** auf **Modelle abrufen**, um die aktuelle Liste des Anbieters zu laden und daraus ein beliebiges Modell zu wählen.

Für **Doubao (Volcengine)** erstellst du den API-Schlüssel in der [Volcengine-Ark-Konsole](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) und aktivierst dort auch die Modelle, die du nutzen willst: Anfragen an ein Modell, das dein Konto nicht aktiviert hat, lehnt Ark ab.

Die Tastenkürzel unten sind in macOS-Schreibweise angegeben; unter Windows und Linux drückst du Ctrl (Strg) statt Cmd und Alt statt Option. Wenn du ein Tastenkürzel geändert hast, findest du das aktuelle unter **Einstellungen > Tastenkürzel**.

## Die KI-Funktionen

### 1. Vervollständigung

Während du tippst, erscheint am Cursor eine graue Fortsetzung – mit <kbd>Tab</kbd> übernimmst du sie, mit <kbd>Cmd</kbd>+<kbd>→</kbd> nur das nächste Wort, und der Rest bleibt als Vorschlag stehen. <kbd>Esc</kbd> verwirft sie. Eine Mindestmenge an Text braucht es nicht; die Vervollständigung arbeitet schon ab dem ersten Satz eines Dokuments.

Gezielt anfordern kannst du eine mit <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> oder über das Kontextmenü (der Cursor muss am Ende eines Absatzes stehen): Dann bekommst du eine längere Fortsetzung mit bis zu drei Alternativen – mit <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> blätterst du durch sie.

Unter **Einstellungen > Textus AI > Schreibassistenz** kannst du den **Tonfall der Vervollständigung** wählen (Passend zum Dokument / Förmlich / Locker / Wissenschaftlich / Knapp). Gehört das Dokument zu einem Projekt mit Stilprofil oder Lexikon (siehe **Textus AI an dich anpassen** weiter unten), richtet sich die Vervollständigung auch danach.

### 2. Grammatikprüfung

Mögliche Fehler werden unterstrichen. Bewege den Zeiger auf eine Unterstreichung oder setze den Cursor hinein, um die Erklärung zu sehen; **Übernehmen** (oder <kbd>Option</kbd>+<kbd>Enter</kbd>, wenn der Cursor darauf steht) korrigiert den Fehler, **Ignorieren** verwirft den Hinweis. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> prüft den aktuellen Absatz sofort.

### 3. Der KI-Bereich

Die vollständige Unterhaltung findet in einem Bereich rechts neben dem Editor statt. Du öffnest und schließt ihn mit der Schaltfläche **Textus AI** (dem Roboter) am rechten Ende der Titelleiste oder mit <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **Eine Unterhaltung pro Dokument**: Jeder Tab hat seine eigene Unterhaltung, und wenn du den Tab wechselst, wechselt der Bereich mit. **Neue Unterhaltung** im Kopf des Bereichs fängt von vorn an (sind noch Änderungen offen, wird vorher nachgefragt).
- **Modi**: Das Eingabefeld bietet drei. **Schreiben** entwirft neuen Text im Dokument (eine Fortsetzung, einen neuen Absatz oder Abschnitt) und fügt nur hinzu: Ist Text ausgewählt, schreibt es hinter der Auswahl weiter. **Prüfen** beantwortet Fragen, bespricht und kommentiert, ohne etwas zu ändern. **Überarbeiten** ändert den vorhandenen Text. Jede Änderung aus Schreiben oder Überarbeiten ist ein Vorschlag, den du annimmst oder ablehnst. Der Bereich startet in dem Modus, der unter **Einstellungen > Textus AI > Chat mit Textus AI > Standardmodus** eingestellt ist.
- **@-Erwähnungen**: Tippe `@` ins Eingabefeld, um eine Textdatei aus dem Projektordner auszuwählen; sie wird an die Nachricht angehängt.
- **Dateien anhängen**: Die Schaltfläche **+** links neben dem Eingabefeld hängt ein PDF, ein Word-Dokument, eine PowerPoint-Präsentation, eine Tabelle, ein Bild oder eine Textdatei an die Nachricht an. Alles außer Bildern wird lokal in Text umgewandelt und mit der Nachricht verschickt; Bilder gehen als echte Bilder an Anbieter, die sie lesen können (die anderen sagen das vorher, statt sie stillschweigend wegzulassen). Von einer langen Datei wird nur ein Teil gesendet; der Chip zeigt dann „(gekürzt)“.
- **Websuche**: Sobald sie unter **Einstellungen > Textus AI > Chat mit Textus AI** aktiviert ist (bei Anbietern, die das unterstützen), kann Textus AI selbstständig im Web suchen, wenn eine Anfrage es erfordert.
- **Gründlich nachdenken**: Die Schaltfläche neben der Websuche (die Glühbirne) lässt das Modell seine Antwort erst gründlich durchdenken – langsamer und teurer, für schwierige Fragen und größere Überarbeitungen. Sie bleibt eingeschaltet, auch in anderen Dokumenten, bis du sie wieder drückst. Während das Modell nachdenkt, zeigt das Panel „Denkt nach · 8 Sekunden“, danach „12 Sekunden nachgedacht“; ein Klick darauf zeigt die Überlegungen, wenn der Anbieter sie mitliefert. Die Schaltfläche erscheint nur bei Modellen, die gründlicher nachdenken können; die Schnellfrage bittet immer um eine schnelle Antwort.
- **Verlauf**: Die Schaltfläche **Verlauf** (die Uhr) oben im KI-Bereich listet frühere Unterhaltungen nach Ordnern auf. Klicke auf eine, um sie mit ihrem Dokument wieder zu öffnen und fortzusetzen.
- **Fehler**: Schlägt eine Anfrage fehl, nennt der Chat über der Meldung des Anbieters die Art des Problems und was zu tun ist (Schlüssel prüfen, kurz warten, ein anderes Modell wählen).

**In eigenem Fenster öffnen** im Kopf des Bereichs verschiebt die Unterhaltung in ein eigenes Fenster – praktisch auf einem zweiten Bildschirm. Dieses Fenster folgt dir: Wechselst du Tabs oder Fenster, wechseln Dokument, Titel und Auswahl mit, und die vorgeschlagenen Änderungen landen in der Datei, die du gerade bearbeitest. Pro Editorfenster gibt es immer nur eines; **📌** in seinem Kopf hält es über dem Editor.

### 4. Schnellfrage

Mit <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (oder Rechtsklick > KI fragen…) öffnest du direkt unter dem aktuellen Absatz eine kleine Chatleiste. Sie sitzt im Dokument und schiebt den Text darunter nach unten, statt ihn zu verdecken. War beim Öffnen Text ausgewählt, wird die Auswahl mitgeschickt. Die Schnellfrage öffnet sich im Modus **Überarbeiten**, weil man sie meist an einer Textstelle öffnet, die sich ändern soll („kürze das“); **Schreiben** und **Prüfen** sind in der Modusauswahl nur einen Klick entfernt.

- **Das Tastenkürzel noch einmal**: Drückst du <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> bei geöffneter Leiste, springt der Cursor in ihr Eingabefeld; drückst du es dort noch einmal, schließt sie sich. Auch <kbd>Esc</kbd> schließt sie von überall in der Leiste, und der Cursor kehrt ins Dokument zurück. Sind noch Änderungen offen, wird vor dem Schließen (oder vor einer neuen Unterhaltung) nachgefragt.
- Die Schnellfrage führt ihre eigene kurze Unterhaltung, getrennt von der des KI-Bereichs und ohne Eintrag im Verlauf. Sie öffnet sich auch, wenn der KI-Bereich offen ist. **In der vollständigen Unterhaltung fortsetzen** (die Schaltfläche in ihrer Ecke) übergibt den Austausch an den KI-Bereich, wo er weitergeht und gespeichert wird. Schalte **Einstellungen > Textus AI > Erweitert > Vollständige Unterhaltungen in einem eigenen Fenster öffnen** ein, um ihn stattdessen in ein eigenes Fenster zu schicken.

### 5. Änderungen im Dokument

Der Chat schreibt nie direkt in dein Dokument. Bittest du einen Anbieter, der Tool Calling unterstützt, das Dokument zu ändern, wird jede Änderung als Vorschlag genau dort angezeigt, wo sie landen würde: Entfernter Text ist durchgestrichen, neuer Text erscheint grün eingefügt. Am Dokument ändert sich nichts, bis du annimmst, und <kbd>Cmd</kbd>+<kbd>Z</kbd> macht eine angenommene Änderung in einem Schritt rückgängig.

- **Annehmen / Ablehnen**: über die schwebende Leiste neben der Änderung, die Karte des Vorschlags im KI-Bereich oder die Tastatur – <kbd>Cmd</kbd>+<kbd>Return</kbd> nimmt an, <kbd>Cmd</kbd>+<kbd>Delete</kbd> lehnt ab, wenn der Cursor auf der Änderung steht. Mehrere Vorschläge in einer Antwort erscheinen gleichzeitig als Vorschau; mit ‹› wechselst du zwischen ihnen, und mit Alle annehmen / Alle ablehnen entscheidest du über alle auf einmal.
- **Begründungen**: Jede Vorschlagskarte sagt, warum Textus AI die Änderung vorgenommen hat.
- **Nur einzelne Sätze**: Schreibt ein Vorschlag mehrere Sätze um, bietet seine Karte **Sätze auswählen (N)** an – hake die gewünschten an und klicke auf **K von N annehmen**.
- **Am Cursor**: Wenn nichts ausgewählt ist, weiß Textus AI, wo dein Cursor steht – „schreib hier einen Übergang“ fügt also genau dort ein.
- **Kommentare statt Änderungen**: Bitte um eine Durchsicht („Was ist hier schwach?“), und Textus AI heftet Kommentare an Textstellen, ohne sie zu ändern. Jede Kommentarkarte hat **Im Dokument anzeigen**, das die betreffende Stelle auswählt.

## Textus AI an dich anpassen

Was Textus AI über dich und deine Arbeit weiß, steht in ein paar einfachen Markdown-Dateien, nicht in versteckten Einstellungen. Jede hat genau eine Aufgabe:

| Konzept | Was es ist | Wo es liegt |
| --- | --- | --- |
| **Projektordner** | Der Ordner, in dem Textus AI arbeitet und lesen darf | Der Ordner des Dokuments oder einer, den du wählst |
| **Stilprofil** | Wie du schreibst | `.textus/style.md` |
| **Lexikon** | Fakten zu Personen, Orten und Begriffen | `.textus/library/` |
| **Schreibanweisungen** | Feste Regeln für jede Unterhaltung | `agent.md` – global und pro Projekt |
| **Von der KI gemerkt** | Was sich Textus AI aus deinen Unterhaltungen merkt | `.textus/memory/` und `memory/` im globalen Konfigurationsordner |
| **Skills** | Wiederverwendbare Anweisungen, die du mit `/name` aufrufst | `skills/` – global und pro Projekt |
| **Globaler Konfigurationsordner** | Was für jedes Dokument gilt | Der Einstellungsordner der App |

„Unterhaltungen“ meint im Folgenden den KI-Bereich und die Schnellfrage. So sieht ein ganzes Projekt auf einen Blick aus:

```
mein-roman/              ← der Projektordner
├── kapitel-1.md         ← das Dokument, das du bearbeitest
├── notizen/
│   └── zeitleiste.md    ← Material, das Textus AI lesen kann
└── .textus/              ← die eigenen Einstellungen des Projekts
    ├── style.md         ← Stilprofil
    ├── agent.md         ← Schreibanweisungen für dieses Projekt
    ├── library/
    │   ├── lin-wan.md   ← ein Eintrag pro Figur, Ort oder Begriff
    │   └── harbour-city.md
    └── skills/
        └── straffen.md  ← ein Skill pro Datei
```

Das Projektmenü legt `.textus/` und die Dateien darin an, sobald du sie zum ersten Mal brauchst; nur Projekt-Skills fügst du von Hand hinzu. Text in `<!-- -->`-Kommentaren ist in all diesen Dateien eine Notiz für dich selbst und wird nie gesendet.

### Der Projektordner

**Der Projektordner ist der Ordner, in dem Textus AI arbeitet.** Standardmäßig ist das der Ordner des Dokuments, das du bearbeitest – oder der nächste Ordner darüber, der einen `.textus/`-Ordner enthält, sodass ein Kapitel in `novel/part-1/` zu `novel/` gehört: Speichere ein Dokument, und sein Ordner wird zum Projektordner.

- Textus AI kann die Dateien darin auflisten, nach Namen finden, lesen und durchsuchen, um frühere Szenen einer Figur, einen Begriff oder deine Notizen zu finden: Textdateien (Markdown, reiner Text und ähnliche Formate) bis 16 MB, die es abschnittsweise liest, wenn sie lang sind, und den Text von PDF-, Word-, PowerPoint- und Tabellendateien. Mit einem Anbieter, der Bilder sehen kann, sieht es sich auch die PNG-, JPEG-, GIF- und WebP-Bilder darin an, bis 6 MB pro Bild. Versteckte Dateien und Ordner, was eine `.gitignore`- oder `.ignore`-Datei ausschließt (wie bei der Dateisuche in der Seitenleiste), Build- und Abhängigkeitsordner (etwa `node_modules`) und gescannte PDFs ohne Textebene bleiben außen vor.
- Tippst du `@` ins Eingabefeld des Chats, hängst du eine seiner Dateien an deine Nachricht an.
- Sein Ordner `.textus/` enthält Stilprofil, Lexikon, Schreibanweisungen und Skills des Projekts.

Die Leiste unter dem Kopf des KI-Bereichs zeigt den Namen des Projektordners; ein Klick darauf öffnet das **Projektmenü**. Liegt dein Material nicht neben dem Entwurf, klicke dort auf **Projektordner wählen…** (oder **Einstellungen > Textus AI > Projektordner**). Der gewählte Ordner gilt für jedes Dokument – auch für ungespeicherte Entwürfe –, bis du wieder **Ordner des Dokuments verwenden** wählst.

> [!TIP]
> Dein Entwurf liegt in `masterarbeit/entwürfe/` und deine Interviewnotizen in `masterarbeit/recherche/`? Wähle `masterarbeit/` als Projektordner, dann kann Textus AI `recherche/interviews.md` lesen, während du an `entwürfe/kapitel-2.md` arbeitest.

Alles, was Textus AI liest, muss im Projektordner liegen: `..`, absolute Pfade und Links nach außen werden abgewiesen. Ein ungespeicherter Entwurf hat keinen Projektordner, solange du keinen gewählt hast, und ein zu weit gefasster Ordner – dein Benutzerordner oder ein ganzes Laufwerk – wird abgewiesen.

### Das Stilprofil – „Meinen Stil lernen“

**Das Stilprofil beschreibt, wie du schreibst**, damit Fortsetzungen und Änderungen nach dir klingen: Stimme und Ton, Satzrhythmus, Wortwahl, Zeichensetzung, was du nie tust. Textus AI richtet sich in Unterhaltungen danach, die Vervollständigung beim Tippen, und zwar in jedem Dokument des Projekts. Es ist die Datei `.textus/style.md`.

Es gibt zwei Wege, eines anzulegen, beide im Projektmenü:

- **Meinen Stil aus Textproben lernen…** – wähle ein paar Dateien mit eigenen Texten (bis zu acht). Textus AI analysiert sie und entwirft ein Profil – Stimme und Ton, Sätze und Rhythmus, Wortwahl, Zeichensetzung und Formatierung, Aufbau, Tabus und einige kurze Zitate als Beispiele – und öffnet es in einem neuen Tab. Lies es, korrigiere es, ergänze es: Es gehört dir. Lernt Textus AI erneut, bleibt das bisherige Profil als `style.previous.md` erhalten.
- **Stilprofil erstellen** – beginne mit einer leeren Gliederung und schreib es selbst.

Sobald es ein Profil gibt, öffnet es der Chip **Stil** neben dem Ordnernamen.

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

**Das Lexikon enthält Fakten, die einheitlich bleiben müssen**: eine Markdown-Datei pro Figur, Ort oder Begriff, in `.textus/library/`. **Neuer Lexikoneintrag…** im Projektmenü fragt nach einem Namen und öffnet den neuen Eintrag; der Chip **Lexikon** zeigt, wie viele es gibt.

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

**Schreibanweisungen sind feste Regeln, die mit jeder Unterhaltung gesendet werden**: worum es im Projekt geht, in welcher Sprache geantwortet wird, Schreibweisen und Begriffe, was Textus AI immer oder nie tun soll. Sie stehen in Dateien namens `agent.md`, auf zwei Ebenen:

- **Global**, für jedes Dokument: **Einstellungen > Textus AI > Schreibanweisungen (agent.md) > agent.md bearbeiten**.
- **Projekt**, für die Dokumente eines Projekts: `.textus/agent.md`, zu öffnen mit **Projekt-Schreibanweisungen bearbeiten** im Projektmenü.

Beide öffnen sich in einem Tab und beginnen mit einer kurzen Anleitung in Kommentaren. Gibt es beide, bekommt Textus AI beide – zuerst die globalen Anweisungen, dann die des Projekts –, und wo sie sich widersprechen, gelten die des Projekts.

```markdown
Das Buch ist ein Kriminalroman im Shanghai der 1930er-Jahre, erzählt von Lin Wan in der Ich-Form.
Antworte immer auf Deutsch, auch wenn der Roman auf Chinesisch geschrieben ist.
Schreib „Shanghai“, nie „Schanghai“.
```

Schreibanweisungen gelten nur für Unterhaltungen. Die Vervollständigung liest sie nicht; sie richtet sich nach Stilprofil und Lexikon.

### Was sich Textus AI merkt

**Textus AI merkt sich, worum du bittest und wie du schreibst**, ohne dass du eine Datei schreiben musst. Wenn du etwas sagst, das über eine einzelne Anfrage hinaus gelten soll – „immer Schweizer Rechtschreibung“, „keine Gedankenstriche“, eine Korrektur, die du zweimal machen musstest – oder einen Fakt über dein Werk nennst, etwa wer eine Figur ist, merkt sich Textus AI das und hält sich in späteren Unterhaltungen daran. Jedes Mal zeigt eine Zeile unter der Antwort, was gemerkt wurde und wo: **Rückgängig** nimmt es zurück, **Persönlich machen** oder **Ins Projekt** verschiebt es.

- **Dieses Projekt**: was dieses Werk betrifft, in `.textus/memory/`; Fakten zu Personen, Orten und Begriffen kommen ins Lexikon.
- **Für alle Projekte**: deine allgemeinen Gewohnheiten, in `memory/` im globalen Konfigurationsordner. Ohne Projektordner landet alles hier.

Der Tab **Gedächtnis** im KI-Bereich listet alles unter **Von der KI gemerkt** auf, jeweils mit Zeitpunkt und Unterhaltung: **Bearbeiten** öffnet einen Eintrag, **Löschen** entfernt ihn. Bei einem Widerspruch gelten deine eigenen Schreibanweisungen, und Textus AI ändert nie deine `agent.md` oder dein Stilprofil. Gibt es zu viele Erinnerungen zum Senden, bleiben die ältesten außen vor, und der Tab Gedächtnis weist darauf hin. **Einstellungen > Textus AI > Automatisch merken** schaltet die Funktion aus.

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

Skills gibt es auf denselben zwei Ebenen wie Schreibanweisungen: globale Skills im Ordner `skills/` des globalen Konfigurationsordners (**Einstellungen > Textus AI > Skills > Skill importieren…** kopiert eine Skill-Datei dorthin), Projekt-Skills in `.textus/skills/` (ein versteckter Ordner – im Finder von macOS blendet <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> ihn ein). Ein Projekt-Skill mit demselben Namen wie ein globaler ersetzt diesen.

### Integrierte Skills

Textus bringt 19 Skills für typische Schreibaufgaben mit. Das `/`-Menü ordnet sie in **Schreiben** (Geschichte fortsetzen, Figur oder Szene beschreiben, Dialoge überarbeiten, Stil nachahmen), **Überarbeiten** (Ausbauen, Straffen, Ton ändern, KI-Ton entfernen, Übersetzen und glätten), **Prüfen** (Korrektur lesen, Kontinuität prüfen) und **Textsorten** (E-Mail schreiben, Bekanntmachung oder Amtsschreiben, Protokoll, wissenschaftlich überarbeiten, Social-Media-Beitrag, Überschrift, Zusammenfassen, Design entwerfen). Tipp `/` und wähl einen aus, oder gib seinen Namen in einer beliebigen Sprache der App ein: `/proofread`, `/korrektur` und `/校对` rufen denselben Skill auf. Die meisten wählt Textus AI auch selbst, wenn deine Anfrage dazu passt; **Ausbauen**, **Straffen**, **Ton ändern** und **Zusammenfassen** laufen nur, wenn du sie aufrufst. **Design entwerfen** schreibt nach deiner Beschreibung ein Editor-Design als CSS in die Antwort: **Dieses Design verwenden** darunter installiert es und schaltet darauf um; oder speichere es als .css-Datei und importiere es mit **Einstellungen > Editor & Design > CSS importieren…**.

**Einstellungen > Textus AI > Integrierte Skills** listet alle auf. Mit dem Schalter schaltest du einen aus: Er verschwindet aus dem `/`-Menü, und Textus AI nutzt ihn nicht mehr. **Anpassen…** kopiert den Skill in den Ordner `skills/` des globalen Konfigurationsordners und öffnet die Kopie, damit du seine Anweisungen ändern kannst; ab dann läuft deine Kopie. **Zurücksetzen** löscht die Kopie und stellt die integrierte Fassung wieder her. Ein eigener Skill mit dem Namen eines integrierten ersetzt diesen.

### Schreibkonventionen

**Einstellungen > Textus AI > Schreibassistenz > Schreibkonventionen** legt fest, welchen Regeln für Zeichensetzung, Leerzeichen und Zahlen Textus AI und die Grammatikprüfung folgen. **Automatisch** wendet die nationale Norm an, wo eine Sprache eine hat (etwa GB/T für vereinfachtes Chinesisch oder JTF für Japanisch); sonst folgt es dem, was dein Dokument schon überwiegend tut, und weist nur auf Uneinheitliches hin. Wählst du ein Profil, zum Beispiel **Deutschland · DIN 5008** oder **Schweiz**, werden Dokumente in dieser Sprache danach geprüft.

Ein Projekt kann ein eigenes festlegen: Füg im Stilprofil (`.textus/style.md`) zwischen den beiden `---`-Zeilen am Anfang eine Zeile `conventions:` ein. Für die Dokumente dieses Projekts hat sie Vorrang vor der Einstellung.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### Der globale Konfigurationsordner

**Der globale Konfigurationsordner enthält, was für jedes Dokument gilt**: deine globale `agent.md` und deine globalen Skills. Er gehört zur App, nicht zu einem Projekt; **Einstellungen > Textus AI > Globaler Konfigurationsordner > Anzeigen** zeigt ihn.

```
agent/                ← der globale Konfigurationsordner
├── agent.md          ← globale Schreibanweisungen
└── skills/
    └── gliedern.md   ← ein globaler Skill
```

Ein globales Stilprofil oder Lexikon gibt es nicht: Beide beschreiben ein bestimmtes Werk und gehören deshalb zu einem Projekt.

### Was wann gilt

| | Unterhaltungen | Vervollständigung | Grammatikprüfung |
| --- | :---: | :---: | :---: |
| Projektdateien (lesen, suchen, `@`) | ✓ | | |
| Stilprofil | ✓ | ✓ | |
| Lexikoneinträge, die vorkommen | ✓ | ✓ | |
| Schreibanweisungen | ✓ | | |
| Was sich Textus AI gemerkt hat | ✓ | | |
| Skills | ✓ | | |
| Tonfall der Vervollständigung (Einstellungen) | | ✓ | |

- **Erst global, dann Projekt.** Schreibanweisungen beider Ebenen werden gesendet, die des Projekts zuletzt, und bei einem Widerspruch gelten die des Projekts. Ein Projekt-Skill ersetzt einen globalen Skill gleichen Namens.
- **Immer nur ein Projektordner.** Nur dessen `.textus/` zählt: Hast du einen Projektordner gewählt, wird ein `.textus/` neben dem Dokument nicht gelesen.
- **Kein Neustart nötig.** Bearbeite eine dieser Dateien, und die nächste Anfrage verwendet die neue Fassung (die Vervollständigung nach etwa zehn Sekunden).

### Welche Datei wofür?

- Wie dein Text klingen soll → das **Stilprofil**.
- Wer ist wer, was ist was → das **Lexikon**.
- Was Textus AI in einer Unterhaltung wissen oder immer tun soll → die **Schreibanweisungen**.
- Eine Aufgabe, um die du immer wieder bittest → ein **Skill**.
- Notizen, Recherche, frühere Kapitel → normale Dateien im **Projektordner**; Textus AI liest sie, wenn eine Anfrage sie braucht.

## Ein Hinweis zum Datenschutz

Dein Dokument, angehängte und per `@` erwähnte Dateien, deine Schreibanweisungen, das Stilprofil, die vorkommenden Lexikoneinträge und alle Projektdateien, die Textus AI liest, werden mit jeder Anfrage an den gewählten Anbieter gesendet; **Meinen Stil lernen** sendet die Textproben, die du auswählst. Die Websuche läuft auf den Servern dieses Anbieters. Schalte in den Einstellungen jede Funktion aus, bei der du das nicht möchtest.
