# Guía de funciones de IA de Textus

Textus incluye una IA pensada para escribir, Textus AI: autocompletado, revisión gramatical y conversaciones que leen y revisan tu documento. Esta guía explica cómo conectar un servicio, qué ofrecen las funciones de IA y cómo convertir Textus AI en tu propio asistente de escritura con una carpeta del proyecto, un perfil de estilo, una biblioteca, instrucciones de escritura y habilidades.

## Conectar un servicio

1. Abre **Ajustes > Textus AI** y elige el servicio que quieras en **Conexión > Proveedor**.
2. Despliega **Acceso y credenciales** e inicia sesión con tu cuenta o escribe una clave de API, según lo que admita ese servicio.
3. Para un **Endpoint personalizado** (cualquier servidor compatible con OpenAI: modelos locales, proxies), escribe la URL base, una clave si la necesita y el nombre del modelo, y guarda.
4. Elige el modelo de escritura en **Asistencia de escritura** y el modelo de chat en **Chat de Textus AI**.

El inicio de sesión se hace en el navegador. Que puedas usar imágenes, búsqueda web y cambios en el documento depende del servicio y del modelo que elijas.

La lista de modelos integrada solo incluye los modelos predeterminados de cada proveedor (para Anthropic: Claude Sonnet 5.5 para el chat y Claude Haiku 5.5 para el autocompletado y la gramática). Pulsa **Obtener modelos** en la fila Lista de modelos, dentro de **Conexión**, para cargar la lista actual del proveedor y elegir cualquiera de sus modelos.

Para **Doubao (Volcengine)**, crea la clave de API en la [consola de Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) y, en esa misma consola, activa los modelos que quieras usar: Ark rechaza las solicitudes a un modelo que tu cuenta no ha activado.

Los atajos de esta guía usan la notación de macOS; en Windows y Linux, lee Cmd como Ctrl y Option como Alt. Si cambias un atajo, **Ajustes > Atajos de teclado** muestra el que esté vigente.

## Las funciones de IA

### 1. Autocompletado

Mientras escribes, aparece una continuación en gris en el cursor: pulsa <kbd>Tab</kbd> para aceptarla, o <kbd>Cmd</kbd>+<kbd>→</kbd> para aceptar solo la palabra siguiente y dejar el resto como sugerencia. <kbd>Esc</kbd> la descarta. No hace falta una cantidad mínima de texto: funciona desde la primera frase del documento.

Pide una de forma explícita con <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> o desde el menú contextual (el cursor debe estar al final de un párrafo): obtendrás una continuación más larga con hasta tres alternativas, que recorres con <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd>.

En **Ajustes > Textus AI > Asistencia de escritura** puedes elegir un **tono del autocompletado** (según el documento / formal / informal / académico / conciso). Cuando el documento pertenece a un proyecto con perfil de estilo o biblioteca (consulta **Personaliza Textus AI** más abajo), el autocompletado también los sigue.

### 2. Revisión gramatical

Los posibles problemas aparecen subrayados. Pasa el puntero sobre uno, o coloca el cursor en él, para ver la explicación; **Aplicar** (o <kbd>Option</kbd>+<kbd>Enter</kbd> con el cursor encima) acepta la corrección e **Ignorar** la descarta. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> revisa el párrafo actual de inmediato.

### 3. El panel de IA

