# Guía de funciones de IA de Textus

Textus incluye una IA pensada para escribir, Textus AI: autocompletado, revisión gramatical y conversaciones que leen y revisan tu documento. Esta guía explica cómo conectar un servicio, qué ofrecen las funciones de IA y cómo convertir Textus AI en tu propio asistente de escritura con una carpeta, un perfil de estilo, una biblioteca, instrucciones de escritura y habilidades.

## Conectar un servicio

Todo lo relativo a la IA está en **Ajustes › Textus AI**, en cuatro páginas: **Modelos**, **Ayuda al escribir**, **Agente** y **Herramientas externas**.

1. En **Modelos**, elige el servicio en la lista **Proveedores**. Inicia sesión con tu cuenta (**Cuenta**) o pega una clave (**Clave de API**), según lo que admita ese servicio. Un punto en la lista marca cada servicio que ya has configurado.
2. Para un **Endpoint personalizado** (cualquier servidor compatible con OpenAI: modelos locales, proxies), escribe la URL base, una clave si la necesita y el nombre del modelo, y guarda.
3. En **Elección de modelo**, arriba en la misma página, elige el **Proveedor del chat** y el **Modelo de chat** y, para el autocompletado y la gramática, el **Proveedor de escritura** (**Igual que el chat** por defecto) y el **Modelo de asistencia**.

El inicio de sesión se hace en el navegador. Que puedas usar imágenes, búsqueda web y cambios en el documento depende del servicio y del modelo que elijas.

La lista de modelos integrada solo incluye los modelos predeterminados de cada proveedor (para Anthropic: Claude Sonnet 5.5 para el chat y Claude Haiku 5.5 para el autocompletado y la gramática). En **Modelos**, dentro de un proveedor, pulsa **Obtener modelos** para cargar su lista actual y elegir cualquiera de sus modelos.

Para **Doubao (Volcengine)**, crea la clave de API en la [consola de Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) y, en esa misma consola, activa los modelos que quieras usar: Ark rechaza las solicitudes a un modelo que tu cuenta no ha activado.

Los atajos de esta guía usan la notación de macOS; en Windows y Linux, lee Cmd como Ctrl y Option como Alt. Si cambias un atajo, **Ajustes › Atajos de teclado** muestra el que esté vigente.

## El uso diario

Las cinco formas que más vas a usar, empezando por hablar con ella.

### Conversaciones

Las conversaciones se abren como **pestañas**. Haz clic en el botón **Textus AI** (los destellos) del extremo derecho de la barra de la ventana, pulsa <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> o elige **Visualización › Panel de IA**: la IA se abre en una isla propia a la derecha. Sus pestañas son pestañas como las demás: arrastra una junto a un documento, a otra isla o fuera, a una ventana propia.

