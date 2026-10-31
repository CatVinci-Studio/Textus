# Guía de Markdown de Textus

Te damos la bienvenida. Este documento integrado muestra el Markdown que admite Textus y cómo se ve. Es solo un borrador sin guardar: edítalo y experimenta con libertad, y después ciérralo sin guardar.

> [!TIP]
> Pulsa `Cmd+/` para alternar entre WYSIWYG y el modo código fuente, y ver la sintaxis que hay detrás de cualquier ejemplo.

## Encabezados y citas

Escribe `#` y un espacio al principio de una línea para crear un encabezado de nivel 1, o `##` y un espacio para uno de nivel 2. Los encabezados de arriba muestran el resultado. `Ctrl+1` a `Ctrl+6` (`Cmd+1` a `Cmd+6` en un Mac) convierten la línea actual en un encabezado de ese nivel.

Una cita:

> El texto citado puede contener otras marcas, como **negrita** y `código`.

Alertas al estilo de GitHub:

> [!NOTE]
> Una nota, para dar contexto adicional.

> [!WARNING]
> Una advertencia, para lo que conviene tener en cuenta.

## Estilos de texto

**Negrita** (`**texto**`), *cursiva* (`*texto*`), ***negrita y cursiva***, ~~tachado~~ (`~~texto~~`), ==resaltado== (`==texto==`) y `código en línea`.

Al escribir `(`, `[`, `{`, unas comillas o un paréntesis de un método de entrada chino o japonés, como `（`, `【` o `「`, se añade su pareja de cierre tras el cursor: escribir el cierre lo salta, Retroceso justo después de la apertura borra los dos y, con texto seleccionado, la pareja lo rodea. **Ajustes → Editor y aspecto → Cerrar (), [] y «»** lo desactiva.