La conversación completa está en un panel a la derecha del editor. Ábrelo o ciérralo con el botón **Textus AI** (la pluma) del extremo derecho de la barra de la ventana o con <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **Una conversación por documento**: cada pestaña tiene su propia conversación, y al cambiar de pestaña el panel cambia con ella. **Nueva conversación**, en la cabecera del panel, empieza de cero (si quedan cambios por revisar, pregunta antes).
- **Modos**: el cuadro de texto ofrece dos. **Escribir** trabaja en el documento: redacta texto nuevo (una continuación, un párrafo o una sección nuevos) y cambia el que ya está (reescribir, traducir, recortar). Con texto seleccionado, un cambio de ese texto lo sustituye y el texto nuevo va a continuación. **Revisar** responde, comenta y deja comentarios sin cambiar nada. Cada cambio de Escribir es una propuesta que aceptas o rechazas. El panel empieza en el modo elegido en **Ajustes > Textus AI > Chat de Textus AI > Modo predeterminado**.
- **Menciones con @**: escribe `@` en el cuadro de texto para elegir un archivo de texto de la carpeta del proyecto; se adjunta al mensaje.
- **Adjuntar archivos**: el botón **+**, a la izquierda del cuadro de texto, adjunta a ese mensaje un PDF, un documento de Word, una presentación de PowerPoint, una hoja de cálculo, un libro EPUB, un archivo RTF o HTML, una imagen o un archivo de texto sin formato. Todo salvo las imágenes se convierte en texto en el propio dispositivo y viaja dentro del mensaje; las imágenes se envían como imágenes reales a los proveedores que pueden verlas (los que no pueden lo avisan de antemano en lugar de descartarlas sin decir nada). Un archivo largo solo se envía en parte, y en ese caso su etiqueta indica «(recortado)».
- **Modelo**: el botón entre los controles del cuadro de texto indica el modelo al que va tu próximo mensaje; haz clic en él para cambiar a otro modelo de cualquier servicio que hayas configurado en **Ajustes > Textus AI**. Si solo tienes un modelo configurado, solo muestra su nombre.
- **Búsqueda web**: el botón de la lupa junto al campo de texto deja que Textus AI busque en la web cuando una petición lo necesite; consulta **7. Búsqueda web** más abajo.
- **Pensamiento profundo**: el botón junto a la búsqueda web (la bombilla) pide al modelo que piense bien la respuesta antes de contestar; es más lento y más caro, para preguntas difíciles y reescrituras grandes. Sigue activado, también en otros documentos, hasta que vuelvas a pulsarlo. Mientras el modelo piensa, el panel muestra «Pensando · 8 segundos» y después «Pensó durante 12 segundos», que puedes pulsar para leer el razonamiento cuando el proveedor lo comparte. El botón solo aparece con modelos que pueden pensar más a fondo; Pregunta rápida siempre pide una respuesta rápida.
- **Historial**: el botón **Historial** (el reloj), en la cabecera del panel de IA, muestra las conversaciones anteriores agrupadas por carpeta, con **Buscar en las conversaciones** arriba para encontrar aquellas en las que se dijeron ciertas palabras. Haz clic en una para volver a abrirla con su documento y continuarla. Cuando mencionas una conversación anterior, Textus AI también las busca.
- **Errores**: cuando una petición falla, Textus indica en tu idioma qué tipo de problema es y qué hacer (revisar la clave, recargar un saldo agotado, esperar un momento, elegir otro modelo), encima del mensaje del propio proveedor; en el chat y también en el autocompletado y la revisión gramatical.
- **Documentos largos**: si le pides traducir o reescribir un documento largo capítulo a capítulo, Textus AI encarga cada capítulo a un ayudante propio, con una lista común de cómo se escriben los nombres y términos que se repiten, para que todo el documento cambie a la vez.

**Abrir en una ventana aparte**, en la cabecera del panel, lleva la conversación a su propia ventana, algo útil con un segundo monitor. Esa ventana te acompaña: si cambias de pestaña o de ventana, su documento, su título y su selección cambian también, y los cambios que propone llegan al archivo que estés editando en ese momento. Solo hay una por cada ventana del editor; **📌**, en su cabecera, la mantiene por encima del editor.

### 4. Pregunta rápida

Pulsa <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (o haz clic con el botón derecho > Preguntar a la IA…) para abrir una pequeña barra de chat justo debajo del párrafo en el que estás. Se coloca dentro del documento y empuja hacia abajo el texto que hay debajo en lugar de taparlo. Si había texto seleccionado al abrirla, la selección se incluye. Pregunta rápida se abre en modo **Escribir**, porque normalmente se abre sobre un fragmento para cambiarlo («acorta esto»); Revisar está a un clic en el selector de modo.