- **Por carpeta**: las conversaciones pertenecen a la carpeta en la que trabajas, no a un documento. Cada conversación abierta es una pestaña; la que está delante es con la que hablas, sobre el documento que está delante. Una conversación cerrada se queda en el historial.
- **Nueva conversación**: haz clic derecho en el papel vacío de una pestaña de IA y elige **Nueva conversación** (si quedan cambios por decidir, pregunta antes). **Memoria** está en el mismo menú.
- **Historial**: el reloj de arriba a la derecha de una pestaña de IA muestra las conversaciones anteriores agrupadas por carpeta, con **Buscar en las conversaciones** arriba para encontrar aquellas en las que se dijeron ciertas palabras. Haz clic en una para volver a abrirla. Cuando mencionas una conversación anterior, Textus AI también las busca. En **Ajustes › Privacidad y datos** puedes dejar de guardar las conversaciones.
- **Modo y modelo**: un botón entre los controles del cuadro de texto indica las dos cosas, «General · modelo». **General** trabaja en el documento: redacta texto nuevo (una continuación, un párrafo o una sección nuevos) y cambia el que ya está (reescribir, traducir, recortar). Con texto seleccionado, un cambio de ese texto lo sustituye y el texto nuevo va a continuación. **Revisar** responde, comenta y deja comentarios sin cambiar nada. **Investigar** toma un tema, lo investiga y lo redacta como un texto (consulta **Investigación** más abajo). La lista también contiene todos los modelos de los servicios que has configurado y los **Agentes** que has añadido (consulta **Agentes externos**). Una conversación nueva empieza en Revisar; después, el cuadro de texto conserva el último modo que elegiste.
- **Menciones con @**: escribe `@` en el cuadro de texto para elegir un archivo de texto de la carpeta; se adjunta al mensaje.
- **Adjuntar archivos**: el botón **+**, a la izquierda del cuadro de texto, adjunta a ese mensaje uno o varios archivos: un PDF, un documento de Word, una presentación de PowerPoint, una hoja de cálculo, un libro EPUB, un archivo RTF o HTML, cualquier archivo de texto o de código, un archivo zip o una imagen (PNG, JPEG, GIF, WebP, BMP, TIFF y, en Mac, HEIC y AVIF). Cada archivo se copia en la carpeta temporal propia de la conversación, nunca en tus carpetas, y allí Textus AI puede volver a leerlo entero. Los documentos se convierten en texto en el propio dispositivo y viajan dentro del mensaje; si es largo, solo se envía en parte, su etiqueta indica «(recortado)» y Textus AI lee el resto cuando lo necesita. Un archivo zip se descomprime allí y se enumeran sus archivos. Las imágenes se convierten a un formato que lee cualquier servicio, se reducen si son muy grandes y se envían como imágenes reales a los proveedores que pueden verlas (los que no pueden lo avisan de antemano en lugar de descartarlas sin decir nada).
- **Búsqueda web**: el botón de la lupa junto al cuadro de texto deja que Textus AI busque en la web cuando una petición lo necesite; consulta **Búsqueda web** más abajo.
- **Pensamiento profundo**: el botón junto a la búsqueda web (la bombilla) pide al modelo que piense bien la respuesta antes de contestar; es más lento y más caro, para preguntas difíciles y reescrituras grandes. Sigue activado, también en otros documentos, hasta que vuelvas a pulsarlo. Mientras el modelo piensa, la pestaña muestra «Pensando · 8 segundos» y después «Pensó durante 12 segundos», que puedes pulsar para leer el razonamiento cuando el proveedor lo comparte. El botón solo aparece con modelos que pueden pensar más a fondo; Pregunta rápida siempre pide una respuesta rápida.
- **Errores**: cuando una petición falla, Textus indica en tu idioma qué tipo de problema es y qué hacer (revisar la clave, recargar un saldo agotado, esperar un momento, elegir otro modelo), encima del mensaje del propio proveedor; en el chat y también en el autocompletado y la revisión gramatical.
- **Documentos largos**: si le pides traducir o reescribir un documento largo capítulo a capítulo, Textus AI encarga cada capítulo a un ayudante propio, con una lista común de cómo se escriben los nombres y términos que se repiten, para que todo el documento cambie a la vez.

### Cambios en tus documentos

**Ajustes › Textus AI › Ayuda al escribir › Cómo cambia Textus AI los archivos** decide cómo llegan a tu texto los cambios de Textus AI:

- **Como revisiones para revisar** (el predeterminado): cada cambio es una revisión que se muestra donde se aplicaría, y nada es definitivo hasta que lo aceptas.
- **Escritos directamente**: los cambios se escriben a medida que llegan. Quedan marcados para que veas qué ha cambiado, y cada respuesta se puede deshacer.

Un texto de Investigar se escribe directamente en cualquier caso. <kbd>Cmd</kbd>+<kbd>Z</kbd> deshace de una vez un cambio aceptado.

**Cómo se ven las revisiones**: **Mostrar revisiones** (en Ayuda al escribir, o el botón del ojo de la barra de revisión) tiene tres vistas:
- **Solo el resultado, original en el margen** (la predeterminada);
- **Original en el texto, cambios en el margen**;
- **Todo en el texto**: el texto eliminado, tachado; el nuevo, en verde.

El texto nuevo siempre se muestra en el texto. Si no hay sitio para un margen (ventana estrecha, con la barra lateral y la IA abiertas), las vistas con margen esperan y el texto lo muestra todo.

- **La barra de revisión**: una sola barra al pie del documento reúne todo lo pendiente, cambios y notas por igual. Recórrelos con ‹ › (o <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd>), usa **Aceptar** o **Rechazar** en cada uno, o **Aceptar todo** / **Rechazar todo**. Cada frase cambiada tiene además ✓ / ✕ en el texto; si aceptas solo algunas, la barra indica «Aceptar 2 de 5». Con el teclado: <kbd>Cmd</kbd>+<kbd>Return</kbd> acepta, y <kbd>Cmd</kbd>+<kbd>Delete</kbd> con el cursor sobre un cambio lo rechaza.
- **Motivos**: cada tarjeta de propuesta en la conversación explica por qué Textus AI hizo ese cambio.
- **En el cursor**: sin nada seleccionado, Textus AI sabe dónde está tu cursor, así que «escribe aquí una transición» inserta el texto justo ahí.
- **Comentarios en lugar de cambios**: pide una revisión («¿qué flojea aquí?») y Textus AI fija comentarios a los fragmentos sin cambiarlos. Cada tarjeta de comentario tiene **Mostrar en el documento**, que selecciona el fragmento al que se refiere.
- **Tus propias notas**: selecciona unas palabras, haz clic derecho y elige **Añadir nota**: tu nota va al margen junto a las de Textus AI, marcada como Yo. Las notas se guardan junto a los datos propios de Textus, no en tu Markdown.
- **Control de mis cambios** (menú Visualización): mientras está activado, tus propios cambios también se muestran como cambios (lo que borraste, tachado; lo que añadiste, marcado), cada uno con una tarjeta en el margen, marcada como Yo, para aceptarlo o rechazarlo. El archivo guarda el original con solo los cambios que aceptaste; los que quedan por decidir se guardan a su lado, en la carpeta `.textus`, como los de Textus AI, y vuelven cuando abres el documento de nuevo: comparte la carpeta y van con ella.

