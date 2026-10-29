# Markdown-Anleitung für Textus

Willkommen. Dieses eingebaute Dokument zeigt, welche Markdown-Elemente Textus darstellt. Es ist nur ein ungespeicherter Entwurf – bearbeite es nach Belieben, probiere alles aus und schließe es danach, ohne zu speichern.

> [!TIP]
> Mit `Cmd+/` wechselst du zwischen WYSIWYG und Quellcodemodus und siehst die Syntax hinter jedem Beispiel hier.

## Überschriften und Zitate

Tippe am Zeilenanfang `#` und ein Leerzeichen für eine Überschrift der Ebene 1 oder `##` und ein Leerzeichen für Ebene 2. Die Überschriften oben zeigen das Ergebnis. `Ctrl+1` bis `Ctrl+6` (`Cmd+1` bis `Cmd+6` auf dem Mac) machen die aktuelle Zeile zu einer Überschrift dieser Ebene.

Ein Zitat:

> Zitierter Text kann weitere Auszeichnungen enthalten, etwa **Fettdruck** und `Code`.

Hinweise im GitHub-Stil:

> [!NOTE]
> Eine Notiz mit zusätzlichem Kontext.

> [!WARNING]
> Eine Warnung vor Dingen, auf die du achten solltest.

## Textauszeichnung

**Fett** (`**Text**`), *kursiv* (`*Text*`), ***fett und kursiv***, ~~durchgestrichen~~ (`~~Text~~`), ==hervorgehoben== (`==Text==`) und `Inline-Code`.

Tippst du `(`, `[`, `{`, ein Anführungszeichen oder eine Klammer aus einer chinesischen oder japanischen Eingabemethode wie `（`, `【` oder `「`, kommt das schließende Gegenstück hinter den Cursor: Das getippte Schlusszeichen springt darüber, Rücktaste direkt nach dem öffnenden löscht beide, und markierter Text wird eingeschlossen. **Einstellungen → Editor & Design → (), [] und „“ schließen** schaltet das ab.

