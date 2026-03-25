const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const webPush = require("web-push");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── VAPID Key Setup (auto-generate if missing) ───────────────────────────────
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  const keys = webPush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.log("──────────────────────────────────────────────");
  console.log("VAPID keys generated! Add these to your .env:");
  console.log(`VAPID_PUBLIC_KEY=${vapidPublicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidPrivateKey}`);
  console.log("──────────────────────────────────────────────");
}

webPush.setVapidDetails(
  "mailto:rain-alert@example.com",
  vapidPublicKey,
  vapidPrivateKey
);

// ─── In-memory store for push subscriptions ────────────────────────────────────
let pushSubscriptions = [];

// ─── In-memory store for rain alert history ────────────────────────────────────
let alertHistory = [];

// ─── Email Transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Weather Check Logic ───────────────────────────────────────────────────────
async function checkWeatherForRain() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city = process.env.CITY || "Delhi";
  const countryCode = process.env.COUNTRY_CODE || "IN";

  if (!apiKey || apiKey === "your_api_key_here") {
    console.log("[SKIP] No valid OpenWeatherMap API key configured.");
    return null;
  }

  try {
    // 5-day / 3-hour forecast API
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city},${countryCode}&appid=${apiKey}&units=metric`;
    const { data } = await axios.get(url);

    const rainySlots = data.list
      .filter((slot) => {
        const dominated = slot.weather.some((w) =>
          ["Rain", "Drizzle", "Thunderstorm"].includes(w.main)
        );
        return dominated;
      })
      .map((slot) => ({
        time: slot.dt_txt,
        localTime: new Date(slot.dt * 1000).toLocaleString(),
        temp: slot.main.temp,
        description: slot.weather.map((w) => w.description).join(", "),
        windSpeed: slot.wind.speed,
        humidity: slot.main.humidity,
      }));

    // Only alert for rain in the next 24 hours
    const next24h = Date.now() + 24 * 60 * 60 * 1000;
    const upcoming = rainySlots.filter(
      (s) => new Date(s.time).getTime() <= next24h
    );

    if (upcoming.length > 0) {
      console.log(
        `[RAIN DETECTED] ${upcoming.length} rainy time slots in next 24h for ${city}`
      );
      return { city, rainySlots: upcoming };
    } else {
      console.log(`[CLEAR] No rain expected in the next 24h for ${city}`);
      return null;
    }
  } catch (err) {
    console.error("[ERROR] Weather API:", err.message);
    return null;
  }
}

// ─── Send Email Alert ──────────────────────────────────────────────────────────
async function sendEmailAlert(rainData) {
  const recipient = process.env.ALERT_RECIPIENT;
  if (!recipient || recipient === "recipient_email@gmail.com") {
    console.log("[SKIP] No valid email recipient configured.");
    return;
  }

  const rainRows = rainData.rainySlots
    .map(
      (s) =>
        `<tr>
          <td style="padding:8px;border:1px solid #ddd">${s.localTime}</td>
          <td style="padding:8px;border:1px solid #ddd">${s.description}</td>
          <td style="padding:8px;border:1px solid #ddd">${s.temp}°C</td>
          <td style="padding:8px;border:1px solid #ddd">${s.humidity}%</td>
          <td style="padding:8px;border:1px solid #ddd">${s.windSpeed} m/s</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a73e8">🌧️ Rain Alert — ${rainData.city}</h2>
      <p>Rain is expected in <strong>${rainData.city}</strong> in the next 24 hours.</p>
      <table style="border-collapse:collapse;width:100%">
        <thead>
          <tr style="background:#1a73e8;color:#fff">
            <th style="padding:8px;border:1px solid #ddd">Time</th>
            <th style="padding:8px;border:1px solid #ddd">Condition</th>
            <th style="padding:8px;border:1px solid #ddd">Temp</th>
            <th style="padding:8px;border:1px solid #ddd">Humidity</th>
            <th style="padding:8px;border:1px solid #ddd">Wind</th>
          </tr>
        </thead>
        <tbody>${rainRows}</tbody>
      </table>
      <p style="color:#888;margin-top:16px;font-size:12px">Sent by Rain Alert App</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Rain Alert" <${process.env.EMAIL_USER}>`,
      to: recipient,
      subject: `🌧️ Rain Alert for ${rainData.city} — Carry an Umbrella!`,
      html,
    });
    console.log(`[EMAIL SENT] Rain alert sent to ${recipient}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// ─── Send Push Notification ────────────────────────────────────────────────────
async function sendPushNotifications(rainData) {
  if (pushSubscriptions.length === 0) {
    console.log("[SKIP] No push subscribers.");
    return;
  }

  const firstRain = rainData.rainySlots[0];
  const payload = JSON.stringify({
    title: `🌧️ Rain Alert — ${rainData.city}`,
    body: `Rain expected at ${firstRain.localTime} (${firstRain.description}, ${firstRain.temp}°C)`,
    icon: "/rain-icon.png",
    data: { rainySlots: rainData.rainySlots },
  });

  const results = await Promise.allSettled(
    pushSubscriptions.map((sub) => webPush.sendNotification(sub, payload))
  );

  // Remove invalid subscriptions
  const validSubs = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      validSubs.push(pushSubscriptions[i]);
    }
  });
  pushSubscriptions = validSubs;
  console.log(
    `[PUSH] Sent to ${validSubs.length}/${results.length} subscribers`
  );
}

// ─── Main Check & Alert Routine ────────────────────────────────────────────────
async function runRainCheck() {
  console.log(`\n[CHECK] Running rain check at ${new Date().toLocaleString()}`);
  const rainData = await checkWeatherForRain();

  if (rainData) {
    // Save to history
    alertHistory.unshift({
      timestamp: new Date().toISOString(),
      city: rainData.city,
      slots: rainData.rainySlots,
    });
    if (alertHistory.length > 50) alertHistory = alertHistory.slice(0, 50);

    await Promise.all([
      sendEmailAlert(rainData),
      sendPushNotifications(rainData),
    ]);
  }

  return rainData;
}

// ─── API Routes ────────────────────────────────────────────────────────────────

// Get VAPID public key for the frontend
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// Subscribe to push notifications
app.post("/api/subscribe", (req, res) => {
  const subscription = req.body;
  if (
    !subscription ||
    !subscription.endpoint
  ) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  const exists = pushSubscriptions.some(
    (s) => s.endpoint === subscription.endpoint
  );
  if (!exists) {
    pushSubscriptions.push(subscription);
  }
  res.json({ message: "Subscribed successfully" });
});

// Manual check trigger
app.get("/api/check-now", async (req, res) => {
  const result = await runRainCheck();
  res.json({
    rain: !!result,
    data: result,
    message: result
      ? `Rain detected! ${result.rainySlots.length} rainy time slots.`
      : "No rain expected in the next 24 hours.",
  });
});

// Get alert history
app.get("/api/history", (req, res) => {
  res.json(alertHistory);
});

// Get current config (safe fields only)
app.get("/api/config", (req, res) => {
  res.json({
    city: process.env.CITY || "Delhi",
    countryCode: process.env.COUNTRY_CODE || "IN",
    intervalMinutes: Number(process.env.CHECK_INTERVAL_MINUTES) || 30,
    emailConfigured:
      !!process.env.EMAIL_USER &&
      process.env.EMAIL_USER !== "your_email@gmail.com",
    apiKeyConfigured:
      !!process.env.OPENWEATHER_API_KEY &&
      process.env.OPENWEATHER_API_KEY !== "your_api_key_here",
  });
});

// ─── Vercel Cron endpoint (called by Vercel Cron Jobs) ─────────────────────────
app.get("/api/cron", async (req, res) => {
  const result = await runRainCheck();
  res.json({
    ok: true,
    rain: !!result,
    message: result
      ? `Rain detected! ${result.rainySlots.length} rainy time slots.`
      : "No rain expected in the next 24 hours.",
  });
});

// ─── Local mode: cron scheduler + listen ───────────────────────────────────────
if (process.env.VERCEL !== "1") {
  const interval = Number(process.env.CHECK_INTERVAL_MINUTES) || 30;
  cron.schedule(`*/${interval} * * * *`, () => {
    runRainCheck();
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🌧️  Rain Alert App running at http://localhost:${PORT}`);
    console.log(`   City: ${process.env.CITY || "Delhi"}`);
    console.log(`   Check interval: every ${interval} minutes`);
    console.log(`   API Key configured: ${process.env.OPENWEATHER_API_KEY !== "your_api_key_here"}`);
    console.log("");
    runRainCheck();
  });
}

// Export for Vercel serverless
module.exports = app;