**Otros archivos de la carpeta**: Textus AI puede cambiar archivos que no tienes abiertos.

- **Como revisiones para revisar**: un cambio en uno de esos archivos espera en él como revisiones. Entran en el texto cuando lo abres, para aceptarlas o rechazarlas como se explica arriba. El árbol de archivos y la pestaña del archivo lo marcan: «3 por revisar».
- **Un archivo nuevo que crea** espera a que decidas: **Conservar** lo mantiene y **Descartar** lo elimina (va a la papelera).
- **Escritos directamente**: el cambio se escribe enseguida, y el texto anterior se guarda para poder deshacerlo.
- **La tarjeta de la respuesta** enumera los archivos que tocó, con **Deshacer**, **Aplicar**, **Conservar** y **Descartar**. Un archivo que hayas editado entretanto deja su cambio aparte, marcado como «Cambiado desde entonces»; **Descartar** lo deja pasar.

### Autocompletado

Mientras escribes, aparece una continuación en gris en el cursor: pulsa <kbd>Tab</kbd> para aceptarla, o <kbd>Cmd</kbd>+<kbd>→</kbd> para aceptar solo la palabra siguiente y dejar el resto como sugerencia. <kbd>Esc</kbd> la descarta. No hace falta una cantidad mínima de texto: funciona desde la primera frase del documento.

Pide una de forma explícita con <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> o desde el menú contextual (el cursor debe estar al final de un párrafo): obtendrás una continuación más larga con hasta tres alternativas, que recorres con <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd>.

En **Ajustes › Textus AI › Ayuda al escribir › Continuar y revisar** puedes activar o desactivar el autocompletado y elegir un **Tono del autocompletado** (según el documento / formal / informal / académico / conciso). Cuando el documento pertenece a una carpeta con perfil de estilo o biblioteca (consulta **Personaliza Textus AI** más abajo), el autocompletado también los sigue.

### Revisión gramatical

Los posibles problemas aparecen subrayados. Pasa el puntero sobre uno, o coloca el cursor en él, para ver la explicación; **Aplicar** (o <kbd>Option</kbd>+<kbd>Enter</kbd> con el cursor encima) acepta la corrección e **Ignorar** la descarta. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> revisa el párrafo actual de inmediato. **Nivel de revisión** (Ayuda al escribir › Continuar y revisar) decide cuánto señala.

### Pregunta rápida

Pulsa <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (o haz clic derecho › **Preguntar a la IA…**) para abrir una pequeña barra de chat justo debajo del párrafo en el que estás. Se coloca dentro del documento y empuja hacia abajo el texto que hay debajo en lugar de taparlo. Si había texto seleccionado al abrirla, la selección se incluye. Pregunta rápida se abre en modo **General**, porque normalmente se abre sobre un fragmento para cambiarlo («acorta esto»); Revisar está a un clic en el selector de modo.

- **El atajo otra vez**: si pulsas <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> con la barra abierta, el cursor pasa a su cuadro de texto; si vuelves a pulsarlo desde ahí, la barra se cierra. <kbd>Esc</kbd> en cualquier parte de la barra también la cierra, y el cursor vuelve al documento. Si quedan cambios por decidir, la barra pregunta antes de cerrarse o de empezar una conversación nueva.
- Pregunta rápida tiene su propia conversación breve, separada de la de las pestañas de IA, que no se guarda en el historial. **Continuar en la conversación completa** (el botón de su esquina) pasa el intercambio a una pestaña de IA, donde sigue y se guarda.

## Personaliza Textus AI

Textus AI aprende sobre ti y tu trabajo a partir de unos pocos archivos Markdown normales, no de ajustes ocultos. Cada uno tiene una sola función:

| Concepto | Qué es | Dónde está |
| --- | --- | --- |
| **Carpeta** | La carpeta en la que trabaja Textus AI y que puede leer | La carpeta que abres en la barra lateral, o una que elijas |
| **Perfil de estilo** | Cómo escribes | `.textus/style.md` |
| **Biblioteca** | Datos sobre personas, lugares y términos | `.textus/library/` |
| **Instrucciones de escritura** | Normas fijas para todas las conversaciones | `agent.md`, global y por carpeta |
| **Memoria** | Lo que Textus AI guarda de tus conversaciones | `memory/` en la carpeta de configuración global y, a su lado, `projects/<carpeta>/memory/` para cada carpeta |
| **Habilidades** | Instrucciones reutilizables que invocas con `/nombre` | `skills/`, global y por carpeta |
| **Carpeta de configuración global** | Lo que se aplica a todos los documentos | La carpeta de ajustes de la aplicación |

