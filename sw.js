// Service worker de Agenda de Trabajo.
//
// Hace dos cosas en un solo archivo (para no pelearse por el "scope" con un
// segundo service worker):
//  1) Permite instalar la app como PWA, cacheando SOLO archivos estáticos
//     (iconos, manifest). El HTML, app.js y los datos de Firestore NUNCA se
//     cachean aquí, para que nadie vea información vieja sin darse cuenta.
//  2) Recibe las notificaciones push de Firebase Cloud Messaging cuando la
//     app está cerrada o en segundo plano (igual que un mensaje de WhatsApp).

const CACHE = "agenda-estaticos-v1";
const ESTATICOS = ["icono-192.png", "icono-512.png", "icono-180.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const esEstatico = ESTATICOS.some((f) => url.pathname.endsWith(f));
  if (!esEstatico) return; // todo lo demás (HTML, app.js, Firestore...) va directo a la red
  e.respondWith(caches.match(e.request).then((cacheada) => cacheada || fetch(e.request)));
});

// ---------- Firebase Cloud Messaging (push en 2do plano) ----------
// La configuración llega por la URL con la que se registra este worker
// (ver iniciarNotificaciones() en app.js), así no hay que editar este
// archivo a mano ni duplicar el bloque de CONFIGURACIÓN de index.html.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

let config = {};
try { config = JSON.parse(new URL(location.href).searchParams.get("config") || "{}"); } catch (e) { /* aún sin configurar */ }

if (config.apiKey) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const titulo = payload.notification?.title || "Agenda de Trabajo";
    self.registration.showNotification(titulo, {
      body: payload.notification?.body || "",
      icon: "icono-192.png",
      badge: "icono-192.png",
    });
  });
}

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  evento.waitUntil(
    self.clients.matchAll({ type: "window" }).then((lista) => {
      for (const c of lista) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
