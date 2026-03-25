// ─── DOM Elements ──────────────────────────────────────────────────────────────
const checkNowBtn = document.getElementById("checkNowBtn");
const subscribeBtn = document.getElementById("subscribeBtn");
const resultPanel = document.getElementById("resultPanel");
const resultTitle = document.getElementById("resultTitle");
const resultContent = document.getElementById("resultContent");
const configStatus = document.getElementById("configStatus");
const notifStatus = document.getElementById("notifStatus");
const lastCheckStatus = document.getElementById("lastCheckStatus");
const historyList = document.getElementById("historyList");

// ─── Load Config on Start ──────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const config = await res.json();

    let statusParts = [`City: ${config.city}`];
    if (!config.apiKeyConfigured) statusParts.push("⚠️ API key missing");
    if (!config.emailConfigured) statusParts.push("⚠️ Email not set");
    if (config.apiKeyConfigured && config.emailConfigured)
      statusParts.push("✅ Ready");

    configStatus.textContent = statusParts.join(" | ");
  } catch {
    configStatus.textContent = "❌ Cannot reach server";
  }
}

// ─── Push Notification Subscription ────────────────────────────────────────────
async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    notifStatus.textContent = "Not supported in this browser";
    subscribeBtn.style.display = "none";
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notifStatus.textContent = "Permission denied";
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    const keyRes = await fetch("/api/vapid-public-key");
    const { publicKey } = await keyRes.json();

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    notifStatus.textContent = "✅ Subscribed";
    subscribeBtn.textContent = "Subscribed";
    subscribeBtn.classList.add("subscribed");
    subscribeBtn.disabled = true;
  } catch (err) {
    console.error("Push subscription error:", err);
    notifStatus.textContent = "❌ Subscription failed";
  }
}

// ─── Check Weather Now ─────────────────────────────────────────────────────────
async function checkWeatherNow() {
  checkNowBtn.disabled = true;
  checkNowBtn.innerHTML = '<span class="spinner"></span> Checking...';

  try {
    const res = await fetch("/api/check-now");
    const result = await res.json();

    resultPanel.classList.remove("hidden", "rain", "clear");

    if (result.rain) {
      resultPanel.classList.add("rain");
      resultTitle.textContent = `🌧️ Rain Expected in ${result.data.city}!`;

      let tableHTML = `
        <table class="rain-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Condition</th>
              <th>Temp</th>
              <th>Humidity</th>
              <th>Wind</th>
            </tr>
          </thead>
          <tbody>`;

      result.data.rainySlots.forEach((slot) => {
        tableHTML += `
            <tr>
              <td>${slot.localTime}</td>
              <td>${slot.description}</td>
              <td>${slot.temp}°C</td>
              <td>${slot.humidity}%</td>
              <td>${slot.windSpeed} m/s</td>
            </tr>`;
      });

      tableHTML += `</tbody></table>`;
      resultContent.innerHTML = tableHTML;
    } else {
      resultPanel.classList.add("clear");
      resultTitle.textContent = "☀️ No Rain Expected";
      resultContent.innerHTML =
        "<p>No rain is expected in the next 24 hours. You're good to go!</p>";
    }

    lastCheckStatus.textContent = new Date().toLocaleTimeString();
    loadHistory();
  } catch (err) {
    resultPanel.classList.remove("hidden");
    resultPanel.classList.add("rain");
    resultTitle.textContent = "❌ Error";
    resultContent.innerHTML = `<p>Could not check weather. Make sure the server is running and API key is configured.</p><p style="color:#f44336;font-size:0.85rem">${err.message}</p>`;
  } finally {
    checkNowBtn.disabled = false;
    checkNowBtn.innerHTML = "🔍 Check Weather Now";
  }
}

// ─── Load Alert History ────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const history = await res.json();

    if (history.length === 0) {
      historyList.innerHTML =
        '<p class="empty-state">No alerts yet. Click "Check Weather Now" to start.</p>';
      return;
    }

    historyList.innerHTML = history
      .map(
        (item) => `
        <div class="history-item">
          <div class="timestamp">${new Date(item.timestamp).toLocaleString()} — ${item.city}</div>
          <div class="detail">
            ${item.slots.length} rainy slot(s): ${item.slots
          .map((s) => s.localTime + " (" + s.description + ")")
          .join(", ")}
          </div>
        </div>`
      )
      .join("");
  } catch {
    // silently fail
  }
}

// ─── Utility: VAPID key conversion ─────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ─── Event Listeners ───────────────────────────────────────────────────────────
checkNowBtn.addEventListener("click", checkWeatherNow);
subscribeBtn.addEventListener("click", subscribeToPush);

// ─── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
loadHistory();
