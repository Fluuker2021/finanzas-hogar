// Lógica de Agenda de Trabajo (multiusuario, con roles). Usa lo expuesto en
// window.__fb por el <script> de configuración en index.html.
const {
  app, auth, db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, writeBatch, onSnapshot, query, where, orderBy, serverTimestamp, limit,
  firebaseConfig, VAPID_KEY,
} = window.__fb;

import {
  signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging, getToken, onMessage, isSupported as mensajeriaSoportada,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const pad = (n) => String(n).padStart(2, "0");
const hoyStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sumarDias = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fechaLegible = (iso) => { if (!iso) return "Sin fecha"; const d = new Date(iso + "T00:00:00"); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fechaLarga = (d = new Date()) => `${DIAS_ES[(d.getDay() + 6) % 7].replace(/^./, (c) => c.toUpperCase())}, ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iniciales = (nombre) => (nombre || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");

// CSV sencillo (soporta campos entre comillas con comas/comillas escapadas)
// usado por la importación de tareas en la Administración.
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = "", entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') { entreComillas = false; }
      else campo += c;
    } else if (c === '"') { entreComillas = true; }
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = ""; filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => !(f.length === 1 && f[0].trim() === ""));
}

function flash(texto, tipo = "success") {
  const cont = $("mensajes");
  const el = document.createElement("div");
  el.className = `mensaje ${tipo}`;
  el.textContent = texto;
  cont.appendChild(el);
  setTimeout(() => { el.classList.add("oculto"); setTimeout(() => el.remove(), 400); }, 3200);
}

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
let miUid = null;
let miPerfil = null; // {nombre, email, rol, gestionados, telefono, activo}
let usuariosCache = new Map(); // uid -> {id, ...datos}
let vistaActual = "hoy";
const unsubs = {}; // listeners activos por vista, para apagarlos al cambiar

function soyOwner() { return miPerfil?.rol === "owner"; }
function soyAdmin() { return miPerfil?.rol === "admin"; }
function puedoAdministrar() { return soyOwner() || soyAdmin(); }

// uids que puedo ver/gestionar como responsables (incluye el mío propio)
function misUidsEnAlcance() {
  if (soyOwner()) return [...usuariosCache.keys()];
  if (soyAdmin()) return [miUid, ...(miPerfil.gestionados || [])];
  return [miUid];
}

function apagarListener(clave) { if (unsubs[clave]) { unsubs[clave](); delete unsubs[clave]; } }
function apagarTodosMenos(clave) { Object.keys(unsubs).forEach((k) => { if (k !== clave) apagarListener(k); }); }

// ---------------------------------------------------------------------
// Login / sesión
// ---------------------------------------------------------------------
setPersistence(auth, browserLocalPersistence).catch(() => {});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("lErr").textContent = "";
  $("lBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("lEmail").value.trim(), $("lPass").value);
  } catch (err) {
    $("lErr").textContent = /invalid|wrong|not-found|credential/.test(err.code || "")
      ? "Correo o contraseña incorrectos."
      : "No se pudo iniciar sesión. Revisa tu conexión.";
  } finally {
    $("lBtn").disabled = false;
  }
});

$("btnAvatar").addEventListener("click", async () => {
  if (confirm("¿Cerrar sesión?")) await signOut(auth);
});

auth.onAuthStateChanged(async (u) => {
  miUid = u ? u.uid : null;
  apagarTodosMenos(null);
  // Si alguien cierra sesión y otra persona entra en el mismo dispositivo,
  // que no quede nada de la sesión anterior dando vueltas en los modales.
  $("modalTarea").classList.remove("visible");
  $("modalDia").classList.remove("visible");
  $("modalEliminarSerie").classList.remove("visible");
  $("modalDiaLista").innerHTML = "";
  $("menuLista").classList.remove("visible");
  $("btnMenu").classList.remove("abierto");
  if (!u) {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    return;
  }
  // Si el documento usuarios/{uid} todavía no existe, las reglas de
  // seguridad niegan la lectura (no solo devuelven "no existe"), así que
  // hay que atrapar también ese error de permisos y no solo !exists().
  let snap;
  try {
    snap = await getDoc(doc(db, "usuarios", u.uid));
  } catch (e) {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    $("lErr").textContent = "Tu cuenta todavía no está configurada en la app. Pide al administrador que te agregue.";
    await signOut(auth);
    return;
  }
  if (!snap.exists()) {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    $("lErr").textContent = "Tu cuenta todavía no está configurada en la app. Pide al administrador que te agregue.";
    await signOut(auth);
    return;
  }
  miPerfil = { id: u.uid, ...snap.data() };
  if (miPerfil.activo === false) {
    $("lErr").textContent = "Tu cuenta está desactivada. Habla con el administrador.";
    await signOut(auth);
    return;
  }
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("avatarUsuario").textContent = iniciales(miPerfil.nombre);
  $("avatarUsuario").title = `${miPerfil.nombre} · ${miPerfil.email || ""}`;
  await cargarUsuarios();
  construirNav();
  iniciarNotificaciones();
  irA("hoy");
});

// ---------------------------------------------------------------------
// Caché de usuarios (para mostrar nombres y poblar selects). Las reglas
// solo dejan leer los que están en mi alcance, así que esta consulta ya
// viene naturalmente filtrada por rol.
// ---------------------------------------------------------------------
async function cargarUsuarios() {
  usuariosCache.clear();
  usuariosCache.set(miUid, miPerfil);
  if (soyOwner()) {
    const snap = await getDocs(collection(db, "usuarios"));
    snap.forEach((d) => usuariosCache.set(d.id, { id: d.id, ...d.data() }));
  } else if (soyAdmin()) {
    for (const uid of miPerfil.gestionados || []) {
      const s = await getDoc(doc(db, "usuarios", uid));
      if (s.exists()) usuariosCache.set(uid, { id: uid, ...s.data() });
    }
  }
}
function nombreDe(uid) { return usuariosCache.get(uid)?.nombre || "—"; }

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------
let pestañasDisponibles = [["hoy", "Hoy"]];

function construirNav() {
  const tabs = [["hoy", "Hoy"]];
  if (puedoAdministrar()) {
    tabs.push(["todas", "Todas las tareas"], ["calendario", "Calendario"], ["equipo", "Equipo"]);
  }
  if (soyOwner()) tabs.push(["admin", "Administración"]);
  pestañasDisponibles = tabs;
  $("menuLista").innerHTML = tabs.map(([id, t]) => `<button type="button" data-vista="${id}">${t}</button>`).join("");
  $("menuLista").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    irA(b.dataset.vista);
    cerrarMenu();
  }));
}
function marcarTabActiva() {
  $("menuLista").querySelectorAll("button").forEach((b) => b.classList.toggle("activa", b.dataset.vista === vistaActual));
  const actual = pestañasDisponibles.find(([id]) => id === vistaActual);
  $("menuActualTexto").textContent = actual ? actual[1] : "Menú";
}
function abrirMenu() { $("menuLista").classList.add("visible"); $("btnMenu").classList.add("abierto"); }
function cerrarMenu() { $("menuLista").classList.remove("visible"); $("btnMenu").classList.remove("abierto"); }
$("btnMenu").addEventListener("click", () => {
  $("menuLista").classList.contains("visible") ? cerrarMenu() : abrirMenu();
});
document.addEventListener("click", (e) => {
  if (!$("menuNav").contains(e.target)) cerrarMenu();
});
function irA(v) { vistaActual = v; marcarTabActiva(); renderizarVista(); }

function renderizarVista() {
  apagarTodosMenos(null);
  if (vistaActual === "hoy") return vistaHoy();
  if (vistaActual === "todas" && puedoAdministrar()) return vistaTodas();
  if (vistaActual === "calendario" && puedoAdministrar()) return vistaCalendario();
  if (vistaActual === "equipo" && puedoAdministrar()) return vistaEquipo();
  if (vistaActual === "admin" && soyOwner()) return vistaAdmin();
  irA("hoy");
}

window.__app = { $, flash, hoyStr, sumarDias, fechaLegible, fechaLarga, esc, nombreDe, usuariosCache,
  soyOwner, soyAdmin, puedoAdministrar, misUidsEnAlcance, miUid, getMiPerfil: () => miPerfil,
  apagarListener, unsubs };

// ---------------------------------------------------------------------
// Tarjeta de tarea (HTML) + acciones comunes
// ---------------------------------------------------------------------
function puedoAdministrarTarea(t) {
  if (soyOwner()) return true;
  if (soyAdmin()) return (miPerfil.gestionados || []).includes(t.responsableUid);
  return false;
}

function tarjetaTareaHTML(t, { mostrarResponsable }) {
  const meta = [`<span class="badge">${esc(t.proyecto || "Sin proyecto")}</span>`];
  if (mostrarResponsable) meta.push(esc(nombreDe(t.responsableUid)));
  meta.push(`prioridad ${t.prioridad}`);
  meta.push(fechaLegible(t.fechaLimite));
  const admin = puedoAdministrarTarea(t);
  return `
  <div class="tarjeta-tarea prioridad-${t.prioridad}" data-id="${t.id}">
    <div class="info-tarea">
      <p class="titulo-tarea">${esc(t.titulo)}</p>
      <p class="meta-tarea">${meta.join(" · ")}</p>
      ${t.descripcion ? `<p class="descripcion-tarea">${esc(t.descripcion)}</p>` : ""}
    </div>
    <div class="acciones-tarea">
      <select class="selector-estado estado-${t.estado}" data-accion="estado" data-id="${t.id}">
        <option value="pendiente" ${t.estado === "pendiente" ? "selected" : ""}>Pendiente</option>
        <option value="en_progreso" ${t.estado === "en_progreso" ? "selected" : ""}>En progreso</option>
        <option value="completado" ${t.estado === "completado" ? "selected" : ""}>Completado</option>
      </select>
      ${admin ? `<button type="button" class="icono-accion" data-accion="editar" data-id="${t.id}" title="Editar">⚙️</button>` : ""}
      ${admin ? `<button type="button" class="icono-accion" data-accion="eliminar" data-id="${t.id}" title="Eliminar">✕</button>` : ""}
    </div>
  </div>`;
}

// delega los clics/cambios de cualquier lista de tarjetas renderizada
function conectarAccionesTareas(contenedorEl, tareasPorId) {
  contenedorEl.querySelectorAll('[data-accion="estado"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.id;
      const nuevo = sel.value;
      try {
        if (nuevo === "completado") {
          await deleteDoc(doc(db, "tareas", id));
          flash("Tarea completada.");
        } else {
          await updateDoc(doc(db, "tareas", id), { estado: nuevo, actualizadoEn: serverTimestamp() });
        }
      } catch (e) { flash("No se pudo actualizar (¿permisos?).", "error"); }
    });
  });
  contenedorEl.querySelectorAll('[data-accion="editar"]').forEach((b) => {
    b.addEventListener("click", () => abrirModalTarea(tareasPorId.get(b.dataset.id)));
  });
  contenedorEl.querySelectorAll('[data-accion="eliminar"]').forEach((b) => {
    b.addEventListener("click", async () => {
      const t = tareasPorId.get(b.dataset.id);
      if (t.loteId) {
        mostrarModalEliminarSerie(t);
        return;
      }
      if (!confirm("¿Eliminar esta tarea?")) return;
      try { await deleteDoc(doc(db, "tareas", t.id)); flash("Tarea eliminada."); }
      catch (e) { flash("No se pudo eliminar (¿permisos?).", "error"); }
    });
  });
}

function agruparPorFecha(tareas) {
  const hoy = hoyStr();
  const vencidas = [], deHoy = [], proximas = [], futuras = [], sinFecha = [];
  const limite = sumarDias(hoy, 7);
  for (const t of tareas) {
    if (!t.fechaLimite) { sinFecha.push(t); continue; }
    if (t.fechaLimite < hoy) vencidas.push(t);
    else if (t.fechaLimite === hoy) deHoy.push(t);
    else if (t.fechaLimite <= limite) proximas.push(t);
    else futuras.push(t);
  }
  const ordenar = (a) => a.sort((x, y) => (x.orden ?? 9e9) - (y.orden ?? 9e9) || (x.fechaLimite || "").localeCompare(y.fechaLimite || ""));
  return { vencidas: ordenar(vencidas), deHoy: ordenar(deHoy), proximas: ordenar(proximas), futuras: ordenar(futuras), sinFecha: ordenar(sinFecha) };
}

// ids de secciones que la persona cerró a mano — se recuerda mientras dura
// la sesión (sobrevive a los refrescos en tiempo real de onSnapshot, que si
// no, las volverían a abrir solas en cada cambio).
const seccionesColapsadas = new Set();

function seccionHTML(id, titulo, emoji, lista, mostrarResponsable) {
  if (lista.length === 0) return "";
  const cerrada = seccionesColapsadas.has(id);
  return `
  <div class="seccion">
    <button type="button" class="seccion-titulo" data-toggle="${id}">
      <span class="seccion-flecha${cerrada ? " cerrada" : ""}">▾</span>
      ${emoji} ${titulo} <span class="contador">(${lista.length})</span>
    </button>
    <div id="${id}" class="seccion-lista${cerrada ? " oculta" : ""}">${lista.map((t) => tarjetaTareaHTML(t, { mostrarResponsable })).join("")}</div>
  </div>`;
}

// delega el clic en los encabezados de sección para abrir/cerrar cada grupo
function conectarSecciones(contenedorEl) {
  contenedorEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggle;
      const lista = document.getElementById(id);
      const flecha = btn.querySelector(".seccion-flecha");
      if (seccionesColapsadas.has(id)) {
        seccionesColapsadas.delete(id);
        lista.classList.remove("oculta");
        flecha.classList.remove("cerrada");
      } else {
        seccionesColapsadas.add(id);
        lista.classList.add("oculta");
        flecha.classList.add("cerrada");
      }
    });
  });
}

// ---------------------------------------------------------------------
// Vista "Hoy" — mis propias tareas
// ---------------------------------------------------------------------
function vistaHoy() {
  const cont = $("vista");
  cont.innerHTML = `<h1>Tu agenda de hoy</h1><p class="subtitulo">${fechaLarga()}</p><div id="hoyResumen" class="resumen"></div><div id="hoyListas"></div>`;
  const q = query(collection(db, "tareas"), where("responsableUid", "==", miUid));
  unsubs.hoy = onSnapshot(q, (snap) => {
    const tareas = []; const porId = new Map();
    snap.forEach((d) => { const t = { id: d.id, ...d.data() }; tareas.push(t); porId.set(d.id, t); });
    const { vencidas, deHoy, proximas, futuras, sinFecha } = agruparPorFecha(tareas);
    $("hoyResumen").innerHTML = `
      <div class="chip"><strong>${vencidas.length}</strong> vencidas</div>
      <div class="chip"><strong>${deHoy.length}</strong> para hoy</div>
      <div class="chip"><strong>${tareas.length}</strong> pendientes en total</div>`;
    const html = [
      seccionHTML("secVencidas", "Vencidas", "🔴", vencidas, false),
      seccionHTML("secHoy", "Para hoy", "🟢", deHoy, false),
      seccionHTML("secProximas", "Próximos 7 días", "📅", proximas, false),
      seccionHTML("secFuturas", "Más adelante", "🗓️", futuras, false),
      seccionHTML("secSinFecha", "Sin fecha", "📋", sinFecha, false),
    ].join("");
    $("hoyListas").innerHTML = html || '<p class="vacio">No tienes tareas pendientes. 🎉</p>';
    conectarAccionesTareas($("hoyListas"), porId);
    conectarSecciones($("hoyListas"));
  });
}

// ---------------------------------------------------------------------
// Modal de tarea (crear / editar) + repetición en lote
// ---------------------------------------------------------------------
let tareaEditando = null;

function poblarSelectResponsable(uidSeleccionado) {
  const sel = $("tResponsable");
  const uids = misUidsEnAlcance();
  sel.innerHTML = uids.map((uid) =>
    `<option value="${uid}" ${uid === uidSeleccionado ? "selected" : ""}>${esc(nombreDe(uid))}${uid === miUid ? " (yo)" : ""}</option>`
  ).join("");
}

function abrirModalTarea(t) {
  tareaEditando = t || null;
  $("tErr").textContent = "";
  $("formTarea").reset();
  $("modalTareaTitulo").textContent = t ? "Editar tarea" : "Nueva tarea";
  $("tTareaId").value = t?.id || "";
  $("tProyecto").value = t?.proyecto || "";
  $("tTitulo").value = t?.titulo || "";
  poblarSelectResponsable(t?.responsableUid || miUid);
  $("tPrioridad").value = t?.prioridad || "media";
  $("tFecha").value = t?.fechaLimite || "";
  $("tNotas").value = t?.descripcion || "";
  $("tRepetir").checked = false;
  $("tRepetirHasta").style.display = "none";
  $("tRepetirHasta").value = "";
  $("campoRepetir").hidden = !!t; // repetir en lote solo tiene sentido al crear
  $("modalTarea").classList.add("visible");
  setTimeout(() => $("tTitulo").focus(), 0);
}
function cerrarModalTarea() { $("modalTarea").classList.remove("visible"); tareaEditando = null; }

$("fabNueva").addEventListener("click", () => abrirModalTarea(null));
$("btnCancelarTarea").addEventListener("click", cerrarModalTarea);
$("tRepetir").addEventListener("change", () => {
  $("tRepetirHasta").style.display = $("tRepetir").checked ? "block" : "none";
});

$("formTarea").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("tErr").textContent = "";
  const datos = {
    proyecto: $("tProyecto").value.trim(),
    titulo: $("tTitulo").value.trim(),
    responsableUid: $("tResponsable").value,
    prioridad: $("tPrioridad").value,
    fechaLimite: $("tFecha").value || null,
    descripcion: $("tNotas").value.trim(),
  };
  if (!datos.titulo) { $("tErr").textContent = "Escribe un título."; return; }
  if (!misUidsEnAlcance().includes(datos.responsableUid)) {
    $("tErr").textContent = "No puedes asignar tareas a esa persona.";
    return;
  }
  $("btnGuardarTarea").disabled = true;
  try {
    if (tareaEditando) {
      await updateDoc(doc(db, "tareas", tareaEditando.id), { ...datos, actualizadoEn: serverTimestamp() });
      flash("Tarea actualizada.");
    } else if ($("tRepetir").checked && $("tRepetirHasta").value) {
      if (!datos.fechaLimite) {
        $("tErr").textContent = "Pon una fecha de inicio para poder repetir.";
        $("btnGuardarTarea").disabled = false;
        return;
      }
      if ($("tRepetirHasta").value < datos.fechaLimite) {
        $("tErr").textContent = "La fecha final debe ser después de la fecha de inicio.";
        $("btnGuardarTarea").disabled = false;
        return;
      }
      const loteId = (crypto.randomUUID ? crypto.randomUUID() : `lote-${Date.now()}`);
      const lote = writeBatch(db);
      let f = datos.fechaLimite, n = 0;
      while (f <= $("tRepetirHasta").value && n < 180) { // tope de seguridad
        const ref = doc(collection(db, "tareas"));
        lote.set(ref, { ...datos, fechaLimite: f, loteId, estado: "pendiente", creadoPorUid: miUid, creadoEn: serverTimestamp() });
        f = sumarDias(f, 1);
        n++;
      }
      await lote.commit();
      flash(`Se crearon ${n} tareas repetidas.`);
    } else {
      await addDoc(collection(db, "tareas"), { ...datos, estado: "pendiente", creadoPorUid: miUid, creadoEn: serverTimestamp() });
      flash("Tarea creada.");
    }
    cerrarModalTarea();
  } catch (err) {
    $("tErr").textContent = "No se pudo guardar (¿permisos?).";
  } finally {
    $("btnGuardarTarea").disabled = false;
  }
});

// ---------------------------------------------------------------------
// Eliminar tarea que pertenece a una serie repetida
// ---------------------------------------------------------------------
let tareaParaEliminarSerie = null;
function mostrarModalEliminarSerie(t) {
  tareaParaEliminarSerie = t;
  $("modalEliminarSerie").classList.add("visible");
}
$("btnCancelarSerie").addEventListener("click", () => {
  $("modalEliminarSerie").classList.remove("visible");
  tareaParaEliminarSerie = null;
});
$("btnSoloEsta").addEventListener("click", async () => {
  const t = tareaParaEliminarSerie;
  $("modalEliminarSerie").classList.remove("visible");
  if (!t) return;
  try { await deleteDoc(doc(db, "tareas", t.id)); flash("Tarea eliminada."); }
  catch (e) { flash("No se pudo eliminar (¿permisos?).", "error"); }
});
$("btnTodaSerie").addEventListener("click", async () => {
  const t = tareaParaEliminarSerie;
  $("modalEliminarSerie").classList.remove("visible");
  if (!t || !t.loteId) return;
  try {
    const snap = await getDocs(query(collection(db, "tareas"), where("loteId", "==", t.loteId)));
    const lote = writeBatch(db);
    snap.forEach((d) => lote.delete(d.ref));
    await lote.commit();
    flash(`Se eliminaron ${snap.size} tareas de la serie.`);
  } catch (e) { flash("No se pudo eliminar la serie (¿permisos?).", "error"); }
});

// ---------------------------------------------------------------------
// Notificaciones push reales (como WhatsApp), por FCM. Si el navegador no
// lo soporta o la persona no da permiso, no pasa nada grave: simplemente no
// llegan avisos push, pero el resto de la app funciona igual.
// ---------------------------------------------------------------------
async function iniciarNotificaciones() {
  try {
    if (!(await mensajeriaSoportada())) return;
    if (!VAPID_KEY || VAPID_KEY === "PEGAR_AQUI") return; // todavía no configurado
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return;
    const registro = await navigator.serviceWorker.register(
      "sw.js?config=" + encodeURIComponent(JSON.stringify(firebaseConfig))
    );
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registro });
    if (token) await updateDoc(doc(db, "usuarios", miUid), { fcmTokens: arrayUnion(token) });
    onMessage(messaging, (payload) => {
      flash(payload.notification?.title || "Tienes una notificación nueva.");
    });
  } catch (e) { /* sin push real; no es grave */ }
}

// ---------------------------------------------------------------------
// Vista "Todas las tareas" — admin/owner, con filtros
// ---------------------------------------------------------------------
function vistaTodas() {
  const cont = $("vista");
  const uids = misUidsEnAlcance();
  cont.innerHTML = `
    <h1>Todas las tareas</h1>
    <p class="subtitulo">De las personas que gestionas.</p>
    <div class="filtros">
      <select id="filtroResponsable">
        <option value="">Toda tu gente</option>
        ${uids.map((u) => `<option value="${u}">${esc(nombreDe(u))}</option>`).join("")}
      </select>
      <select id="filtroEstado">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_progreso">En progreso</option>
      </select>
    </div>
    <div id="todasListas"></div>`;

  const q = soyOwner()
    ? query(collection(db, "tareas"))
    : query(collection(db, "tareas"), where("responsableUid", "in", uids));

  unsubs.todas = onSnapshot(q, (snap) => {
    const tareas = []; const porId = new Map();
    snap.forEach((d) => { const t = { id: d.id, ...d.data() }; tareas.push(t); porId.set(d.id, t); });

    const repintar = () => {
      const r = $("filtroResponsable").value, e = $("filtroEstado").value;
      let filtradas = tareas;
      if (r) filtradas = filtradas.filter((t) => t.responsableUid === r);
      if (e) filtradas = filtradas.filter((t) => t.estado === e);
      const { vencidas, deHoy, proximas, futuras, sinFecha } = agruparPorFecha(filtradas);
      const html = [
        seccionHTML("tVencidas", "Vencidas", "🔴", vencidas, true),
        seccionHTML("tHoy", "Para hoy", "🟢", deHoy, true),
        seccionHTML("tProximas", "Próximos 7 días", "📅", proximas, true),
        seccionHTML("tFuturas", "Más adelante", "🗓️", futuras, true),
        seccionHTML("tSinFecha", "Sin fecha", "📋", sinFecha, true),
      ].join("");
      $("todasListas").innerHTML = html || '<p class="vacio">No hay tareas con ese filtro.</p>';
      conectarAccionesTareas($("todasListas"), porId);
      conectarSecciones($("todasListas"));
    };
    repintar();
    $("filtroResponsable").onchange = repintar;
    $("filtroEstado").onchange = repintar;
  });
}

// ---------------------------------------------------------------------
// Vista "Calendario" — admin/owner, mes navegable + detalle por día
// ---------------------------------------------------------------------
let calAnio = null, calMes = null, calTareas = [];

function vistaCalendario() {
  const hoy = new Date();
  if (calAnio == null) { calAnio = hoy.getFullYear(); calMes = hoy.getMonth(); }
  const cont = $("vista");
  cont.innerHTML = `
    <div class="cal-cabecera">
      <h1 id="calTitulo"></h1>
      <div class="cal-nav">
        <button type="button" id="calAnt" title="Mes anterior">‹</button>
        <button type="button" id="calHoy" title="Ir a hoy">●</button>
        <button type="button" id="calSig" title="Mes siguiente">›</button>
      </div>
    </div>
    <div class="cal-grid" id="calGrid"></div>`;

  $("calAnt").addEventListener("click", () => { calMes--; if (calMes < 0) { calMes = 11; calAnio--; } dibujarCalendario(); });
  $("calSig").addEventListener("click", () => { calMes++; if (calMes > 11) { calMes = 0; calAnio++; } dibujarCalendario(); });
  $("calHoy").addEventListener("click", () => { calAnio = hoy.getFullYear(); calMes = hoy.getMonth(); dibujarCalendario(); });

  const uids = misUidsEnAlcance();
  const q = soyOwner()
    ? query(collection(db, "tareas"))
    : query(collection(db, "tareas"), where("responsableUid", "in", uids));
  unsubs.calendario = onSnapshot(q, (snap) => {
    calTareas = [];
    snap.forEach((d) => calTareas.push({ id: d.id, ...d.data() }));
    dibujarCalendario();
  });
}

function dibujarCalendario() {
  $("calTitulo").textContent = `${MESES_ES[calMes]} ${calAnio}`;
  const primerDia = new Date(calAnio, calMes, 1);
  const offsetLunes = (primerDia.getDay() + 6) % 7; // lunes = 0
  const diasEnMes = new Date(calAnio, calMes + 1, 0).getDate();
  const hoy = hoyStr();

  const porDia = new Map();
  for (const t of calTareas) {
    if (!t.fechaLimite) continue;
    if (!porDia.has(t.fechaLimite)) porDia.set(t.fechaLimite, []);
    porDia.get(t.fechaLimite).push(t);
  }

  let celdas = ["L", "M", "X", "J", "V", "S", "D"].map((d) => `<div class="cal-diasem">${d}</div>`).join("");
  for (let i = 0; i < offsetLunes; i++) celdas += `<div class="cal-celda fuera-mes"></div>`;
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const iso = `${calAnio}-${pad(calMes + 1)}-${pad(dia)}`;
    const lista = porDia.get(iso) || [];
    const mini = lista.slice(0, 3).map((t) => `<div class="cal-mini">${esc(t.titulo)}</div>`).join("");
    const extra = lista.length > 3 ? `<div class="cal-mini">+${lista.length - 3} más…</div>` : "";
    celdas += `
      <div class="cal-celda ${iso === hoy ? "es-hoy" : ""}" data-fecha="${iso}">
        <div class="cal-numero">${dia}${lista.length ? `<span class="cal-contador">${lista.length}</span>` : ""}</div>
        ${mini}${extra}
      </div>`;
  }
  $("calGrid").innerHTML = celdas;
  $("calGrid").querySelectorAll(".cal-celda[data-fecha]").forEach((el) => {
    el.addEventListener("click", () => abrirModalDia(el.dataset.fecha, porDia.get(el.dataset.fecha) || []));
  });
}

function abrirModalDia(iso, lista) {
  $("modalDiaTitulo").textContent = fechaLegible(iso);
  const porId = new Map(lista.map((t) => [t.id, t]));
  const ordenada = lista.slice().sort((a, b) => (a.orden ?? 9e9) - (b.orden ?? 9e9));
  $("modalDiaLista").innerHTML = ordenada.length
    ? ordenada.map((t) => tarjetaTareaHTML(t, { mostrarResponsable: true })).join("")
    : '<p class="vacio">Sin tareas este día.</p>';
  conectarAccionesTareas($("modalDiaLista"), porId);
  $("modalDia").classList.add("visible");
}
$("btnCerrarDia").addEventListener("click", () => $("modalDia").classList.remove("visible"));

// ---------------------------------------------------------------------
// Vista "Equipo" — KPIs de carga laboral por persona (admin/owner)
// ---------------------------------------------------------------------
function vistaEquipo() {
  const cont = $("vista");
  cont.innerHTML = `<h1>Equipo</h1><p class="subtitulo">Disponibilidad y carga de trabajo de cada persona, para repartir tareas con criterio.</p><div class="kpi-grid" id="kpiGrid"></div>`;
  const uids = misUidsEnAlcance();
  const q = soyOwner()
    ? query(collection(db, "tareas"))
    : query(collection(db, "tareas"), where("responsableUid", "in", uids));

  unsubs.equipo = onSnapshot(q, (snap) => {
    const tareas = [];
    snap.forEach((d) => tareas.push({ id: d.id, ...d.data() }));
    const hoy = hoyStr();
    const porPersona = new Map(uids.map((u) => [u, { pendiente: 0, en_progreso: 0, vencidas: 0, total: 0 }]));
    for (const t of tareas) {
      const r = porPersona.get(t.responsableUid);
      if (!r) continue;
      r.total++;
      if (t.estado === "pendiente") r.pendiente++;
      if (t.estado === "en_progreso") r.en_progreso++;
      if (t.fechaLimite && t.fechaLimite < hoy) r.vencidas++;
    }
    const maxCarga = Math.max(1, ...[...porPersona.values()].map((r) => r.total));
    $("kpiGrid").innerHTML = uids.map((u) => {
      const r = porPersona.get(u);
      const pct = Math.round((r.total / maxCarga) * 100);
      const nivel = r.total === 0 ? "baja" : pct >= 70 ? "alta" : pct >= 35 ? "media" : "baja";
      const usr = usuariosCache.get(u) || {};
      const etiquetaRol = usr.rol === "owner" ? "Administrador general" : usr.rol === "admin" ? "Jefe de área" : "Personal";
      return `
        <div class="kpi-tarjeta kpi-carga-${nivel}">
          <div class="kpi-tarjeta-cabecera">
            <div class="avatar" style="position:static">${iniciales(usr.nombre)}</div>
            <div><div class="kpi-nombre">${esc(usr.nombre || "—")}</div><div class="kpi-rol">${etiquetaRol}</div></div>
          </div>
          <div class="kpi-barra"><div class="kpi-barra-rellena" style="width:${pct}%"></div></div>
          <div class="kpi-fila"><span>Pendientes</span><b>${r.pendiente}</b></div>
          <div class="kpi-fila"><span>En progreso</span><b>${r.en_progreso}</b></div>
          <div class="kpi-fila"><span>Vencidas</span><b style="${r.vencidas ? "color:var(--rojo)" : ""}">${r.vencidas}</b></div>
          <div class="kpi-fila"><span>Total asignadas</span><b>${r.total}</b></div>
        </div>`;
    }).join("");
  });
}

// ---------------------------------------------------------------------
// Vista "Administración" — solo owner: altas, roles y a quién gestiona
// cada jefe de área. (Las cuentas de acceso se crean en Firebase Console
// → Authentication; aquí solo se completa el perfil con ese UID.)
// ---------------------------------------------------------------------
function vistaAdmin() {
  const cont = $("vista");
  cont.innerHTML = `
    <h1>Administración</h1>
    <p class="subtitulo">Para dar acceso a alguien nuevo, créalo primero en Firebase Console → Authentication, copia su UID y complétalo aquí.</p>
    <div class="form-inline">
      <div class="campo"><label>UID (de Firebase Auth)</label><input id="nuUid" placeholder="Pega el UID"></div>
      <div class="campo"><label>Nombre</label><input id="nuNombre"></div>
      <div class="campo"><label>Correo</label><input id="nuEmail" type="email"></div>
      <div class="campo"><label>Rol</label>
        <select id="nuRol">
          <option value="staff">Personal</option>
          <option value="admin">Jefe de área</option>
          <option value="owner">Administrador general</option>
        </select>
      </div>
      <button type="button" class="boton-primario" id="btnCrearUsuario">Agregar</button>
    </div>
    <p class="error" id="nuErr"></p>
    <div id="listaUsuarios"></div>

    <div class="importar-caja">
      <h2>Importar tareas (migración desde la agenda anterior)</h2>
      <p class="subtitulo" style="margin-bottom:10px">
        Pega aquí filas en formato CSV con columnas <code>proyecto,titulo,responsable_correo,prioridad,fecha_limite,notas</code>
        (una tarea por línea; <code>prioridad</code> es alta/media/baja y <code>fecha_limite</code> va como AAAA-MM-DD; los dos últimos campos son opcionales).
        El correo debe coincidir con el de alguien ya agregado arriba.
      </p>
      <textarea id="txtImportar" placeholder="proyecto,titulo,responsable_correo,prioridad,fecha_limite,notas&#10;Antamina,Revisar informe,staff1@test.com,alta,2026-11-01,"></textarea>
      <div class="modal-botones" style="justify-content:flex-start;margin-top:10px">
        <button type="button" class="boton-primario" id="btnImportar">Importar</button>
      </div>
      <div class="importar-resultado" id="resImportar"></div>
    </div>`;

  $("btnCrearUsuario").addEventListener("click", async () => {
    $("nuErr").textContent = "";
    const uid = $("nuUid").value.trim(), nombre = $("nuNombre").value.trim(), email = $("nuEmail").value.trim(), rol = $("nuRol").value;
    if (!uid || !nombre || !email) { $("nuErr").textContent = "Completa UID, nombre y correo."; return; }
    try {
      await setDoc(doc(db, "usuarios", uid), { nombre, email, rol, gestionados: [], activo: true, creadoEn: serverTimestamp() });
      flash("Usuario agregado.");
      $("nuUid").value = ""; $("nuNombre").value = ""; $("nuEmail").value = "";
    } catch (e) { $("nuErr").textContent = "No se pudo guardar (¿permisos?)."; }
  });

  $("btnImportar").addEventListener("click", async () => {
    const texto = $("txtImportar").value.trim();
    const resEl = $("resImportar");
    resEl.textContent = "";
    if (!texto) { resEl.textContent = "Pega primero las filas a importar."; return; }

    const filas = parsearCSV(texto);
    // si la primera fila es la cabecera de ejemplo, se ignora
    const primera = (filas[0] || []).map((c) => c.toLowerCase().trim());
    if (primera[0] === "proyecto" && primera[1] === "titulo") filas.shift();

    const porCorreo = new Map();
    usuariosCache.forEach((u) => { if (u.email) porCorreo.set(u.email.toLowerCase().trim(), u.id); });

    const lote = writeBatch(db);
    let importadas = 0;
    const omitidas = [];
    for (const [i, cols] of filas.entries()) {
      if (cols.length === 1 && !cols[0]) continue; // línea vacía
      const [proyecto = "", titulo = "", correo = "", prioridadRaw = "", fechaRaw = "", notas = ""] = cols;
      const uid = porCorreo.get((correo || "").toLowerCase().trim());
      if (!titulo.trim()) { omitidas.push(`Fila ${i + 1}: sin título.`); continue; }
      if (!uid) { omitidas.push(`Fila ${i + 1} ("${titulo.trim()}"): no se encontró a nadie con el correo "${correo}".`); continue; }
      const prioridad = ["alta", "media", "baja"].includes(prioridadRaw.trim().toLowerCase()) ? prioridadRaw.trim().toLowerCase() : "media";
      const fechaLimite = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw.trim()) ? fechaRaw.trim() : null;
      const ref = doc(collection(db, "tareas"));
      lote.set(ref, {
        proyecto: proyecto.trim(), titulo: titulo.trim(), responsableUid: uid, prioridad, fechaLimite,
        descripcion: notas.trim(), estado: "pendiente", creadoPorUid: miUid, creadoEn: serverTimestamp(),
      });
      importadas++;
    }
    if (importadas === 0) {
      resEl.textContent = "No se importó nada.\n" + omitidas.join("\n");
      return;
    }
    try {
      await lote.commit();
      resEl.textContent = `Se importaron ${importadas} tareas.` + (omitidas.length ? `\nSe omitieron ${omitidas.length}:\n` + omitidas.join("\n") : "");
      $("txtImportar").value = "";
      flash(`Se importaron ${importadas} tareas.`);
    } catch (e) {
      resEl.textContent = "No se pudo importar (¿permisos? recuerda que esto solo lo puede hacer el administrador general).";
    }
  });

  unsubs.admin = onSnapshot(collection(db, "usuarios"), (snap) => {
    const usuarios = [];
    snap.forEach((d) => usuarios.push({ id: d.id, ...d.data() }));
    usuarios.forEach((u) => usuariosCache.set(u.id, u));
    $("listaUsuarios").innerHTML = `<div class="tabla-scroll"><table class="tabla"><thead><tr>
        <th>Nombre</th><th>Correo</th><th>Rol</th><th>Gestiona a</th><th>Activo</th><th></th>
      </tr></thead><tbody>${usuarios.map((u) => filaUsuarioHTML(u, usuarios)).join("")}</tbody></table></div>`;
    conectarFilaUsuarios();
  });
}

function filaUsuarioHTML(u, todos) {
  const esYoMismo = u.id === miUid;
  return `
    <tr>
      <td>${esc(u.nombre)}${esYoMismo ? " (tú)" : ""}</td>
      <td>${esc(u.email)}</td>
      <td>
        <select class="sel-rol" data-uid="${u.id}" ${esYoMismo ? "disabled" : ""}>
          <option value="staff" ${u.rol === "staff" ? "selected" : ""}>Personal</option>
          <option value="admin" ${u.rol === "admin" ? "selected" : ""}>Jefe de área</option>
          <option value="owner" ${u.rol === "owner" ? "selected" : ""}>Administrador general</option>
        </select>
      </td>
      <td>${u.rol === "admin" ? gestionadosHTML(u, todos) : "—"}</td>
      <td><label class="opcion-checkbox"><input type="checkbox" class="chk-activo" data-uid="${u.id}" ${u.activo !== false ? "checked" : ""} ${esYoMismo ? "disabled" : ""}></label></td>
      <td>${esYoMismo ? "" : `<button type="button" class="icono-accion btn-quitar-usuario" data-uid="${u.id}" title="Quitar acceso">✕</button>`}</td>
    </tr>`;
}

function gestionadosHTML(u, todos) {
  const gestionados = u.gestionados || [];
  // Solo se puede asignar personal (no otros jefes de área ni al dueño) para
  // que el alcance de cada admin no se cruce con el de otro.
  const disponibles = todos.filter((o) => o.id !== u.id && o.rol === "staff" && !gestionados.includes(o.id));
  return `
    <div class="lista-chips">
      ${gestionados.map((g) => `<span class="chip-quitable"><span>${esc(nombreDe(g))}</span><button type="button" class="btn-quitar-gestionado" data-admin="${u.id}" data-gestionado="${g}">✕</button></span>`).join("") || '<span class="meta-tarea">Ninguno</span>'}
    </div>
    ${disponibles.length ? `
      <select class="sel-agregar-gestionado" data-admin="${u.id}" style="margin-top:6px">
        <option value="">+ agregar persona…</option>
        ${disponibles.map((o) => `<option value="${o.id}">${esc(o.nombre)}</option>`).join("")}
      </select>` : ""}`;
}

function conectarFilaUsuarios() {
  $("listaUsuarios").querySelectorAll(".sel-rol").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try { await updateDoc(doc(db, "usuarios", sel.dataset.uid), { rol: sel.value }); flash("Rol actualizado."); }
      catch (e) { flash("No se pudo cambiar el rol.", "error"); }
    });
  });
  $("listaUsuarios").querySelectorAll(".chk-activo").forEach((chk) => {
    chk.addEventListener("change", async () => {
      try { await updateDoc(doc(db, "usuarios", chk.dataset.uid), { activo: chk.checked }); flash("Estado actualizado."); }
      catch (e) { flash("No se pudo cambiar el estado.", "error"); }
    });
  });
  $("listaUsuarios").querySelectorAll(".btn-quitar-usuario").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("¿Quitar a esta persona de la app? Su cuenta de Firebase no se borra, solo su acceso aquí.")) return;
      try { await deleteDoc(doc(db, "usuarios", b.dataset.uid)); flash("Usuario quitado."); }
      catch (e) { flash("No se pudo quitar.", "error"); }
    });
  });
  $("listaUsuarios").querySelectorAll(".sel-agregar-gestionado").forEach((sel) => {
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      try { await updateDoc(doc(db, "usuarios", sel.dataset.admin), { gestionados: arrayUnion(sel.value) }); flash("Agregado."); }
      catch (e) { flash("No se pudo agregar.", "error"); }
    });
  });
  $("listaUsuarios").querySelectorAll(".btn-quitar-gestionado").forEach((b) => {
    b.addEventListener("click", async () => {
      try { await updateDoc(doc(db, "usuarios", b.dataset.admin), { gestionados: arrayRemove(b.dataset.gestionado) }); flash("Quitado."); }
      catch (e) { flash("No se pudo quitar.", "error"); }
    });
  });
}