Links sehen so aus: [das Textus-Repository](https://github.com/CatVinci-Studio/Textus). Mit Strg/⌘+Klick folgst du einem Link: Ein Weblink öffnet sich im Browser, ein Link auf eine andere Markdown-Datei öffnet sie in einem Tab, und ein Link auf `#eine-überschrift` scrollt dorthin. Ein einfacher Klick setzt den Cursor in den Link und zeigt sein Markdown, `[Text](URL)`, zum Bearbeiten an Ort und Stelle; verlässt der Cursor ihn, ist er wieder ein Link. Auch HTML im Text wird dargestellt, etwa Tasten wie <kbd>Cmd</kbd> + <kbd>S</kbd>. Ebenso aufklappbare `<details>`-Blöcke, HTML-Tabellen, einige Inline-Stile (Farbe, Hintergrund, Größe, Stärke, Ausrichtung, Unter- und Durchstreichung) und eingebettetes `<svg>`, das als Bild erscheint. Skripte und anderes HTML bleiben als Quelltext stehen. Ein Link auf eine Überschrift in einer anderen Datei, etwa `[siehe](notizen.md#eine-überschrift)`, öffnet diese Datei an der Überschrift. Obsidian-Wikilinks (`[[Notiz]]`, `[[Notiz|Text]]` und `[[Notiz#Überschrift]]`) öffnen sich genauso, aus dem Ordner des Dokuments oder von überall in seinem Vault; sie und `#Tags` am Zeilenanfang werden genau so gespeichert, wie sie geschrieben sind.

**Einstellungen → Editor & Design → Farbfelder vor Farbcodes** setzt ein kleines Quadrat in der Farbe vor einen Farbcode. **Nur in Code** zeigt es in Inline-Code, der eine Farbe ist, etwa `#0af` oder `rgb(0 128 255)`, und vor den Farbwerten in Codeblöcken; **Überall** auch vor im Text mit sechs oder acht Stellen geschriebenen Farbcodes, etwa #ff8800, und Farbfunktionen, etwa hsl(210 100% 50%). Kurzformen im Text, Tags wie #cafe, Nummern wie #234 und Links bleiben, wie sie sind.

Formeln im Text: die Äquivalenz von Masse und Energie $E = mc^2$, die eulersche Identität $e^{i\pi} + 1 = 0$.

## Listen

- Ungeordnete Liste
- Mit Verschachtelung
  - Ein Eintrag der zweiten Ebene
  - Noch einer

1. Geordnete Liste
2. Zweiter Eintrag

Aufgabenliste (ein Klick auf ein Kästchen setzt oder entfernt den Haken):

- [x] Etwas Erledigtes
- [ ] Etwas, das noch zu tun ist

## Tabellen

| Funktion | Syntax | Ergebnis |
| --- | --- | --- |
| Fett | `**Text**` | **Text** |
| Hervorhebung | `==Text==` | ==Text== |
| Formel im Text | `$x^2$` | $x^2$ |

Bewege den Zeiger über eine Tabelle, um Zeilen und Spalten hinzuzufügen oder zu entfernen. Tippe `| Name | Alter |` und drücke Enter, um eine Tabelle anzulegen. Enter springt eine Zeile nach unten, fügt in der letzten Zeile eine neue hinzu und verlässt die Tabelle, wenn die neue Zeile leer bleibt; mit Ctrl/⌘+Enter verlässt du sie jederzeit. In einer Tabelle springen Tab und Umschalt+Tab zur nächsten und zur vorigen Zelle, und Umschalt+Enter beginnt eine neue Zeile in der Zelle.

## Codeblöcke

Umgrenzte Codeblöcke mit Syntaxhervorhebung (die Sprache stellst du oben rechts im Block um). Enter in der leeren letzten Zeile verlässt den Block, Ctrl/⌘+Enter jederzeit; dasselbe gilt für Zitate. **Kopieren** und **Alles auswählen** neben der Sprache kopieren oder markieren den Code des Blocks, und **Einstellungen → Editor & Design → Zeilennummern in Codeblöcken** nummeriert seine Zeilen; beides erscheint weder in Exporten noch im Ausdruck.

```python
def fib(n: int) -> int:
    """Die klassische Fibonacci-Folge."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
fn main() {
    let greeting = "Hallo, Textus!";
    println!("{greeting}");
}
```

## Formelblöcke

Formeln zwischen `$$` setzt KaTeX als eigenen Block:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## Diagramme (Mermaid)

Ein ```` ```mermaid ````-Codeblock wird als Live-Diagramm dargestellt. Ein Flussdiagramm:

```mermaid
flowchart LR
    A[Markdown schreiben] --> B{Diagramm nötig?}
    B -- Ja --> C[In Mermaid skizzieren]
    B -- Nein --> D[Weiterschreiben]
    C --> D
```

Ein Gantt-Diagramm:

```mermaid
gantt
    title Beispiel für einen Projektzeitplan
    dateFormat YYYY-MM-DD
    section Entwurf
    Anforderungen       :done,    des1, 2026-07-01, 5d
    UI-Design           :active,  des2, after des1, 7d
    section Umsetzung
    Kernfunktionen      :         dev1, after des2, 10d
    Feinschliff & Tests :         dev2, after dev1, 5d
```

Ein Sequenzdiagramm:

```mermaid
sequenceDiagram
    participant Du
    participant Textus
    Du->>Textus: Markdown tippen
    Textus-->>Du: Sofort dargestellt
```

**Einstellungen → Editor & Design → Diagramm-Engine** legt fest, was diese Blöcke zeichnet: Mermaid, die Voreinstellung, oder Pele, das schneller ist, Diagramme aber auf seine eigene Art anordnet und einige Funktionen weglässt; ein Diagramm, das Pele nicht zeichnen kann, zeichnet Mermaid.

## Bilder

Füge ein Bild direkt aus der Zwischenablage ein – Textus speichert es und fügt den Verweis ein. Wohin, legst du unter **Einstellungen → Editor & Design → Bilder** fest. **Auf diesem Computer** ist es ein **Unterordner** im Ordner des Dokuments, standardmäßig `assets/`, dessen Namen du ändern kannst, oder **Derselbe Ordner wie das Dokument**; die Einstellungen zeigen den Link, den ein eingefügtes Bild bekommt. Mit **Zu einem Bildhoster hochladen** geht es an PicGo / PicList, SM.MS, Imgur oder deinen eigenen Endpunkt (**Eigener Server**).

Ein eigener Endpunkt empfängt `multipart/form-data` mit einem Feld `file` und kann die öffentliche URL entweder als reinen Text oder in einem einstellbaren JSON-Feld zurückgeben. Hochgeladene Dateien können automatisch umbenannt werden oder ihren Originalnamen behalten, oder Textus fragt dich vor jedem Upload nach einem Namen. Wenn du den Speicherort wechselst, bleiben vorhandene Bildverweise unverändert.

Oder schreib den Verweis von Hand:

```markdown
![Alternativtext](assets/screenshot.png)
```

Obsidian-Einbettungen wie `![[image.png]]` oder `![[attachments/image.png|300]]` zeigen ebenfalls das Bild: Textus sucht die Datei im Obsidian-Tresor des Dokuments und speichert die Einbettung genau so, wie sie geschrieben ist.

Um ein Bild genau anzusehen, doppelklicke darauf oder drücke **Bild vergrößern** oben rechts darin (Diagramme haben dieselbe Schaltfläche): Scrollen oder Aufziehen zoomt, Ziehen verschiebt, ein Doppelklick passt es wieder ein, und `Esc` schließt es. Zieh den Griff am rechten Rand eines Bildes, um seine Größe zu ändern. **Einstellungen → Editor & Design → Bilder in eigener Zeile** setzt Bilder, die allein in einer Zeile stehen, in die Mitte oder an den linken Rand – im Editor und in HTML- und PDF-Exporten.

## Kopieren und Einfügen

**Kopieren** legt das Markdown als reinen Text in die Zwischenablage und die Formatierung daneben, sodass GitHub, Obsidian, VS Code und Chat-Apps Markdown bekommen, während Word, Pages, Mail und Notion es formatiert einfügen. Ein Bild, das du per Rechtsklick kopierst, kommt als Bild selbst in die Zwischenablage, bereit zum Einfügen in einen Chat oder ein Dokument. **Bearbeiten → Als reinen Text einfügen** (`Cmd+Shift+V`) fügt den Text der Zwischenablage genau so ein, wie er ist, ohne Markdown darin zu lesen.

## Ansichten und Modi

Neben dem WYSIWYG-Editor und dem Quellcodemodus (`Cmd+/`) bietet Textus drei Arten zu schreiben (unter Windows und Linux `Ctrl` statt `Cmd`; die aktuellen Belegungen stehen unter Einstellungen → Tastenkürzel):

- **Quelltext und Vorschau** (`Cmd+Shift+E`): links der Markdown-Quelltext, rechts die gerenderte Vorschau, beide scrollen gemeinsam.
- **Schreibmaschinenmodus**: Die Zeile, in der du tippst, bleibt in der Mitte des Fensters – im Editor, im Quellcodemodus und in Quelltext und Vorschau.
- **Zen-Modus** (`Cmd+Shift+J`): blendet alles außer dem Text aus und dimmt jeden Absatz außer dem, an dem du gerade schreibst. Mit `Esc` verlässt du ihn.

Alle findest du im Menü **Ansicht** und unter **Einstellungen → Editor & Design → Ansicht**. Jeder ist eine Einstellung für ganz Textus: Schaltest du ihn in einem Fenster um, wechselt jeder Tab in jedem Fenster mit, die Dokumente, die du als Nächstes öffnest, erscheinen darin, und Textus öffnet sich beim nächsten Mal wieder darin.

**Ansicht → Schreibgeschützt** (auch im Rechtsklickmenü eines Tabs) schützt ein Dokument vor Änderungen – durch Tippen, Einfügen, Ablegen, Rückgängig, Textus AI oder Plugins. Ein Vorhängeschloss neben dem Titel zeigt es an; ein Klick darauf macht das Dokument wieder bearbeitbar.

**Ansicht → Befehlspalette…** (`Cmd+Shift+P`) findet alles, was die Menüs können, und jeden Befehl, den ein Plugin hinzufügt, wenn du ein paar Buchstaben seines Namens tippst. Sie wechselt außerdem das Erscheinungsbild (hell, dunkel oder wie das System) und das Editor-Design und schaltet Textus AI ein oder aus.

Der Tab **Gliederung** der Seitenleiste listet die Überschriften des Dokuments auf; ein Klick auf eine führt dorthin. Ein Rechtsklick auf die Gliederung bietet **Alle aufklappen** und **Alle zuklappen**, oder klappe mit `Option`-Klick (`Alt`-Klick) auf den Pfeil einer Überschrift alle auf einmal auf oder zu.

**Einstellungen → Editor & Design → Schriftgröße der Oberfläche** vergrößert oder verkleinert den Text von Seitenleiste, Tabs, Menüs, KI-Bereich und Einstellungen; das Dokument behält seinen eigenen Zoom. `Ctrl+Tab` und `Ctrl+Shift+Tab` wechseln zum nächsten und zum vorigen Tab.

## Mehrere Dokumente gleichzeitig

**Ansicht → Rechts teilen** (`Cmd+Option+S`) zeigt das vordere Dokument neben einem anderen, und **Ansicht → Unten teilen** setzt eines über das andere. Jeder Bereich hat seine eigenen Tabs: Ein Dokument, das du öffnest, kommt in den Bereich, in dem du bist, und Rechts teilen oder Unten teilen teilt diesen Bereich erneut, so oft du willst.

- Zieh einen Tab – oder eine Datei aus der Seitenleiste – an den Rand eines Bereichs, und er öffnet sich in einem neuen Bereich auf dieser Seite. Ziehst du ihn an den äußeren Rand des Editors, öffnet er sich neben allen Bereichen: Am rechten Rand zweier übereinanderliegender Bereiche füllt er die rechte Seite von oben bis unten. Lege ihn auf den Tabs eines anderen Bereichs ab, um ihn dorthin zu verschieben.
- Zieh die Linie zwischen zwei Bereichen, um ihre Größe zu ändern; ein Doppelklick darauf macht sie gleich groß. Ein Rechtsklick darauf ordnet sie übereinander statt nebeneinander an, vertauscht sie oder hebt die Teilung auf.
- **Daneben öffnen** im Rechtsklickmenü eines Tabs zeigt ihn neben dem vorderen.
- Schließt du den letzten Tab eines Bereichs, verschwindet der Bereich. Die ganze Anordnung kommt zurück, wenn du Textus wieder öffnest.

## Tabs und Fenster

`Cmd+T` öffnet einen neuen Tab, `Cmd+N` ein neues Fenster, und **Datei → Geschlossenen Tab wieder öffnen** (`Cmd+Shift+T`) holt die Dokumente zurück, die du geschlossen hast, das zuletzt geschlossene zuerst. Ein Mittelklick schließt einen Tab; das Rechtsklickmenü eines Tabs hat **Andere schließen**, **Tabs links schließen** und **Tabs rechts schließen** (Tabs mit ungespeicherten Änderungen bleiben offen), **Pfad kopieren** und **In neues Fenster verschieben**. Du kannst einen Tab auch aus dem Fenster ziehen, um ihm ein eigenes Fenster zu geben. Wenn Textus wieder öffnet, kommt jedes Fenster mit seinen eigenen Tabs zurück.

## Ordner und Dateisuche

**Datei → Ordner öffnen…** öffnet einen ganzen Ordner in der Seitenleiste: Der Dateibaum bleibt dort, während du Dokumente darin öffnest, der Ordner kommt mit deiner Sitzung zurück, und **Datei → Ordner schließen** lässt den Baum wieder dem Dokument folgen. Das Feld oben im Tab **Dateien** der Seitenleiste sucht Dateinamen im ganzen Ordner; `Cmd+Shift+O` springt dorthin. Tippe zum Filtern, `↑`/`↓` zum Bewegen, `Enter` zum Öffnen, `Esc` zum Leeren. Beides gibt es nur auf dem Desktop.

Der Baum ist auch eine kleine Dateiverwaltung. Der Name des übergeordneten Ordners darüber führt eine Ebene hinauf. **Sortieren** ordnet ihn nach Name oder nach Änderungsdatum, und der Filter neben dem Suchfeld, **Alle Dateien** oder **Nur Dokumente**, gilt für den Baum wie für die Suche. Ein Rechtsklick auf einen Ordner, eine Datei oder die leere Fläche darunter legt dort ein **Neues Dokument** oder einen **Neuen Ordner** an, und eine Datei oder ein Ordner, auf einen anderen Ordner gezogen, wird dorthin verschoben; ein geöffnetes Dokument folgt an den neuen Ort. Nichts wird ersetzt: Ein vergebener Name wird abgelehnt.

Zieh Dateien aus dem Finder oder dem Datei-Explorer auf das Fenster, um sie zu öffnen: Dokumente öffnen sich in Tabs, Bilder kommen dort ins Dokument, wo du sie loslässt, und ein Ordner öffnet sich in der Seitenleiste. **Datei → Pfad kopieren** kopiert den vollständigen Pfad des vorderen Dokuments.

Im Terminal öffnet `textus notizen.md` eine Datei in Textus; **Einstellungen → Allgemein** installiert den Befehl `textus`, falls er noch fehlt.

**Datei → Öffnen…** öffnet auch ein Word-Dokument (`.docx`), ebenso das Ablegen auf dem Fenster: Es wird ein neues, noch nicht gespeichertes Markdown-Dokument gleichen Namens mit seinen Überschriften, Listen, Tabellen, Links, Fußnoten und Bildern. Die Bilder kommen beim Speichern dorthin, wo **Einstellungen → Editor & Design → Bilder** eingefügte Bilder ablegt, und **Speichern** schlägt eine `.md`-Datei neben der Word-Datei vor. Manche Formatierung kann anders aussehen; die Word-Datei selbst wird nie verändert. Nur auf dem Desktop.

## Im Hintergrund weiterlaufen

Schalte **Einstellungen → Allgemein → Anwendung → Im Hintergrund weiterlaufen** ein, dann läuft Textus nach dem Schließen des letzten Fensters weiter, mit seinem Symbol im Infobereich (Windows), im System-Tray (Linux) oder in der Menüleiste (Mac). **Textus öffnen** im Menü des Symbols bringt deine Dokumente zurück; **Textus beenden** dort beendet Textus wirklich. GNOME zeigt das Tray-Symbol nur mit der AppIndicator-Erweiterung.

## Exportieren

**Datei → Exportieren** speichert das Dokument als HTML oder PDF; mit installiertem [Pandoc](https://pandoc.org) auch als Word (`.docx`), OpenDocument, RTF, EPUB, LaTeX und mehr. Auf dem Mac druckt **Einstellungen → Editor & Design → PDFs in hellen Farben exportieren** ein PDF auf Weiß in den hellen Farben deines Themes, auch wenn du im dunklen Modus schreibst.

## Plugins, Themes und Skills

**Einstellungen → Erweiterungen → Mehr holen** listet Plugins, Themes und Skills zum Hinzufügen auf: Vim- und Emacs-Tasten, einen PDF-Reader, Diagramme, einen Wissensgraphen, Schreibwerkzeuge und mehr. Jedes hat eine Schaltfläche – **Installieren**, dann **Aktualisieren**, **Ausschalten** oder **Einschalten** – und **Deinstallieren** im Menü daneben. Die Seite eines Plugins zeigt, wie es benutzt wird, und seine Befehle erscheinen im Menü **Plugins** und in der Befehlspalette.

## Hilfe bekommen

**Hilfe → Problem melden…** (auch unter **Einstellungen → Allgemein**, bei Hilfe) öffnet ein kurzes Formular. Gib an, welche Art von Meldung es ist, welchen Teil von Textus sie betrifft und bei einem Fehler, wie schlimm er ist, und beschreibe dann, was schiefgegangen ist; Textus fügt seine Version, dein System, deine Plugins, deine Einstellungen ohne alles Private und die letzten Fehler hinzu – alles wird dir gezeigt, bevor etwas gesendet wird. **Senden** legt sie für dich als Issue auf GitHub an, ganz ohne GitHub-Konto, und nennt dir die Nummer; **Auf GitHub senden** öffnet stattdessen das Formular von GitHub; **Kopieren** legt sie in die Zwischenablage, für einen Chat oder eine E-Mail. Was du schreibst, wird ein öffentliches Issue; eine E-Mail-Adresse oder WeChat-ID, die du hinterlässt, falls wir nachfragen dürfen, geht nur an das Team.

Unter **Einstellungen → Allgemein → Hilfe** kannst du außerdem die Einführung noch einmal ansehen, die Anleitungen öffnen und **Über Textus** aufrufen, mit der Version und **Nach Updates suchen** (auf dem Mac auch **Textus → Nach Updates suchen…**). **Hilfe → Zur Community** öffnet die Community-Seite.

## Fußnoten und Trennlinien

Fußnoten sehen so aus[^1], und darunter folgt eine horizontale Trennlinie:

---

[^1]: Der Inhalt der Fußnoten wird am Ende des Dokuments gesammelt.

Viel Freude beim Schreiben.