- **El atajo otra vez**: si pulsas <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> con la barra abierta, el cursor pasa a su cuadro de texto; si vuelves a pulsarlo desde ahí, la barra se cierra. <kbd>Esc</kbd> en cualquier parte de la barra también la cierra, y el cursor vuelve al documento. Si quedan cambios por revisar, la barra pregunta antes de cerrarse o de empezar una conversación nueva.
- Pregunta rápida tiene su propia conversación breve, separada de la del panel, que no se guarda en el historial. Se abre aunque el panel esté abierto. **Continuar en la conversación completa** (el botón de su esquina) pasa el intercambio al panel de IA, donde sigue y se guarda. Activa **Ajustes > Textus AI > Avanzado > Abrir las conversaciones completas en una ventana aparte** para enviarlo a una ventana aparte.

### 5. Cambios en el documento

El chat nunca escribe directamente en tu documento. Si usas un proveedor que admite llamadas a herramientas y le pides que cambie el documento, cada cambio es una propuesta que se muestra justo donde se aplicaría: el texto eliminado aparece tachado y el nuevo, insertado en verde. Nada cambia en el documento hasta que aceptas la propuesta, y <kbd>Cmd</kbd>+<kbd>Z</kbd> deshace de una vez un cambio aceptado.

- **Aceptar / Rechazar**: desde la barra flotante junto al cambio, desde la tarjeta de la propuesta en el panel o con el teclado: <kbd>Cmd</kbd>+<kbd>Return</kbd> acepta, y <kbd>Cmd</kbd>+<kbd>Delete</kbd> con el cursor sobre el cambio lo rechaza. Si una respuesta trae varias propuestas, se previsualizan a la vez; pasa de una a otra con ‹› y usa Aceptar todo / Rechazar todo.
- **Motivos**: cada tarjeta de propuesta explica por qué Textus AI propone ese cambio.
- **Solo algunas frases**: cuando una propuesta reescribe varias frases, su tarjeta ofrece **Elegir frases (N)**. Marca las que quieras y pulsa el botón de aceptar, que indica cuántas se aplicarán (por ejemplo, «Aceptar 2 de 3»).
- **En el cursor**: sin nada seleccionado, Textus AI sabe dónde está tu cursor, así que «escribe aquí una transición» inserta el texto justo ahí.
- **Comentarios en lugar de cambios**: pide una revisión («¿qué flojea aquí?») y Textus AI fija comentarios a los fragmentos sin cambiarlos. Cada tarjeta de comentario tiene **Mostrar en el documento**, que selecciona el fragmento al que se refiere.
- **Tus propias notas**: selecciona unas palabras, haz clic derecho y elige **Añadir nota**: tu nota va al margen junto a las de Textus AI, marcada como Yo. Las notas se guardan junto a los datos propios de Textus, no en tu Markdown.
- **Control de mis cambios** (menú Visualización): mientras está activado, tus propios cambios también se muestran como cambios (lo que borraste, tachado; lo que añadiste, marcado), cada uno con una tarjeta en el margen, marcada como Yo, para aceptarlo o rechazarlo.

### 6. Imágenes

Textus AI puede crear una imagen para tu documento cuando eliges un **Modelo de imagen** en **Ajustes > Textus AI**. Hasta entonces es **Ninguno**, porque cada imagen cuesta un poco en el servicio. Elige un servicio y un modelo: OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow o cualquier endpoint compatible con OpenAI. Si ya usas ese servicio para el chat, se usa su clave; si no, Ajustes te pide una.