En adelante, «conversaciones» se refiere a las pestañas de IA y a Pregunta rápida. Así se ve una carpeta completa de un vistazo:

```
mi-novela/               ← la carpeta
├── capitulo-1.md        ← el documento que estás editando
├── notas/
│   └── cronologia.md    ← material de consulta que Textus AI puede leer
└── .textus/              ← los ajustes propios de la carpeta
    ├── style.md         ← perfil de estilo
    ├── agent.md         ← instrucciones de escritura de esta carpeta
    ├── library/
    │   ├── lin-wan.md   ← una entrada por personaje, lugar o término
    │   └── ciudad-puerto.md
    └── skills/
        └── pulir.md     ← una habilidad por archivo
```

El menú de la carpeta crea `.textus/` y sus archivos la primera vez que los pides; las habilidades de la carpeta son lo único que añades a mano. El texto dentro de comentarios `<!-- -->` en cualquiera de estos archivos es una nota para ti y nunca se envía.

### La carpeta

**La carpeta es aquella en la que trabaja Textus AI.** Es la carpeta que abres en la barra lateral (**Archivo › Abrir carpeta…**) o una que elijas; si no, la carpeta más cercana por encima del documento que tenga una carpeta `.textus/`, de modo que un capítulo en `novel/part-1/` pertenece a `novel/`. Un documento que abres solo no tiene carpeta: Textus AI lee entonces únicamente el documento y los archivos que adjuntes, de modo que un archivo en Descargas o en el Escritorio nunca le abre toda esa carpeta.

- Textus AI puede listar, encontrar por nombre, leer y buscar en sus archivos para encontrar las escenas anteriores de un personaje, un término o tus notas: archivos de texto (Markdown, texto sin formato y formatos similares) de hasta 16 MB, que lee por partes cuando son largos, y el texto de los archivos PDF, Word, PowerPoint, EPUB, RTF y de hojas de cálculo. Con un proveedor que puede ver imágenes, también mira las imágenes PNG, JPEG, GIF y WebP de la carpeta, de hasta 6 MB cada una. Se omiten los archivos y las carpetas ocultos, lo que excluye un archivo `.gitignore` o `.ignore` (como en la búsqueda de archivos de la barra lateral), las carpetas de compilación y de dependencias (como `node_modules`) y los PDF escaneados sin capa de texto.
- Escribir `@` en el cuadro de texto del chat adjunta uno de sus archivos a tu mensaje.
- Su carpeta `.textus/` guarda el perfil de estilo, la biblioteca, las instrucciones de escritura y las habilidades de la carpeta.

Haz clic derecho en el papel vacío de una pestaña de IA y elige **Memoria**: su fila superior muestra el nombre de la carpeta; haz clic en ella para abrir el **menú de la carpeta**. Si tu material de consulta no está junto al borrador, usa **Elegir carpeta…** en ese menú (o **Ajustes › Textus AI › Agente › Carpeta**). La carpeta que elijas se usa para todos los documentos, incluidos los borradores sin guardar, hasta que elijas **No usar ninguna carpeta**.

> [!TIP]
> ¿Tu borrador está en `tesis/borradores/` y tus notas de entrevistas en `tesis/fuentes/`? Elige `tesis/` como carpeta y Textus AI podrá leer `fuentes/entrevistas.md` mientras trabajas en `borradores/capitulo-2.md`.

Todo lo que lee Textus AI tiene que estar dentro de la carpeta: se rechazan `..`, las rutas absolutas y los enlaces que apuntan fuera. Sin una carpeta abierta o elegida no hay carpeta, y se rechaza una carpeta demasiado amplia, como tu carpeta personal o una unidad entera. Lo que Textus AI crea mientras trabaja (notas de investigación, borradores en curso) va a las carpetas propias de Textus o a la carpeta temporal del sistema, no a la tuya.

### El perfil de estilo: «Aprender mi estilo»

**El perfil de estilo describe cómo escribes**, para que las continuaciones y los cambios suenen a ti: voz y tono, ritmo de las frases, vocabulario, puntuación y lo que nunca haces. Textus AI lo sigue en las conversaciones, y el autocompletado también mientras escribes, en todos los documentos de la carpeta. Es el archivo `.textus/style.md`.

Hay dos formas de crearlo, ambas en el menú de la carpeta:

- **Aprender mi estilo a partir de muestras…**: elige algunos archivos escritos por ti (hasta ocho). Textus AI los estudia, redacta un perfil (voz y tono, frases y ritmo, vocabulario, puntuación, estructura, lo que nunca haces y algunas citas breves como ejemplos) y lo abre en una pestaña nueva. Léelo, corrígelo y amplíalo: es tuyo. Si vuelves a usar esta opción, el perfil anterior se conserva como `style.previous.md`.
- **Crear perfil de estilo**: empieza con un esquema vacío y escríbelo tú.

Cuando ya hay un perfil, **Abrir perfil de estilo** en el menú de la carpeta (y la fila del estilo en Memoria) lo abre.

```markdown
# Perfil de estilo

## Frases y ritmo
- Frases cortas, rara vez de más de 15 palabras.
- Abre cada párrafo con una escena concreta y después pasa a la idea.

## Nunca
- Signos de exclamación. La expresión «de repente».
```

Los puntos concretos y comprobables funcionan mejor que los adjetivos: «frases cortas, rara vez de más de 15 palabras» en lugar de «conciso». Procura que no pase de una o dos páginas; solo se usan los primeros 6000 caracteres. El **Tono del autocompletado** de Ajustes también se aplica: déjalo en *Según el documento* cuando tu perfil de estilo ya describa tu voz.

### La biblioteca

**La biblioteca guarda los datos que deben mantenerse coherentes**: un archivo Markdown por personaje, lugar o término, en `.textus/library/`. **Nueva entrada de biblioteca…**, en el menú de la carpeta, pide un nombre y abre la entrada nueva; Memoria las muestra todas.

```markdown
---
name: Lin Wan
aliases: [Wan, profesora Lin]
include: detected
---

Protagonista, 32 años, profesora de chino en una escuela secundaria de Ciudad Puerto.
Zurda. Nunca habla de su hermano.
```

No tienes que adjuntar las entradas. Una entrada con `include: detected` (el valor predeterminado) llega a Textus AI siempre que aparece su nombre o uno de sus alias: en tu mensaje o en el documento durante una conversación, y en el texto que rodea al cursor durante el autocompletado. `always` la envía con cada petición; `never` la deja fuera. Las entradas que no se mencionan no cuestan nada, así que la biblioteca puede crecer tanto como necesite tu proyecto.

### Instrucciones de escritura (agent.md)

**Las instrucciones de escritura son normas fijas que se envían en cada conversación**: de qué trata la carpeta, en qué idioma responder, grafías y términos, y lo que Textus AI debe hacer siempre o no hacer nunca. Están en archivos llamados `agent.md`, en dos niveles:

- **Global**, para todos los documentos: **Ajustes › Textus AI › Agente › Instrucciones de escritura (agent.md) › Editar agent.md**.
- **Carpeta**, para los documentos de una carpeta: `.textus/agent.md`, que se abre con **Editar instrucciones de escritura de la carpeta** en el menú de la carpeta.

Ambos se abren en una pestaña y empiezan con una breve guía en comentarios. Cuando existen los dos, Textus AI recibe ambos (primero las instrucciones globales y después las de la carpeta) y, en caso de contradicción, prevalecen las de la carpeta.

```markdown
El libro es una novela de misterio ambientada en el Shanghái de los años treinta, narrada por Lin Wan en primera persona.
Responde siempre en español, aunque la novela esté en chino.
Escribe «Shanghái», nunca «Shanghai».
```

Las instrucciones de escritura solo se aplican a las conversaciones. El autocompletado no las lee: sigue el perfil de estilo y la biblioteca.

### Lo que recuerda Textus AI

**Textus AI recuerda lo que le pides y cómo escribes**, sin que tengas que escribir ningún archivo. Cuando le dices algo que debe valer más allá de una petición («escribe siempre en español de España», «nada de rayas», una corrección que tuviste que hacer dos veces) o un dato sobre tu obra, como quién es un personaje, lo guarda y lo sigue en las conversaciones siguientes. Cada vez, una línea bajo su respuesta indica qué ha recordado y dónde: **Deshacer** lo retira, y **Hacer global** o **Solo para esta carpeta** lo cambia de sitio.

- **Esta carpeta**: lo que trata de esta obra, en `projects/<carpeta>/memory/` dentro de la carpeta de configuración global (Textus lo guarda allí, no en tu carpeta); los datos sobre personas, lugares y términos van a la biblioteca.
- **Para todas las carpetas**: tus hábitos generales, en `memory/` dentro de la carpeta de configuración global. Sin carpeta, todo va aquí.

**Memoria** (clic derecho en el papel de una pestaña de IA › Memoria) lo muestra todo, con cuándo y en qué conversación se recordó cada cosa: **Editar** lo abre y **Eliminar** lo borra. De vez en cuando, Textus AI ordena su memoria: une los recuerdos que dicen lo mismo y descarta una regla que otra más reciente ha dejado sin efecto; lo descartado está en **Olvidado hace poco**, para recuperarlo. Tus propias instrucciones de escritura prevalecen cuando ambas no coinciden, y Textus AI nunca cambia tu `agent.md` ni tu perfil de estilo. Cuando hay demasiados recuerdos para enviarlos, se omiten los más antiguos y Memoria lo indica. El interruptor **Memoria** (Ajustes › Textus AI › Agente) lo desactiva.

