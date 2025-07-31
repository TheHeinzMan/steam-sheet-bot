
const express = require("express");
const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const fs = require("fs");

const credsPath = "/etc/secrets/service_account.json";
console.log("⏳ Loading service account credentials from:", credsPath);

if (!fs.existsSync(credsPath)) {
  console.error("❌ Service account file not found!");
  process.exit(1);
}

const creds = require(credsPath);

const SHEET_ID = "1vIqx77znUB9gF6zlyXgpk1Tjvogf4xv4zi6qf7Hcu0Q";
const SHEET_NAME = "Masterlist";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/ping", (req, res) => {
  res.send("Pong ✅");
});

async function authorize() {
  console.log("🔐 Authorizing with Google...");
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return await auth.getClient();
}

async function readSteamIDs(auth) {
  console.log("📄 Reading SteamIDs from sheet...");
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B5:B`,
  });
  const values = res.data.values?.flat() || [];
  console.log(`✅ Found ${values.length} SteamIDs`);
  return values;
}

function extractDates(text) {
  const regex = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\b/g;
  let match, dates = [];

  while ((match = regex.exec(text)) !== null) {
    const [_, month, day, year, hour, min, sec] = match.map(Number);
    const date = new Date(year, month - 1, day, hour, min, sec);
    dates.push(date);
  }

  return dates;
}

function formatDaysAgo(date) {
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  return `Last Seen ${diffDays} Days Ago`;
}

async function scrapeLastSeen(browser, steamId) {
  const url = `https://superiorservers.co/ssrp/cwrp/characters/${steamId}`;
  const page = await browser.newPage();

  try {
    console.log(`🌐 Visiting ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000));
    const text = await page.evaluate(() => document.body.innerText);
    const dates = extractDates(text);
    if (dates.length === 0) return "No valid dates";
    const latest = new Date(Math.max(...dates));
    return formatDaysAgo(latest);
  } catch (err) {
    console.error(`❌ Failed for ${steamId}:`, err.message);
    return "Error loading";
  } finally {
    await page.close();
  }
}

async function writeToSheet(auth, values) {
  console.log("📝 Writing results to sheet...");
  const sheets = google.sheets({ version: "v4", auth });
  const range = `${SHEET_NAME}!E5:E${values.length + 4}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range,
    valueInputOption: "RAW",
    requestBody: {
      values: values.map(v => [v]),
    },
  });
}

app.get("/", async (req, res) => {
  res.send("✅ Task started. Check the Google Sheet for updates!");

  (async () => {
    try {
      const auth = await authorize();
      const steamIDs = await readSteamIDs(auth);

      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const results = [];

      for (const steamId of steamIDs) {
        console.log("🔍 Checking:", steamId);
        const result = await scrapeLastSeen(browser, steamId);
        results.push(result);
      }

      await browser.close();
      await writeToSheet(auth, results);
      console.log("✅ All done!");
    } catch (err) {
      console.error("💥 Uncaught error:", err.message);
    }
  })();
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