- Pídelo en el modo Escribir («añade una imagen del puerto después del primer párrafo»), o haz clic derecho en un párrafo y elige **Ilustrar este párrafo**.
- La imagen llega como una propuesta en su sitio, como cualquier inserción. No se guarda nada hasta que aceptas: entonces se guarda como dice **Ajustes > Imágenes** para una imagen pegada y se inserta como imagen de Markdown. Rechazar no deja nada.
- Para que una imagen propuesta se dibuje de nuevo, señálala y elige **Redibujar…**, y di qué debe cambiar; solo se vuelve a dibujar esa imagen. Las imágenes de un mismo texto mantienen las mismas personas y el mismo estilo: alguien que vuelve a aparecer se describe con las mismas palabras y, cuando el modelo de imagen acepta una imagen de partida, una imagen nueva de esa persona parte de una anterior.
- Si el servicio rechaza la descripción, el panel muestra el motivo que dio. Cada petición crea como mucho dos imágenes.

### 7. Búsqueda web

Activa el botón **Búsqueda web** junto al campo de texto (o **Ajustes > Textus AI > Chat de Textus AI > Búsqueda web** para que empiece activado) y Textus AI buscará en la web cuando una petición necesite datos actuales o de los que no esté seguro. También puede leer una página cuya dirección pegues.

- **Quién busca**: los modelos que buscan por sí mismos —OpenAI, Claude, Grok, OpenRouter, Groq, Qwen y Zhipu GLM— usan su propia búsqueda. Con cualquier otro modelo (DeepSeek, Gemini, Mistral, Kimi, modelos locales, endpoints personalizados) busca Textus, con el **Servicio de búsqueda** elegido bajo Búsqueda web en Ajustes: **Automático** usa una clave de DeepSeek, Zhipu o Kimi que ya guardaste para el chat; o elige Bocha, Tavily, Brave Search o Exa y pega su clave, o SearXNG e indica la dirección de tu propio servidor. La fila indica adónde van tus búsquedas. Si no hay con qué buscar, el botón muestra un punto rojo.
- **Fuentes**: la respuesta cita lo que encontró como [1], [2] y enumera esas páginas debajo; haz clic en una para abrirla en el navegador. Los números se mantienen durante toda la conversación.
- **Fuentes como notas al pie**: cuando una propuesta se basa en la web, su tarjeta muestra **Añadir las fuentes como notas al pie**. Si lo marcas, al aceptarla se añaden notas al pie de Markdown con sus fuentes al final del documento; sin marcar, el texto entra sin ellas. La tarjeta recuerda tu última elección.
- **Las páginas se leen, no se obedecen**: lo que dice una página nunca es una instrucción para Textus AI, que sigue limitándose a proponer cambios. Textus solo lee páginas de la web pública, nunca de tu ordenador ni de tu red local.

## Personaliza Textus AI

Textus AI aprende sobre ti y tu trabajo a partir de unos pocos archivos Markdown normales, no de ajustes ocultos. Cada uno tiene una sola función:

| Concepto | Qué es | Dónde está |
| --- | --- | --- |
| **Carpeta del proyecto** | La carpeta en la que trabaja Textus AI y que puede leer | La carpeta del documento, o una que elijas |
| **Perfil de estilo** | Cómo escribes | `.textus/style.md` |
| **Biblioteca** | Datos sobre personas, lugares y términos | `.textus/library/` |
| **Instrucciones de escritura** | Normas fijas para todas las conversaciones | `agent.md`, global y por proyecto |
| **Memoria** | Lo que Textus AI guarda de tus conversaciones | `.textus/memory/`, y `memory/` en la carpeta de configuración global |
| **Habilidades** | Instrucciones reutilizables que invocas con `/nombre` | `skills/`, global y por proyecto |
| **Carpeta de configuración global** | Lo que se aplica a todos los documentos | La carpeta de ajustes de la aplicación |

En adelante, «conversaciones» se refiere al panel de IA y a Pregunta rápida. Así se ve un proyecto completo de un vistazo:

```
mi-novela/               ← la carpeta del proyecto
├── capitulo-1.md        ← el documento que estás editando
├── notas/
│   └── cronologia.md    ← material de consulta que Textus AI puede leer
└── .textus/              ← los ajustes propios del proyecto
    ├── style.md         ← perfil de estilo
    ├── agent.md         ← instrucciones de escritura de este proyecto
    ├── library/
    │   ├── lin-wan.md   ← una entrada por personaje, lugar o término
    │   └── ciudad-puerto.md
    └── skills/
        └── pulir.md     ← una habilidad por archivo
```

El menú del proyecto crea `.textus/` y sus archivos la primera vez que los pides; las habilidades del proyecto son lo único que añades a mano. El texto dentro de comentarios `<!-- -->` en cualquiera de estos archivos es una nota para ti y nunca se envía.

### La carpeta del proyecto

**La carpeta del proyecto es la carpeta en la que trabaja Textus AI.** De forma predeterminada es la carpeta del documento que estás editando (o la carpeta más cercana por encima de ella que tenga una carpeta `.textus/`, de modo que un capítulo en `novel/part-1/` pertenece a `novel/`): guarda un documento y su carpeta pasa a ser la carpeta del proyecto.

- Textus AI puede listar, encontrar por nombre, leer y buscar en sus archivos para encontrar las escenas anteriores de un personaje, un término o tus notas: archivos de texto (Markdown, texto sin formato y formatos similares) de hasta 16 MB, que lee por partes cuando son largos, y el texto de los archivos PDF, Word, PowerPoint, EPUB, RTF y de hojas de cálculo. Con un proveedor que puede ver imágenes, también mira las imágenes PNG, JPEG, GIF y WebP de la carpeta, de hasta 6 MB cada una. Se omiten los archivos y las carpetas ocultos, lo que excluye un archivo `.gitignore` o `.ignore` (como en la búsqueda de archivos de la barra lateral), las carpetas de compilación y de dependencias (como `node_modules`) y los PDF escaneados sin capa de texto.
- Escribir `@` en el cuadro de texto del chat adjunta uno de sus archivos a tu mensaje.
- Su carpeta `.textus/` guarda el perfil de estilo, la biblioteca, las instrucciones de escritura y las habilidades del proyecto.

La barra bajo la cabecera del panel de IA muestra el nombre de la carpeta del proyecto; haz clic en ella para abrir el **menú del proyecto**. Si tu material de consulta no está junto al borrador, usa **Elegir carpeta del proyecto…** en ese menú (o **Ajustes > Textus AI > Carpeta del proyecto**). La carpeta que elijas se usa para todos los documentos, incluidos los borradores sin guardar, hasta que vuelvas a elegir **Usar la carpeta del documento**.

> [!TIP]
> ¿Tu borrador está en `tesis/borradores/` y tus notas de entrevistas en `tesis/fuentes/`? Elige `tesis/` como carpeta del proyecto y Textus AI podrá leer `fuentes/entrevistas.md` mientras trabajas en `borradores/capitulo-2.md`.

Todo lo que lee Textus AI tiene que estar dentro de la carpeta del proyecto: se rechazan `..`, las rutas absolutas y los enlaces que apuntan fuera. Un borrador sin guardar no tiene carpeta del proyecto salvo que hayas elegido una, y se rechaza una carpeta demasiado amplia, como tu carpeta personal o una unidad entera.

### El perfil de estilo: «Aprender mi estilo»

**El perfil de estilo describe cómo escribes**, para que las continuaciones y los cambios suenen a ti: voz y tono, ritmo de las frases, vocabulario, puntuación y lo que nunca haces. Textus AI lo sigue en las conversaciones, y el autocompletado también mientras escribes, en todos los documentos del proyecto. Es el archivo `.textus/style.md`.

Hay dos formas de crearlo, ambas en el menú del proyecto:

- **Aprender mi estilo a partir de muestras…**: elige algunos archivos escritos por ti (hasta ocho). Textus AI los estudia, redacta un perfil (voz y tono, frases y ritmo, vocabulario, puntuación y formato, estructura, lo que nunca haces y algunas citas breves como ejemplos) y lo abre en una pestaña nueva. Léelo, corrígelo y amplíalo: es tuyo. Si vuelves a usar esta opción, el perfil anterior se conserva como `style.previous.md`.
- **Crear perfil de estilo**: empieza con un esquema vacío y escríbelo tú.

