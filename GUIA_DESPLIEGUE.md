# Guía de despliegue — Agenda de Trabajo (multiusuario, con roles)

Esta es la nueva versión de tu agenda: ahora es una sola app web (funciona igual en
computadora, Android y iPhone) donde tú ves y asignas tareas a todo tu personal,
puedes dar acceso de "jefe de área" a quien tú elijas, y cada quien recibe una
notificación push (como WhatsApp) cuando le asignas algo.

Reemplaza por completo a la versión anterior (la de PythonAnywhere/escritorio).

## Cómo está armado

- **Firebase Authentication**: cada persona entra con su correo y contraseña. Las
  cuentas las creas tú (no hay registro público), así que no puede entrar nadie
  que tú no hayas agregado.
- **Firestore**: la base de datos. Las reglas de seguridad (`firestore.rules`) son
  las que de verdad controlan quién puede ver o cambiar qué — no es solo que la
  app "no muestre" el botón de editar, es que el servidor lo rechaza aunque
  alguien intente saltárselo.
- **Cloud Functions**: un pequeño programa que corre solo en la nube de Google, y
  que se dispara cada vez que creas o reasignas una tarea, para mandar el push.
  Esto es lo único que requiere el plan de pago Blaze.
- **Hosting**: la app es un sitio estático (puro HTML/JS), así que se puede
  publicar gratis en GitHub Pages, igual que hiciste con la app de finanzas.

## Antes de empezar

- Necesitas una cuenta de Google (puede ser la misma que usas para todo).
- Necesitas una **tarjeta de crédito o débito** para activar el plan **Blaze**
  (pago por uso) de Firebase. Esto es obligatorio para que las notificaciones
  push funcionen — ya lo conversamos y elegiste esta opción porque querías push
  de verdad, como WhatsApp. Con el uso de un equipo pequeño (unas pocas decenas
  de tareas y notificaciones al día) te vas a quedar dentro de la capa gratuita
  de Blaze casi seguro, así que lo normal es que el cobro sea 0 o unos
  centavos al mes — pero technically queda abierta la posibilidad de que
  Google te cobre si el uso crece mucho, así que de cuando en cuando conviene
  revisar el estado de facturación en la consola de Firebase.
- Necesitas instalar **Node.js** en tu computadora — lo necesitas para el Paso 4
  (las Cloud Functions). No te preocupes si nunca lo has usado: el Paso 4 te
  explica exactamente cómo instalarlo y qué escribir, con capturas en palabras
  de cada cosa que vas a ver en pantalla (estás en Windows, así que todo lo que
  sigue está pensado para eso).

## Paso 1 — Crear el proyecto en Firebase