**También aprende de tus decisiones de revisión.** Cuando rechazas varias veces el mismo tipo de cambio —「」 convertidas en “”, una palabra cambiada por otra, frases divididas, una coma de Oxford añadida—, Textus AI te ofrece, al terminar la revisión, recordarlo como requisito: **Recordar** lo guarda en **Memoria**, **Ahora no** espera a tener más pruebas y **No volver a preguntar** deja de preguntar por ese tipo. Pregunta como mucho una vez al día, y solo se guarda algo cuando haces clic, también con la memoria desactivada. Lo que cuenta es una breve nota de los tipos de cambio que aceptaste o rechazaste, guardada en este ordenador junto a tus recuerdos y nunca enviada.

### Habilidades (/nombre)

**Una habilidad es un conjunto de instrucciones reutilizable y con nombre** («pulir», «esquema», «revisar las citas») guardado en un archivo Markdown: arriba, un nombre y una descripción de una línea; debajo, las instrucciones completas.

```markdown
---
name: pulir
description: Pule el fragmento seleccionado sin cambiar su significado
---

Pule el texto dado frase por frase: elimina las palabras que sobran,
divide las frases demasiado largas y conserva el significado y la voz
originales. Devuelve solo el texto pulido.
```

Puedes usar una habilidad de dos maneras:

1. **Invocarla**: escribe `/` en el cuadro de texto del chat y elígela en el menú, o escribe su nombre seguido de tu petición: `/pulir dale otra vuelta a esto`.
2. **Pedirlo sin más** (solo con proveedores que admiten llamadas a herramientas): Textus AI conoce el nombre y la descripción de cada habilidad y, cuando tu petición encaja con una, carga sus instrucciones completas y las sigue por su cuenta.

Cuando lo que pediste era un procedimiento propio, unos pasos que querrás repetir, Textus AI ofrece bajo su respuesta guardarlo como habilidad, para todos los documentos o solo para esta carpeta. No se guarda nada a menos que lo elijas.

Las habilidades están en los mismos dos niveles que las instrucciones de escritura: las globales, en la carpeta `skills/` de la carpeta de configuración global (**Importar habilidad…**, arriba en Habilidades de **Ajustes › Textus AI › Agente**, copia ahí un archivo de habilidad), y las de la carpeta, en `.textus/skills/` (una carpeta oculta; en el Finder de macOS, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> la muestra). Una habilidad de la carpeta con el mismo nombre que una global la reemplaza.

### Habilidades integradas

Textus trae cuatro habilidades. **Corregir**, en Revisar, comprueba la ortografía, la gramática, la puntuación y los números según las normas del idioma del texto. **Diseñar un tema**, **Crear un complemento** y **Crear una habilidad** hacen un tema para el editor, un pequeño complemento o una habilidad propia a partir de lo que describas, en una pestaña propia: **Crea tu tema** está en la tienda de temas de Apariencia, y **Crea tu plugin**, en el menú **⋯** del panel Complementos. Hay más habilidades —ampliar, condensar, traducir, resumir, revisar continuidad, correo, acta de reunión y otras— en **Disponibles**, al final de Habilidades en **Ajustes › Textus AI › Agente**. Escribe `/` y elige una, o escribe su nombre en cualquiera de los idiomas de la aplicación: `/proofread`, `/校对` y `/校正` llaman a la misma habilidad. Textus AI también elige una por su cuenta cuando tu petición encaja. **Diseñar un tema** pone el CSS del tema en la respuesta: **Usar este tema**, debajo, lo instala; o guárdalo como archivo .css y añádelo con **Añadir un tema desde un archivo CSS** en **Ajustes › Apariencia**.

Las habilidades integradas encabezan Habilidades en **Ajustes › Textus AI › Agente** y siempre están activas. **Personalizar…** copia una en la carpeta `skills/` de la carpeta de configuración global y abre la copia para que cambies sus instrucciones; a partir de entonces se usa tu copia. **Restablecer** borra la copia y recupera la versión integrada. Debajo están las habilidades que añadiste. Cada una indica los modos en que funciona (haz clic para cambiarlos), y su interruptor la desactiva por ahora; sus modos se guardan para cuando la vuelvas a activar. Una habilidad tuya con el nombre de una integrada la reemplaza.

### Normas de escritura