Cuando ya hay un perfil, el botón **Estilo**, junto al nombre de la carpeta, lo abre.

```markdown
# Perfil de estilo

## Frases y ritmo
- Frases cortas, rara vez de más de 15 palabras.
- Abre cada párrafo con una escena concreta y después pasa a la idea.

## Nunca
- Signos de exclamación. La expresión «de repente».
```

Los puntos concretos y comprobables funcionan mejor que los adjetivos: «frases cortas, rara vez de más de 15 palabras» en lugar de «conciso». Procura que no pase de una o dos páginas; solo se usan los primeros 6000 caracteres. El **tono del autocompletado** de Ajustes también se aplica: déjalo en *Según el documento* cuando tu perfil de estilo ya describa tu voz.

### La biblioteca

**La biblioteca guarda los datos que deben mantenerse coherentes**: un archivo Markdown por personaje, lugar o término, en `.textus/library/`. **Nueva entrada de biblioteca…**, en el menú del proyecto, pide un nombre y abre la entrada nueva; el botón **Biblioteca** muestra cuántas hay.

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

**Las instrucciones de escritura son normas fijas que se envían en cada conversación**: de qué trata el proyecto, en qué idioma responder, grafías y términos, y lo que Textus AI debe hacer siempre o no hacer nunca. Están en archivos llamados `agent.md`, en dos niveles:

- **Global**, para todos los documentos: **Ajustes > Textus AI > Instrucciones de escritura (agent.md) > Editar agent.md**.
- **Proyecto**, para los documentos de un proyecto: `.textus/agent.md`, que se abre con **Editar instrucciones de escritura del proyecto** en el menú del proyecto.

Ambos se abren en una pestaña y empiezan con una breve guía en comentarios. Cuando existen los dos, Textus AI recibe ambos (primero las instrucciones globales y después las del proyecto) y, en caso de contradicción, prevalecen las del proyecto.

```markdown
El libro es una novela de misterio ambientada en el Shanghái de los años treinta, narrada por Lin Wan en primera persona.
Responde siempre en español, aunque la novela esté en chino.
Escribe «Shanghái», nunca «Shanghai».
```

Las instrucciones de escritura solo se aplican a las conversaciones. El autocompletado no las lee: sigue el perfil de estilo y la biblioteca.

### Lo que recuerda Textus AI

**Textus AI recuerda lo que le pides y cómo escribes**, sin que tengas que escribir ningún archivo. Cuando le dices algo que debe valer más allá de una petición («escribe siempre en español de España», «nada de rayas», una corrección que tuviste que hacer dos veces) o un dato sobre tu obra, como quién es un personaje, lo guarda y lo sigue en las conversaciones siguientes. Cada vez, una línea bajo su respuesta indica qué ha recordado y dónde: **Deshacer** lo retira, y **Hacer global** o **Pasar al proyecto** lo cambia de sitio.

- **Este proyecto**: lo que trata de esta obra, en `.textus/memory/`; los datos sobre personas, lugares y términos van a la biblioteca.
- **Para todos los proyectos**: tus hábitos generales, en `memory/` dentro de la carpeta de configuración global. Sin carpeta del proyecto, todo va aquí.

La pestaña **Proyecto** del panel de IA lo muestra todo en **Memoria**, con cuándo y en qué conversación se recordó cada cosa: **Editar** lo abre y **Eliminar** lo borra. De vez en cuando, Textus AI ordena su memoria: une los recuerdos que dicen lo mismo y descarta una regla que otra más reciente ha dejado sin efecto; lo descartado está en **Olvidado hace poco**, para recuperarlo. Tus propias instrucciones de escritura prevalecen cuando ambas no coinciden, y Textus AI nunca cambia tu `agent.md` ni tu perfil de estilo. Cuando hay demasiados recuerdos para enviarlos, se omiten los más antiguos y la pestaña Proyecto lo indica. **Ajustes > Textus AI > Recordar automáticamente** lo desactiva.

