const express = require("express");
const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const creds = require("/etc/secrets/service_account.json");

const SHEET_ID = "1vIqx77znUB9gF6zlyXgpk1Tjvogf4xv4zi6qf7Hcu0Q";
const SHEET_NAME = "Masterlist";

const app = express();
const PORT = process.env.PORT || 3000;

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return await auth.getClient();
}

async function readSteamIDs(auth) {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B5:B`,
  });
  return res.data.values.flat();
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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000)); // simulate wait
    const text = await page.evaluate(() => document.body.innerText);
    const dates = extractDates(text);
    if (dates.length === 0) return "No valid dates";
    const latest = new Date(Math.max(...dates));
    return formatDaysAgo(latest);
  } catch (err) {
    console.error(`Failed for ${steamId}:`, err.message);
    return "Error loading";
  } finally {
    await page.close();
  }
}

async function writeToSheet(auth, values) {
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
  const auth = await authorize();
  const steamIDs = await readSteamIDs(auth);
  const browser = await puppeteer.launch({ headless: "new" });
  const results = [];

  for (const steamId of steamIDs) {
    console.log("Checking:", steamId);
    const result = await scrapeLastSeen(browser, steamId);
    results.push(result);
  }

  await browser.close();
  await writeToSheet(auth, results);
  console.log("✅ Done!");

  res.send("✅ Updated Google Sheet with Last Seen data!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
