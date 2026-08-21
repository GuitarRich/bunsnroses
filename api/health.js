import { sheetsClient, sheetId, ensureTabs } from "./_sheets.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const out = {
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
      SHEET_ID: !!process.env.SHEET_ID,
      APP_SECRET: !!process.env.APP_SECRET,
    },
    owner: process.env.OWNER_NAME || "Rich",
  };

  if (process.env.GOOGLE_PRIVATE_KEY) {
    const k = process.env.GOOGLE_PRIVATE_KEY;
    out.keyLooksRight =
      k.includes("BEGIN PRIVATE KEY") && (k.includes("\\n") || k.includes("\n"));
  }

  try {
    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
    out.sheetTitle = meta.data.properties.title;
    out.tabs = meta.data.sheets.map((s) => s.properties.title);
    await ensureTabs();
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = e.message;
    if (/permission|forbidden|403/i.test(e.message)) {
      out.hint =
        "Share the sheet with the service account email as an Editor.";
    }
    if (/DECODER|PEM|key/i.test(e.message)) {
      out.hint = "GOOGLE_PRIVATE_KEY is malformed - paste the whole key including BEGIN/END lines.";
    }
  }
  return res.status(out.ok ? 200 : 500).json(out);
}