**También aprende de tus decisiones de revisión.** Cuando rechazas varias veces el mismo tipo de cambio —「」 convertidas en “”, una palabra cambiada por otra, frases divididas, una coma de Oxford añadida—, Textus AI te ofrece, al terminar la revisión, recordarlo como requisito: **Recordar** lo guarda en **Memoria**, **Ahora no** espera a tener más pruebas y **No volver a preguntar** deja de preguntar por ese tipo. Pregunta como mucho una vez al día, y solo se guarda algo cuando haces clic, también con Recordar automáticamente desactivado. Lo que cuenta es una breve nota de los tipos de cambio que aceptaste o rechazaste, guardada en este ordenador junto a tus recuerdos y nunca enviada.

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

Cuando lo que pediste era un procedimiento propio, unos pasos que querrás repetir, Textus AI ofrece bajo su respuesta guardarlo como habilidad, para todos los documentos o solo para este proyecto. No se guarda nada a menos que lo elijas.

Las habilidades están en los mismos dos niveles que las instrucciones de escritura: las globales, en la carpeta `skills/` de la carpeta de configuración global (**Ajustes > Extensiones > Habilidades > … > Importar habilidad…** copia ahí un archivo de habilidad), y las del proyecto, en `.textus/skills/` (una carpeta oculta; en el Finder de macOS, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> la muestra). Una habilidad del proyecto con el mismo nombre que una global la reemplaza.

### Habilidades integradas

Textus trae cuatro habilidades. **Corregir**, en Revisar, comprueba la ortografía, la gramática, la puntuación y los números según las normas del idioma del texto. **Diseñar un tema**, **Crear un complemento** y **Crear una habilidad**, en Crear, hacen un tema para el editor, un pequeño complemento o una habilidad propia a partir de lo que describas. Hay más habilidades —ampliar, condensar, traducir, resumir, revisar continuidad, correo, acta de reunión y otras— en **Ajustes > Extensiones > Habilidades > Conseguir más**. Escribe `/` y elige una, o escribe su nombre en cualquiera de los idiomas de la aplicación: `/proofread`, `/校对` y `/校正` llaman a la misma habilidad. Textus AI también elige una por su cuenta cuando tu petición encaja. **Diseñar un tema** pone el CSS del tema en la respuesta: **Usar este tema**, debajo, lo instala; o guárdalo como archivo .css e impórtalo con **Ajustes > Editor y aspecto > Importar CSS…**.

Las habilidades integradas están en **Ajustes > Textus AI > Habilidades integradas** y siempre están activas. **Personalizar…** copia una en la carpeta `skills/` de la carpeta de configuración global y abre la copia para que cambies sus instrucciones; a partir de entonces se usa tu copia. **Restablecer** borra la copia y recupera la versión integrada. **Ajustes > Extensiones > Habilidades** muestra las habilidades que añadiste. Cada una indica los modos en que funciona (haz clic para cambiarlos), y su interruptor la desactiva por ahora; sus modos se guardan para cuando la vuelvas a activar. Una habilidad tuya con el nombre de una integrada la reemplaza.

### Normas de escritura

**Ajustes > Textus AI > Asistencia de escritura > Normas de escritura** decide qué normas de puntuación, espacios y números siguen Textus AI y la revisión gramatical. **Automático** aplica la norma nacional cuando el idioma la tiene (GB/T para el chino simplificado o JTF para el japonés, por ejemplo); en los demás casos sigue lo que tu documento ya hace con más frecuencia y solo señala las incoherencias. Si eliges un perfil, como **España** o **Ficción** en chino simplificado, los documentos en ese idioma se revisan según él.

