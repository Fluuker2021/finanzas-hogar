# Finanzas del Hogar — guía de instalación

App web privada para ti y tu esposa. Los datos viven en **tu propio proyecto de Firebase** y solo las dos cuentas que tú definas pueden leerlos o escribirlos. Costo: S/ 0 (plan gratuito Spark de Firebase + GitHub Pages).

Archivos del paquete:

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app completa |
| `firestore.rules` | Reglas de seguridad: solo los 2 correos autorizados |
| `manifest.webmanifest`, `icon-*.png` | Ícono y nombre al agregarla a la pantalla de inicio |

---

## 1. Crear el proyecto en Firebase (≈10 min)

1. Entra a https://console.firebase.google.com con tu cuenta de Google → **Crear un proyecto** → nombre `finanzas-hogar`. Google Analytics: **desactivado**.
2. **Compilación → Authentication → Comenzar** → pestaña *Método de acceso* → habilita **Correo electrónico/contraseña** (solo la primera opción).
3. Pestaña **Usuarios → Agregar usuario**: crea tu cuenta (correo + contraseña) y luego la de tu esposa. No hay registro público: solo existen las cuentas que tú creas aquí.
4. **Compilación → Firestore Database → Crear base de datos** → ubicación `southamerica-east1 (São Paulo)` (la más cercana a Lima) → **modo de producción**.
5. En Firestore, pestaña **Reglas**: borra todo, pega el contenido de `firestore.rules`, **reemplaza los dos correos** por los reales y pulsa **Publicar**.

## 2. Conectar la app con tu proyecto

1. En Firebase: ⚙️ **Configuración del proyecto → General → Tus apps → ícono Web `</>`** → apodo `finanzas` → *Registrar app* (sin Firebase Hosting).
2. Copia el bloque `firebaseConfig` que aparece.
3. Abre `index.html` con un editor de texto (Bloc de notas, VS Code) y en la sección **CONFIGURACIÓN** al inicio del `<script>`:
   - Reemplaza `firebaseConfig` por el tuyo.
   - En `NOMBRES` pon los mismos dos correos con el nombre que quieres ver en cada registro.

> La `apiKey` de Firebase no es una contraseña: identifica al proyecto. La protección real son las reglas de Firestore del paso 1.5.

## 3. Publicar gratis en GitHub Pages (≈5 min)

1. En https://github.com → **New repository** → nombre `finanzas-hogar` → *Public* → Create.
2. **Add file → Upload files** → sube los 6 archivos (`index.html` ya editado, `firestore.rules`, `manifest.webmanifest`, los 3 íconos) → *Commit*.
3. **Settings → Pages** → *Source: Deploy from a branch* → rama `main`, carpeta `/ (root)` → Save.
4. En 1–2 minutos tu app estará en `https://TU_USUARIO.github.io/finanzas-hogar/`.
5. En Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TU_USUARIO.github.io`.

El repositorio solo contiene el código; ningún gasto ni ingreso se guarda en GitHub.

## 4. Instalar en los dos iPhone

1. Abre la URL en **Safari** → botón Compartir → **Agregar a pantalla de inicio**.
2. Abre la app desde el ícono **Finanzas** e inicia sesión (la app de inicio guarda su propia sesión, separada de Safari).
3. Primero agrega tus tarjetas: toca **Agrega tu primera tarjeta** en la sección *Tarjetas y cuentas*.

---

## Cómo funcionan las tarjetas

| Tipo | Qué ingresas al crearla | Qué muestra |
|---|---|---|
| Crédito | Línea de crédito y deuda actual | **Disponible** = línea − deuda, barra de uso |
| Débito / cuenta | Saldo actual | **Saldo** actualizado |

| Movimiento | Efecto |
|---|---|
| Gasto con tarjeta de crédito | Sube la deuda, baja el disponible. Cuenta como gasto del mes. |
| Gasto con débito | Baja el saldo de la cuenta. Cuenta como gasto del mes. |
| Ingreso a una cuenta | Sube el saldo de la cuenta. Cuenta como ingreso del mes. |
| **Pago tarjeta** (desde efectivo o débito) | Baja la deuda de la tarjeta (y el saldo de la cuenta origen). **No** cuenta como gasto, para no duplicar: el gasto ya se contó al comprar. |

- Si el saldo de una tarjeta no cuadra con tu estado de cuenta, tócala y corrige la deuda o el saldo actual. Eso ajusta el valor sin tocar tus movimientos.
- Editar o eliminar un movimiento recalcula automáticamente el saldo de las tarjetas involucradas.
- La app recuerda el último medio de pago usado para que registrar un gasto sea más rápido.
- Funciona sin señal: los registros se guardan en el teléfono y se sincronizan al volver la conexión.

## Límites del plan gratuito

Firestore Spark: 50 000 lecturas y 20 000 escrituras por día y 1 GiB de almacenamiento. Un hogar usa una fracción mínima de eso.