1. Entra a [console.firebase.google.com](https://console.firebase.google.com) con
   tu cuenta de Google.
2. "Agregar proyecto" → ponle un nombre (por ejemplo `agenda-trabajo`) → puedes
   desactivar Google Analytics, no lo necesitas → "Crear proyecto".
3. En el menú de la izquierda, abajo, haz clic en el plan actual ("Spark") y
   cambia a **Blaze**. Te va a pedir la tarjeta. Puedes poner un presupuesto de
   alerta (por ejemplo $5) para que te avisen por correo si algo se sale de lo
   normal.

## Paso 2 — Habilitar Authentication

1. Menú izquierdo → **Build → Authentication** → "Comenzar".
2. Pestaña "Sign-in method" → habilita **Correo electrónico/contraseña**
   (el primer interruptor, no el de enlace).
3. Pestaña "Users" → **"Add user"** → crea **tu propia cuenta primero** (la tuya,
   el "administrador general" / owner): tu correo y una contraseña. Apunta el
   **User UID** que te muestra la tabla (es un código largo) — lo vas a
   necesitar en el siguiente paso.
4. Repite "Add user" por cada persona de tu equipo que vaya a usar la app
   (puedes hacerlo ahora o más adelante, uno por uno). Anota el UID de cada
   quien.

## Paso 3 — Habilitar Firestore y publicar las reglas de seguridad

1. Menú izquierdo → **Build → Firestore Database** → "Crear base de datos" →
   modo **producción** → elige una región (cualquiera cercana a Perú, por
   ejemplo `southamerica-east1`) → "Habilitar".
2. Pestaña **"Reglas"** dentro de Firestore → borra lo que haya y pega el
   contenido completo del archivo `firestore.rules` de esta carpeta → "Publicar".
3. **Paso manual único y obligatorio — crear tu propio perfil (bootstrap):**
   las reglas que acabas de publicar exigen que ya exista un "owner" antes de
   que cualquiera pueda crear usuarios desde la app — así que la primerísima
   cuenta (la tuya) hay que crearla a mano, una sola vez:
   - Pestaña **"Datos"** de Firestore → "Iniciar colección" → ID de colección:
     `usuarios` → "Siguiente".
   - **ID del documento**: pega el UID que apuntaste en el paso 2 (tu propio UID).
   - Agrega estos campos (botón "Agregar campo"):
     - `nombre` (string) → tu nombre
     - `email` (string) → tu correo
     - `rol` (string) → `owner`
     - `gestionados` (array) → déjalo vacío
     - `activo` (boolean) → `true`
   - "Guardar".

   De aquí en adelante, para agregar al resto del personal **ya no hace falta
   tocar Firestore a mano**: lo haces desde la pestaña "Administración" dentro
   de la propia app, una vez que hayas iniciado sesión como owner (ver Paso 8).

## Paso 4 — Desplegar las Cloud Functions (el push)

Este es el único paso que no se hace con clics, sino escribiendo unos comandos
en una ventana llamada **terminal** (en Windows se llama PowerShell). No hace
falta que sepas programación: vas a ir copiando y pegando cada línea, una por
una, y revisando que el resultado se parezca a lo que te describo. Tómate tu
tiempo, no hay forma de "romper" nada por equivocarte aquí — si algo sale mal,
simplemente se queda igual que estaba y lo reintentas.

### 4.1 — Instalar Node.js (si no lo tienes)

1. Abre tu navegador y ve a **[nodejs.org](https://nodejs.org)**.
2. Vas a ver dos botones de descarga — elige el que diga **"LTS"** (es la
   versión recomendada, no la más nueva).
3. Abre el archivo descargado (algo como `node-v20...-x64.msi`) y dale
   "Siguiente" a todo con las opciones que vienen marcadas por defecto, hasta
   terminar la instalación. Si te pide reiniciar la computadora, hazlo.

### 4.2 — Abrir PowerShell

1. Haz clic en el botón **Inicio** de Windows (la banderita, abajo a la
   izquierda).
2. Escribe `PowerShell` (sin más, directo con el teclado).
3. Haz clic en **"Windows PowerShell"** cuando aparezca en los resultados.
4. Se va a abrir una ventana azul con texto — ahí es donde vas a escribir o
   pegar todo lo que sigue. Para **pegar** en esta ventana: clic derecho
   dentro de ella (no hay botón de pegar ni Ctrl+V en versiones viejas de
   PowerShell, pero clic derecho casi siempre funciona).

### 4.3 — Revisar que Node quedó instalado

Escribe esto y presiona Enter:

```
node -v
```

Debería responder algo como `v20.11.0` (el número exacto no importa). Si en
vez de eso dice algo como *"node no se reconoce como un comando..."*, cierra
esta ventana de PowerShell, ábrela de nuevo (Paso 4.2) e inténtalo otra vez —
a veces Windows necesita que abras una ventana nueva para "enterarse" de que
Node ya está instalado.

### 4.4 — Instalar las herramientas de Firebase

Pega esto y Enter:

```
npm install -g firebase-tools
```

Va a tardar 1 o 2 minutos mostrando texto que corre solo — es normal, espera a
que vuelva a aparecer el cursor parpadeando solo.

**Si te sale un error en rojo que menciona "no se puede cargar... porque la
ejecución de scripts está deshabilitada en este sistema" (execution policy):**
esto es un permiso de seguridad de Windows, se arregla una sola vez:
1. Cierra esta ventana. Vuelve a abrir PowerShell, pero esta vez haciendo
   **clic derecho** sobre "Windows PowerShell" → **"Ejecutar como
   administrador"** → acepta el aviso que te salga.
2. Pega: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y Enter.
3. Te va a preguntar si confirmas — escribe `S` (o `Y`) y Enter.
4. Cierra esa ventana de administrador y vuelve a abrir PowerShell normal
   (Paso 4.2) para seguir con el resto de los pasos.

### 4.5 — Iniciar sesión en Firebase

```
firebase login
```

Se va a abrir tu navegador pidiéndote iniciar sesión — usa la **misma cuenta
de Google** con la que creaste el proyecto en el Paso 1. Acepta los permisos.
Cuando termine, vuelve a la ventana de PowerShell: debería decir algo como
`✔ Success! Logged in as tucorreo@gmail.com`.

### 4.6 — Entrar a la carpeta del proyecto

Primero necesitas la ubicación exacta de la carpeta `agenda-firebase` que
descomprimiste del zip que te mandé:
1. Abre el **Explorador de archivos** y navega hasta esa carpeta (ábrela, debe
   mostrar `index.html`, `app.js`, `firebase.json`, etc. adentro).
2. Haz clic una vez sobre la barra de direcciones de arriba (donde se ve la
   ruta) — se va a poner en modo texto y seleccionar todo. Cópialo
   (Ctrl+C).
3. En PowerShell, escribe `cd "` (con la comilla), pega la ruta (clic derecho),
   y cierra con otra comilla `"`. Por ejemplo:
   ```
   cd "C:\Users\Anthony\Downloads\agenda-firebase\agenda-firebase"
   ```
   (tu ruta real va a ser distinta — es la que copiaste). Enter.
4. Para comprobar que estás en el lugar correcto, escribe `dir` y Enter —
   deberías ver listados `index.html`, `app.js`, `firebase.json`, la carpeta
   `functions`, etc.

### 4.7 — Instalar lo que necesitan las Cloud Functions

```
cd functions
npm install
cd ..
```

(el primer `cd functions` entra a esa subcarpeta, `npm install` descarga lo
que ese código necesita — tarda otro minuto o dos — y `cd ..` te regresa a la
carpeta principal del proyecto).

### 4.8 — Conectar esta carpeta con tu proyecto de Firebase

```
firebase use --add
```

Te va a mostrar una lista de tus proyectos de Firebase — usa las flechas del
teclado (↑ ↓) para elegir el que creaste en el Paso 1 (ej. `agenda-trabajo`) y
Enter. Luego te pregunta un "alias": escribe `default` y Enter.

### 4.9 — Desplegar

```
firebase deploy --only firestore:rules,functions
```

Esta es la parte que de verdad publica las reglas y activa el push. La
primera vez puede tardar varios minutos (Google está preparando todo del lado
de ellos) — vas a ver bastante texto pasar, es normal. Si en algún momento te
pregunta algo con "(y/N)", normalmente la respuesta es `y` y Enter.

Si todo sale bien, al final vas a ver algo como:
```
✔  functions[alCrearTarea(us-central1)] Successful create operation.
✔  functions[alReasignarTarea(us-central1)] Successful create operation.
✔  Deploy complete!
```
Eso significa que ya quedó funcionando: de ahora en adelante, cada vez que se
cree o reasigne una tarea, la notificación push va a salir sola.

**Si en vez de eso te pide "habilitar" alguna API de Google Cloud** (por
ejemplo Cloud Build o Artifact Registry) con un enlace: ábrelo, haz clic en
"Habilitar" en esa página, espera medio minuto y vuelve a correr el mismo
comando `firebase deploy --only firestore:rules,functions` de nuevo — es
normal que la primera vez pida esto.

Una vez que termine este paso, ya no vas a necesitar volver a abrir PowerShell
para nada del uso normal de la app — solo si en el futuro cambias el código de
las funciones (algo que yo te ayudaría a hacer).

## Paso 5 — Activar Cloud Messaging (push) y conseguir la clave VAPID

1. Consola de Firebase → ⚙️ (ícono de engranaje) → **"Configuración del
   proyecto"** → pestaña **"Cloud Messaging"**.
2. Baja hasta **"Web Push certificates"** → "Generate key pair". Te va a dar una
   clave larga — cópiala, la vas a pegar en el Paso 6.

## Paso 6 — Completar la configuración de la app

1. Sigue en "Configuración del proyecto", pestaña **General** → baja hasta
   "Tus apps" → ícono **`</>`** (Web) → ponle un apodo (ej. "Agenda web") → NO
   marques "Firebase Hosting" → "Registrar app". Te va a mostrar un bloque
   `firebaseConfig = {...}`.
2. Abre `index.html` de esta carpeta con cualquier editor de texto y busca el
   bloque que dice:
   ```
   /* ===================== CONFIGURACIÓN (edita esto) =====================
   ```
   Reemplaza los valores `"PEGAR_AQUI"` del objeto `firebaseConfig` con los que
   te dio Firebase, y `VAPID_KEY` con la clave del Paso 5. Guarda el archivo.

## Paso 7 — Publicar la app (GitHub Pages)

Igual que hiciste con la app de finanzas:

1. Crea un repositorio nuevo en GitHub (puede ser privado o público — si es
   privado, GitHub Pages solo funciona en planes pagos de GitHub; si no estás
   seguro, hazlo público, de todas formas nadie puede leer tus datos sin una
   cuenta que tú hayas creado).
2. Sube **todos los archivos de esta carpeta** `agenda-firebase` (incluyendo
   `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, los `.png`) a ese
   repositorio. **No hace falta subir** la carpeta `functions/` ni los archivos
   `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc`
   (esos ya cumplieron su función en el Paso 3-4; no molesta si los subes
   igual, pero no son necesarios para que la web funcione).
3. En el repositorio: **Settings → Pages** → "Source": rama `main`, carpeta `/
   (root)` → "Save".
4. Espera 1-2 minutos y entra a la URL que te muestra (algo como
   `https://tuusuario.github.io/tu-repo/`). Ahí ya debería aparecer la pantalla
   de inicio de sesión de la Agenda.

## Paso 8 — Entrar por primera vez y agregar a tu equipo

1. Abre la URL de GitHub Pages y entra con tu correo y la contraseña que
   creaste en el Paso 2 (tu cuenta de owner).
2. Ve a la pestaña **"Administración"**. Por cada persona de tu equipo que ya
   creaste en Authentication (Paso 2):
   - Entra a Firebase Console → Authentication → Users, copia su **UID**.
   - En "Administración" de la app, pégalo junto con su nombre, correo y rol
     (Personal / Jefe de área / Administrador general) → "Agregar".
3. Si alguien es "Jefe de área", en la misma tabla, en la columna "Gestiona a",
   usa el desplegable para elegir a qué personal va a poder administrar. Esa
   persona, al entrar, va a poder asignar y modificar tareas de quienes tú le
   asignaste, pero no de nadie más.
4. Para agregar a alguien que todavía no tiene cuenta: créala primero en
   Authentication (Paso 2) y luego repite el punto 2 de aquí.

## Paso 9 — Instalar la app en el celular y la computadora

- **Android (Chrome)**: abre la URL → menú (⋮) → "Agregar a pantalla de
  inicio" / "Instalar app".
- **iPhone (Safari, obligatorio que sea Safari)**: abre la URL → botón de
  compartir (el cuadradito con la flecha) → "Agregar a pantalla de inicio".
  Las notificaciones push en iPhone solo funcionan si la app está instalada
  así (no funcionan si solo la tienes abierta en una pestaña del navegador).
- **Computadora (Chrome/Edge)**: abre la URL → ícono de instalar en la barra de
  direcciones (o menú ⋮ → "Instalar Agenda de Trabajo…").

La primera vez que cada persona entra, el navegador le va a preguntar si
permite las notificaciones — tiene que aceptar para recibir el push real; si
dice que no, la campanita dentro de la app le sigue avisando igual, solo que
sin el aviso tipo WhatsApp.

## Paso 10 — Migrar las tareas de tu agenda anterior

En "Administración" hay una caja **"Importar tareas"**. Ahí puedes pegar filas
en formato CSV (una tarea por línea) con estas columnas:

```
proyecto,titulo,responsable_correo,prioridad,fecha_limite,notas
Antamina,Revisar informe de voladura,pedro@tuempresa.com,alta,2026-11-05,
```

- `responsable_correo` tiene que ser el correo de alguien que ya hayas
  agregado en "Administración".
- `prioridad` es `alta`, `media` o `baja` (si se deja vacío o mal escrito, se
  pone `media`).
- `fecha_limite` va como `AAAA-MM-DD`, o vacío si no tiene fecha.
- `notas` es opcional.

Si tienes muchas tareas en tu agenda anterior y te gustaría no tener que
copiarlas una por una a mano, puedes pedirme que te arme ese CSV a partir de
tu archivo `agenda.db` — solo tendrías que volver a subírmelo en un próximo
mensaje (en esta sesión ya no lo tengo disponible). Como normalmente solo
importan las tareas **pendientes** (las completadas ya se borran en el sistema
anterior tal cual se borran en este), probablemente sea una lista corta y
también es totalmente razonable simplemente volver a escribirlas con "Nueva
tarea".

## Costos esperados

Con Blaze, Firebase cobra solo lo que pasa la capa gratuita mensual, que para
un equipo pequeño (digamos hasta ~20 personas, unas pocas tareas/notificaciones
por persona al día) normalmente no se llega a tocar:
Authentication (gratis siempre para este uso), Firestore (50,000 lecturas y
20,000 escrituras gratis **por día**), Cloud Functions (2 millones de
invocaciones gratis al mes) y Cloud Messaging (gratis, sin límite). Lo más
probable es que tu factura diga **$0** la mayoría de los meses. Aun así, es
buena costumbre revisar una vez al mes "Uso y facturación" en la consola de
Firebase.

## Problemas comunes

- **"Tu cuenta todavía no está configurada en la app"**: la cuenta de
  Authentication existe pero falta su perfil en "Administración" (o, si eres
  tú como primer owner, falta el documento manual del Paso 3).
- **No llega la notificación push, pero sí aparece en la campanita**: revisa
  que el navegador tenga permiso de notificaciones para el sitio (candado en
  la barra de direcciones), y que la app esté instalada (no solo abierta en
  una pestaña) si es iPhone.
- **"No se pudo guardar (¿permisos?)"** al crear o editar algo: casi siempre es
  que la persona está intentando algo fuera de su alcance (ej. un jefe de área
  asignando una tarea a alguien que no gestiona) — es la regla de seguridad
  funcionando como debe.
- Para revisar errores más a fondo, en Firebase Console → Functions puedes ver
  los registros ("Logs") de cada vez que se disparó una notificación.