**Normas de escritura** (Ajustes › Textus AI › Ayuda al escribir › Continuar y revisar) decide qué normas de puntuación, espacios y números siguen Textus AI y la revisión gramatical. **Automático** aplica la norma nacional cuando el idioma la tiene (GB/T para el chino simplificado o JTF para el japonés, por ejemplo); en los demás casos sigue lo que tu documento ya hace con más frecuencia y solo señala las incoherencias. Si eliges un perfil, como **Ficción** en chino simplificado o **Reino Unido · GOV.UK** en inglés, los documentos en ese idioma se revisan según él.

Una carpeta puede elegir el suyo: añade una línea `conventions:` entre las dos líneas `---` del principio de su perfil de estilo (`.textus/style.md`). En los documentos de esa carpeta, prevalece sobre el ajuste.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### La carpeta de configuración global

**La carpeta de configuración global guarda lo que se aplica a todos los documentos**: tu `agent.md` global y tus habilidades globales. Pertenece a la aplicación, no a una carpeta; **Ajustes › Textus AI › Agente › Carpeta de configuración global › Mostrar** la muestra.

```
agent/                ← la carpeta de configuración global
├── agent.md          ← instrucciones de escritura globales
└── skills/
    └── esquema.md    ← una habilidad global
```

No hay perfil de estilo ni biblioteca globales: describen una obra concreta, así que pertenecen a una carpeta.

### Qué se aplica y cuándo

| | Conversaciones | Autocompletado | Revisión gramatical |
| --- | :---: | :---: | :---: |
| Archivos de la carpeta (leer, buscar, `@`) | ✓ | | |
| Perfil de estilo | ✓ | ✓ | |
| Entradas de la biblioteca mencionadas | ✓ | ✓ | |
| Instrucciones de escritura | ✓ | | |
| Lo que recuerda Textus AI | ✓ | | |
| Habilidades | ✓ | | |
| Tono del autocompletado (Ajustes) | | ✓ | |

- **Primero lo global, después la carpeta.** Se envían las instrucciones de escritura de los dos niveles, las de la carpeta al final, y las de la carpeta prevalecen si hay un conflicto. Una habilidad de la carpeta reemplaza a una global con el mismo nombre.
- **Una sola carpeta a la vez.** Solo cuenta su `.textus/`: si has elegido una carpeta, no se lee el `.textus/` que haya junto al documento.
- **Sin reiniciar.** Edita cualquiera de estos archivos y la siguiente petición usará la versión nueva (el autocompletado, en unos diez segundos).

### ¿Qué archivo para qué?

- Cómo debe sonar tu texto → el **perfil de estilo**.
- Quién es quién y qué es qué → la **biblioteca**.
- Lo que Textus AI debe saber o hacer siempre en una conversación → las **instrucciones de escritura**.
- Una tarea que pides una y otra vez → una **habilidad**.
- Notas, documentación, capítulos anteriores → archivos normales en la **carpeta**; Textus AI los lee cuando una petición lo requiere.

## Más

### Investigación

Elige **Investigar** en el botón de modo y envía un tema en lugar de una petición: Textus AI lo investiga (en la web, en tu carpeta, en los artículos que adjuntes), prepara un esquema y escribe el texto en el documento. Escribe `/` para elegir el tipo de texto (un ensayo, un informe, una revisión bibliográfica y otros), o déjalo en **Elegir por mí**. **Investigar con subagentes** (Ayuda al escribir) le permite repartir partes de la investigación entre ayudantes que trabajan a la vez; **Comprobar citas** hace que cada frase citada se compruebe con sus fuentes antes de terminar el texto. El texto se escribe directamente en el documento, diga lo que diga **Cómo cambia Textus AI los archivos**.

### Búsqueda web

Activa el botón **Búsqueda web** junto al cuadro de texto y Textus AI buscará en la web cuando una petición necesite datos actuales o de los que no esté seguro. También puede leer una página cuya dirección pegues.

- **Quién busca**: los modelos que buscan por sí mismos —OpenAI, Claude, Grok, OpenRouter, Groq, Qwen y Zhipu GLM— usan su propia búsqueda. Con cualquier otro modelo (DeepSeek, Gemini, Mistral, Kimi, modelos locales, endpoints personalizados) busca Textus, con el **Servicio de búsqueda** elegido en **Ajustes › Textus AI › Ayuda al escribir › Web y proxy**: **Automático** usa una clave de DeepSeek, Zhipu o Kimi que ya guardaste para el chat; o elige Bocha, Tavily, Brave Search o Exa y pega su clave, o SearXNG e indica la dirección de tu propio servidor. La fila indica adónde van tus búsquedas. Si no hay con qué buscar, el botón muestra un punto rojo.
- **Fuentes**: la respuesta cita lo que encontró como [1], [2] y enumera esas páginas debajo; haz clic en una para abrirla en el navegador. Los números se mantienen durante toda la conversación.
- **Fuentes como notas al pie**: cuando una propuesta se basa en la web, su tarjeta muestra **Añadir las fuentes como notas al pie**. Si lo marcas, al aceptarla se añaden notas al pie de Markdown con sus fuentes al final del documento; sin marcar, el texto entra sin ellas. La tarjeta recuerda tu última elección.
- **Las páginas se leen, no se obedecen**: lo que dice una página nunca es una instrucción para Textus AI, que sigue limitándose a proponer cambios. Textus solo lee páginas de la web pública, nunca de tu ordenador ni de tu red local.