Los enlaces se ven así: [el repositorio de Textus](https://github.com/CatVinci-Studio/Textus). Con Ctrl/⌘+clic se sigue un enlace: uno web se abre en el navegador, uno a otro archivo Markdown lo abre en una pestaña y uno a `#un-encabezado` desplaza hasta él. Un clic normal pone el cursor en el enlace y muestra su Markdown, `[texto](url)`, para editarlo ahí mismo; al salir el cursor vuelve a ser un enlace. También se representa el HTML en línea, como las teclas <kbd>Cmd</kbd> + <kbd>S</kbd>. También se representan los bloques plegables `<details>`, las tablas HTML, algunos estilos en línea (color, fondo, tamaño, grosor, alineación, subrayado y tachado) y el `<svg>` en línea, que se muestra como imagen. Los scripts y el resto del HTML se quedan como código. Un enlace a un encabezado de otro archivo, como `[ver](notas.md#un-encabezado)`, abre ese archivo en ese encabezado. Los wikilinks de Obsidian (`[[Nota]]`, `[[Nota|texto]]` y `[[Nota#Encabezado]]`) se abren igual, desde la carpeta del documento o desde cualquier parte de su bóveda; ellos y las `#etiquetas` al principio de una línea se guardan tal como se escribieron.

**Ajustes → Editor y aspecto → Muestras antes de los códigos de color** pone un pequeño cuadrado del color delante de un código de color. **Solo en el código** lo muestra en el código en línea que es un color, como `#0af` o `rgb(0 128 255)`, y delante de los valores de color de los bloques de código; **En todo el texto**, también delante de los escritos en el texto con seis u ocho dígitos, como #ff8800, o como función de color, como hsl(210 100% 50%). Los códigos cortos en el texto, las etiquetas como #cafe, los números como #234 y los enlaces se quedan como están.

Fórmulas en línea: la equivalencia entre masa y energía $E = mc^2$, la identidad de Euler $e^{i\pi} + 1 = 0$.

## Listas

- Lista no ordenada
- Con anidación
  - Un elemento de segundo nivel
  - Otro más

1. Lista ordenada
2. Segundo elemento

Lista de tareas (haz clic en una casilla para marcarla o desmarcarla):

- [x] Algo ya hecho
- [ ] Algo por hacer

## Tablas

| Función | Sintaxis | Resultado |
| --- | --- | --- |
| Negrita | `**texto**` | **texto** |
| Resaltado | `==texto==` | ==texto== |
| Fórmula en línea | `$x^2$` | $x^2$ |

Pasa el puntero sobre una tabla para añadir o quitar filas y columnas. Escribe `| Nombre | Edad |` y pulsa Enter para crear una tabla. Enter baja una fila, añade otra al llegar a la última y, en una fila nueva que sigue vacía, sale de la tabla; Ctrl/⌘+Enter sale en cualquier momento. En una tabla, Tab y Mayús+Tab pasan a la celda siguiente y a la anterior, y Mayús+Enter empieza una línea nueva dentro de la celda.

## Bloques de código

Bloques de código delimitados con resaltado de sintaxis (cambia el lenguaje desde la esquina superior derecha del bloque). Enter en la última línea vacía sale del bloque, igual que Ctrl/⌘+Enter en cualquier momento; lo mismo vale para las citas. **Copiar** y **Seleccionar todo**, junto al lenguaje, copian o seleccionan el código del bloque, y **Ajustes → Editor y aspecto → Números de línea en los bloques de código** numera sus líneas; ninguno de los dos aparece en las exportaciones ni al imprimir.

```python
def fib(n: int) -> int:
    """La clásica sucesión de Fibonacci."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
fn main() {
    let greeting = "¡Hola, Textus!";
    println!("{greeting}");
}
```

## Bloques de fórmulas

KaTeX representa las fórmulas en bloque delimitadas con `$$`:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## Diagramas (Mermaid)

Un bloque de código ```` ```mermaid ```` se representa como un diagrama en vivo. Un diagrama de flujo:

```mermaid
flowchart LR
    A[Escribir Markdown] --> B{¿Hace falta un diagrama?}
    B -- Sí --> C[Dibujarlo en Mermaid]
    B -- No --> D[Seguir escribiendo]
    C --> D
```

Un diagrama de Gantt:

```mermaid
gantt
    title Calendario de un proyecto de ejemplo
    dateFormat YYYY-MM-DD
    section Diseño
    Requisitos          :done,    des1, 2026-07-01, 5d
    Diseño de interfaz  :active,  des2, after des1, 7d
    section Desarrollo
    Funciones básicas   :         dev1, after des2, 10d
    Pulido y pruebas    :         dev2, after dev1, 5d
```

Un diagrama de secuencia:

```mermaid
sequenceDiagram
    participant Tú
    participant Textus
    Tú->>Textus: Escribes Markdown
    Textus-->>Tú: Lo representa en vivo
```

**Ajustes → Editor y aspecto → Motor de diagramas** elige quién dibuja estos bloques: Mermaid, el predeterminado, o Pele, que es más rápido pero distribuye los diagramas a su manera y omite algunas funciones; un diagrama que Pele no puede dibujar lo dibuja Mermaid.

## Imágenes

Pega una imagen directamente desde el portapapeles: Textus la guarda e inserta la referencia. Dónde va se decide en **Ajustes → Editor y aspecto → Imágenes**. **En este equipo**, va a una **Subcarpeta** de la carpeta del documento, `assets/` por defecto, cuyo nombre puedes cambiar, o a **La misma carpeta que el documento**; Ajustes muestra el enlace que recibe la imagen pegada. Con **Subir a un servidor de imágenes**, se envía a PicGo / PicList, SM.MS, Imgur o a un endpoint tuyo (**Personalizado**).

Un endpoint personalizado recibe `multipart/form-data` con un campo `file` y puede devolver la URL pública como texto sin formato o en un campo JSON configurable. Los archivos subidos pueden renombrarse automáticamente, mantener su nombre original o pedirte un nombre antes de cada subida. Las referencias a imágenes existentes no se modifican al cambiar el modo de almacenamiento.

O escribe la referencia a mano:

```markdown
![texto alternativo](assets/screenshot.png)
```

Las incrustaciones de Obsidian, como `![[image.png]]` o `![[attachments/image.png|300]]`, también muestran la imagen: Textus busca el archivo en la bóveda de Obsidian del documento y guarda la incrustación tal como está escrita.

Para ver una imagen de cerca, haz doble clic en ella o pulsa **Ampliar imagen** en su esquina superior derecha (los diagramas tienen el mismo botón): desplaza o pellizca para hacer zoom, arrastra para moverla, haz doble clic para volver a encajarla y pulsa `Esc` para cerrar. Arrastra el tirador del borde derecho de una imagen para cambiar su tamaño. **Ajustes → Editor y aspecto → Imágenes en su propia línea** coloca en el centro o a la izquierda las imágenes que ocupan solas una línea, en el editor y en las exportaciones a HTML y PDF.

## Copiar y pegar

**Copiar** pone el Markdown en el texto sin formato del portapapeles y el formato al lado, así que GitHub, Obsidian, VS Code y las aplicaciones de chat reciben Markdown, mientras que Word, Pages, el correo y Notion lo pegan con formato. Una imagen que copias con clic derecho va al portapapeles como la propia imagen, lista para pegarla en un chat o en un documento. **Edición → Pegar como texto sin formato** (`Cmd+Shift+V`) pega el texto del portapapeles tal cual, sin interpretar el Markdown que contenga.

## Vistas y modos

Además del editor WYSIWYG y del modo código fuente (`Cmd+/`), Textus ofrece tres formas de escribir (en Windows y Linux, usa `Ctrl` en lugar de `Cmd`; Ajustes → Atajos de teclado muestra los atajos vigentes):

- **Código y vista previa** (`Cmd+Shift+E`): el código Markdown a la izquierda y la vista previa a la derecha, con el desplazamiento sincronizado.
- **Modo máquina de escribir**: la línea que escribes se queda en el centro de la ventana, en el editor, en el modo código fuente y en Código y vista previa.
- **Modo zen** (`Cmd+Shift+J`): oculta todo menos el texto y atenúa todos los párrafos salvo el que estás escribiendo. Pulsa `Esc` para salir.

Todos están en el menú **Visualización** y en **Ajustes → Editor y aspecto → Visualización**. Cada uno es un solo ajuste para todo Textus: cámbialo en cualquier ventana y todas las pestañas de todas las ventanas cambian con él, los documentos que abras después aparecen en él y Textus vuelve a abrirse en él la próxima vez.

**Visualización → Solo lectura** (también en el menú contextual de una pestaña) impide que un documento cambie, ya sea al escribir, pegar, soltar, deshacer, por Textus AI o por los complementos. Un candado junto al título lo indica; haz clic en él para que el documento vuelva a ser editable.

**Visualización → Paleta de comandos…** (`Cmd+Shift+P`) encuentra todo lo que hacen los menús, y cada comando que añade un complemento, escribiendo unas letras de su nombre. También cambia el aspecto (claro, oscuro o el del sistema) y el tema del editor, y activa o desactiva Textus AI.

La pestaña **Esquema** de la barra lateral muestra los encabezados del documento; haz clic en uno para ir a él. Haz clic derecho en el esquema para **Expandir todo** y **Contraer todo**, o haz `Option`-clic (`Alt`-clic) en la flecha de un encabezado para plegarlos o desplegarlos todos a la vez.

**Ajustes → Editor y aspecto → Tamaño del texto de la interfaz** agranda o reduce el texto de la barra lateral, las pestañas, los menús, el panel de IA y los Ajustes; el documento conserva su propio zoom. `Ctrl+Tab` y `Ctrl+Shift+Tab` pasan a la pestaña siguiente y a la anterior.

## Varios documentos a la vez

**Visualización → Dividir a la derecha** (`Cmd+Option+S`) muestra el documento activo junto a otro, y **Visualización → Dividir hacia abajo** pone uno encima del otro. Cada panel tiene sus propias pestañas: un documento que abres va al panel en el que estás, y Dividir a la derecha o Dividir hacia abajo vuelven a dividir ese panel, tantas veces como quieras.

- Arrastra una pestaña (o un archivo de la barra lateral) al borde de un panel y se abre en un panel nuevo de ese lado. Arrástrala al borde exterior del editor y se abre junto a todos los paneles: en el borde derecho de dos paneles puestos uno encima del otro, ocupa el lado derecho de arriba abajo. Suéltala sobre las pestañas de otro panel para moverla allí.
- Arrastra la línea entre dos paneles para cambiar su tamaño; haz doble clic en ella para igualarlos. Haz clic derecho en ella para pasarlos de lado a lado a uno encima del otro, intercambiarlos o cerrar la división.
- **Abrir al lado**, en el menú contextual de una pestaña, la muestra junto a la que está activa.
- Cierra la última pestaña de un panel y el panel desaparece. Toda la distribución vuelve cuando abres Textus de nuevo.

## Pestañas y ventanas

`Cmd+T` abre una pestaña nueva, `Cmd+N` una ventana nueva, y **Archivo → Reabrir pestaña cerrada** (`Cmd+Shift+T`) recupera los documentos que cerraste, empezando por el último. Un clic con el botón central cierra una pestaña; el menú contextual de una pestaña tiene **Cerrar las demás**, **Cerrar pestañas a la izquierda** y **Cerrar pestañas a la derecha** (las pestañas con cambios sin guardar siguen abiertas), **Copiar ruta** y **Mover a una ventana nueva**. También puedes arrastrar una pestaña fuera de la ventana para darle una ventana propia. Cuando Textus se vuelve a abrir, cada ventana vuelve con sus propias pestañas.

## Carpetas y búsqueda de archivos

**Archivo → Abrir carpeta…** abre una carpeta entera en la barra lateral: el árbol de archivos se queda en ella mientras abres los documentos que contiene, la carpeta vuelve con tu sesión y **Archivo → Cerrar carpeta** hace que el árbol vuelva a seguir al documento. El cuadro de la parte superior de la pestaña **Archivos** de la barra lateral busca nombres de archivo en toda la carpeta; `Cmd+Shift+O` salta a él. Escribe para filtrar, usa `↑`/`↓` para moverte, `Enter` para abrir y `Esc` para borrar. Ambas funciones son solo de escritorio.

El árbol también es un pequeño gestor de archivos. El nombre de la carpeta superior, encima, te lleva un nivel arriba. **Ordenar** lo ordena por nombre o por fecha de modificación, y el filtro junto al cuadro de búsqueda, **Todos los archivos** o **Solo documentos**, se aplica al árbol igual que a la búsqueda. Haz clic derecho en una carpeta, un archivo o el espacio vacío de abajo para crear allí un **Nuevo documento** o una **Nueva carpeta**, y arrastra un archivo o carpeta sobre otra carpeta para moverlo; un documento abierto lo sigue a su nuevo lugar. Nunca se reemplaza nada: un nombre ya usado se rechaza.

Arrastra archivos desde el Finder o el Explorador de archivos a la ventana para abrirlos: los documentos se abren en pestañas, las imágenes entran en el documento donde las sueltas y una carpeta se abre en la barra lateral. **Archivo → Copiar ruta** copia la ruta completa del documento activo.

Desde una terminal, `textus notas.md` abre un archivo en Textus; **Ajustes → General** instala el comando `textus` si todavía no está.

**Archivo → Abrir…** también abre un documento de Word (`.docx`), y lo mismo pasa al soltarlo en la ventana: se convierte en un documento Markdown nuevo con el mismo nombre, aún sin guardar, con sus títulos, listas, tablas, enlaces, notas al pie e imágenes. Las imágenes van, al guardarlo, adonde **Ajustes → Editor y aspecto → Imágenes** pone las pegadas, y **Guardar** propone un archivo `.md` junto al de Word. Parte del formato puede verse distinto; el archivo de Word nunca cambia. Solo en escritorio.

## Seguir abierto en segundo plano

Activa **Ajustes → General → Aplicación → Seguir abierto en segundo plano** y, al cerrar la última ventana, Textus sigue abierto, con su icono en el área de notificación (Windows), la bandeja del sistema (Linux) o la barra de menús (Mac). **Abrir Textus** en el menú del icono te devuelve a tus documentos; **Salir de Textus** ahí cierra Textus del todo. GNOME solo muestra el icono de bandeja con la extensión AppIndicator.

## Exportar

**Archivo → Exportar** guarda el documento como HTML o PDF; con [Pandoc](https://pandoc.org) instalado, también como Word (`.docx`), OpenDocument, RTF, EPUB, LaTeX y más. En un Mac, **Ajustes → Editor y aspecto → Exportar PDF con colores claros** imprime un PDF sobre blanco con los colores claros de tu tema, aunque escribas en modo oscuro.

## Complementos, temas y habilidades

**Ajustes → Extensiones → Conseguir más** muestra complementos, temas y habilidades para añadir: teclas de Vim y Emacs, un lector de PDF, gráficos, un grafo de conocimiento, herramientas de escritura y más. Cada uno tiene un solo botón (**Instalar** y después **Actualizar**, **Desactivar** o **Activar**) y **Desinstalar** en el menú de al lado. La página de un complemento explica cómo se usa, y sus comandos aparecen en el menú **Complementos** y en la paleta de comandos.

## Obtener ayuda

**Ayuda → Informar de un problema…** (también en **Ajustes → General**, en Ayuda) abre un formulario breve. Indica qué tipo de informe es, sobre qué parte de Textus trata y, si es un error, su gravedad, y luego cuenta qué ha fallado; Textus añade su versión, tu sistema, tus complementos, tus ajustes sin nada privado y los errores recientes, y te lo muestra todo antes de enviar nada. **Enviar** lo registra por ti como incidencia en GitHub, sin necesidad de cuenta de GitHub, y te dice su número; **Enviar en GitHub** abre en su lugar el formulario de GitHub; **Copiar** lo pone en el portapapeles para un chat o un correo. Lo que escribes se convierte en una incidencia pública; el correo o el WeChat que dejes, por si podemos preguntarte más, solo le llega al equipo.

**Ajustes → General → Ayuda** también vuelve a mostrar el tutorial de bienvenida, abre las guías y lleva a **Acerca de Textus**, con la versión y **Buscar actualizaciones** (en un Mac, también **Textus → Buscar actualizaciones…**). **Ayuda → Únete a la comunidad** abre la página de la comunidad.

## Notas al pie y líneas horizontales

Las notas al pie se ven así[^1], y debajo hay una línea horizontal:

---

[^1]: El contenido de las notas al pie se reúne al final del documento.

Escribe `[TOC]` en una línea aparte y pulsa Intro para insertar un índice: enumera los encabezados del documento y se actualiza mientras escribes; haz clic en uno para ir a él.

Que disfrutes escribiendo.
