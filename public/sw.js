// Service Worker for Rain Alert Push Notifications

self.addEventListener("push", (event) => {
  let data = { title: "Rain Alert", body: "Rain is expected!" };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "/rain-icon.png",
    badge: "/rain-icon.png",
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: [
      { action: "view", title: "View Details" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "view" || !event.action) {
    event.waitUntil(clients.openWindow("/"));
  }
});