### Imágenes

Textus AI puede crear imágenes para tu documento. **Servicio de imágenes** (Ajustes › Textus AI › Modelos › Elección de modelo) sigue por defecto a tu proveedor del chat: si has iniciado sesión con ChatGPT, las imágenes salen de la cuota de tu plan (marcado como experimental, porque no es una API publicada); con otro proveedor que crea imágenes, las suyas, con la misma clave. Un proveedor que no crea imágenes no ofrece ninguna hasta que eliges un servicio (OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow o cualquier endpoint compatible con OpenAI) y después su modelo.

- Pídelo en el modo General («añade una imagen del puerto después del primer párrafo»), o haz clic derecho en un párrafo y elige **Ilustrar este párrafo**.
- El texto y las imágenes llegan juntos: el texto aparece a medida que se escribe, y cada imagen se muestra como un marco que se mueve suavemente en su sitio hasta que está lista. Puedes aceptarla antes de que termine; se guarda cuando llega.
- No se guarda nada hasta que aceptas: entonces la imagen se guarda como dice **Ajustes › Edición › Imágenes** para una imagen pegada y se inserta como imagen de Markdown. Rechazar no deja nada.
- Para que una imagen propuesta se dibuje de nuevo, señálala y elige **Redibujar…**, y di qué debe cambiar; solo se vuelve a dibujar esa imagen. Las imágenes de un mismo texto mantienen las mismas personas y el mismo estilo: alguien que vuelve a aparecer se describe con las mismas palabras y, cuando el modelo de imagen acepta una imagen de partida, una imagen nueva de esa persona parte de una anterior.
- Para cambiar una imagen, haz clic derecho en ella y elige **Cambiar esta imagen con Textus AI…**, y di cómo. La nueva se propone en su lugar; cuando la aceptas, se te pregunta si el archivo antiguo debe ir a la papelera (se queda si no dices lo contrario).
- Di cuántas imágenes quieres y Textus AI crea esas, hasta **Imágenes por petición** (Modelos › Elección de modelo; dos si no lo cambias). Si el servicio rechaza una descripción, el sitio de la imagen muestra el motivo que dio.

### Agentes externos

Los agentes de programación como Claude Code o Codex pueden trabajar en Textus mediante complementos. Cuando añades uno, tiene un botón junto al botón Textus AI en la barra de la ventana y aparece en el grupo **Agentes** del botón de modo: elígelo y tus mensajes irán a él en lugar de a un modelo. Antes de cambiar un archivo, te pregunta en la conversación. **Ajustes › Textus AI › Herramientas externas** los muestra en **ACP Agent** (**Conseguir agentes…** abre el panel Complementos) y, encima, los **Servidores MCP** cuyas herramientas puede usar Textus AI.

## Desactivar Textus AI

Haz clic derecho en el botón **Textus AI** del extremo derecho de la barra de la ventana para pausar Textus AI una hora o desactivarla. Mientras está desactivada, los destellos aparecen tachados, y un clic en el botón ofrece volver a activarla; una pausa termina sola al cabo de la hora. La paleta de comandos (**Activar o desactivar Textus AI**) y un atajo que puedes asignar en **Ajustes › Atajos de teclado** también lo hacen; en el iPhone está en el menú.

Mientras está desactivada, no se envía nada a ningún servicio de IA desde que se abre Textus: ni autocompletado, ni revisión gramatical, ni conversación, ni nada que recordar. Las pestañas de IA, Pregunta rápida y las opciones de IA del menú contextual desaparecen, y una respuesta que se estaba escribiendo se detiene. Los cambios ya propuestos en el documento se quedan para que los aceptes o rechaces. Cada función conserva su propio ajuste, y todas vuelven a aplicarse en cuanto Textus AI está activada de nuevo.

## Una nota sobre la privacidad

Tu documento, los archivos adjuntos y mencionados con @, tus instrucciones de escritura, el perfil de estilo, las entradas de la biblioteca mencionadas y los archivos de la carpeta que lea Textus AI se envían al proveedor seleccionado como parte de cada petición; **Aprender mi estilo** envía las muestras que elijas. Con la búsqueda web activada, las búsquedas van a tu proveedor o al servicio de búsqueda que muestran los Ajustes, y las páginas que lee Textus AI se descargan desde este ordenador. Desactiva cualquier función en Ajustes cuando no quieras que eso ocurra.