Un proyecto puede elegir el suyo: añade una línea `conventions:` entre las dos líneas `---` del principio de su perfil de estilo (`.textus/style.md`). En los documentos de ese proyecto, prevalece sobre el ajuste.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### La carpeta de configuración global

**La carpeta de configuración global guarda lo que se aplica a todos los documentos**: tu `agent.md` global y tus habilidades globales. Pertenece a la aplicación, no a un proyecto; **Ajustes > Textus AI > Carpeta de configuración global > Mostrar** la muestra.

```
agent/                ← la carpeta de configuración global
├── agent.md          ← instrucciones de escritura globales
└── skills/
    └── esquema.md    ← una habilidad global
```

No hay perfil de estilo ni biblioteca globales: describen una obra concreta, así que pertenecen a un proyecto.

### Qué se aplica y cuándo

| | Conversaciones | Autocompletado | Revisión gramatical |
| --- | :---: | :---: | :---: |
| Archivos del proyecto (leer, buscar, `@`) | ✓ | | |
| Perfil de estilo | ✓ | ✓ | |
| Entradas de la biblioteca mencionadas | ✓ | ✓ | |
| Instrucciones de escritura | ✓ | | |
| Lo que recuerda Textus AI | ✓ | | |
| Habilidades | ✓ | | |
| Tono del autocompletado (Ajustes) | | ✓ | |

- **Primero lo global, después el proyecto.** Se envían las instrucciones de escritura de los dos niveles, las del proyecto al final, y las del proyecto prevalecen si hay un conflicto. Una habilidad del proyecto reemplaza a una global con el mismo nombre.
- **Una sola carpeta del proyecto a la vez.** Solo cuenta su `.textus/`: si eliges otra carpeta del proyecto, no se lee el `.textus/` que haya junto al documento.
- **Sin reiniciar.** Edita cualquiera de estos archivos y la siguiente petición usará la versión nueva (el autocompletado, en unos diez segundos).

### ¿Qué archivo para qué?

- Cómo debe sonar tu texto → el **perfil de estilo**.
- Quién es quién y qué es qué → la **biblioteca**.
- Lo que Textus AI debe saber o hacer siempre en una conversación → las **instrucciones de escritura**.
- Una tarea que pides una y otra vez → una **habilidad**.
- Notas, documentación, capítulos anteriores → archivos normales en la **carpeta del proyecto**; Textus AI los lee cuando una petición lo requiere.

## Desactivar Textus AI

Haz clic derecho en el botón **Textus AI** del extremo derecho de la barra de la ventana para pausar Textus AI una hora o desactivarla. Mientras está desactivada, la pluma aparece tachada, y un clic en él ofrece volver a activarla; una pausa termina sola al cabo de la hora. **Ajustes > Textus AI > Activar Textus AI** y un atajo que puedes asignar en **Ajustes > Atajos de teclado** también la activan o desactivan; en el iPhone está en el menú.

Mientras está desactivada, no se envía nada a ningún servicio de IA desde que se abre Textus: ni completado, ni revisión gramatical, ni conversación, ni nada que recordar. El panel de IA, la pregunta rápida y las opciones de IA del menú contextual desaparecen, y una respuesta que se estaba escribiendo se detiene. Las ediciones ya propuestas en el documento se quedan para que las aceptes o rechaces. Cada función conserva su propio ajuste, y todas vuelven a aplicarse en cuanto Textus AI está activada de nuevo.

## Una nota sobre la privacidad

Tu documento, los archivos adjuntos y mencionados con @, tus instrucciones de escritura, el perfil de estilo, las entradas de la biblioteca mencionadas y los archivos del proyecto que lea Textus AI se envían al proveedor seleccionado como parte de cada petición; **Aprender mi estilo** envía las muestras que elijas. Con la búsqueda web activada, las búsquedas van a tu proveedor o al servicio de búsqueda que muestran los Ajustes, y las páginas que lee Textus AI se descargan desde este ordenador. Desactiva cualquier función en Ajustes cuando no quieras que eso ocurra.
