const express = require("express");
const cors    = require("cors");
const path    = require("path");
const { Pool } = require("pg");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL не задан — работаем без БД");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_balances (
      telegram_user_id     TEXT PRIMARY KEY,
      balance              INTEGER NOT NULL DEFAULT 0,
      subscribers          INTEGER NOT NULL DEFAULT 100,
      rating               INTEGER NOT NULL DEFAULT 1000,
      games_played         INTEGER NOT NULL DEFAULT 0,
      max_multiplier_x100  INTEGER NOT NULL DEFAULT 100,
      total_earnings       INTEGER NOT NULL DEFAULT 0,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      referrer_id TEXT NOT NULL,
      new_user_id TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (referrer_id, new_user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                         SERIAL PRIMARY KEY,
      user_id                    TEXT NOT NULL,
      telegram_payment_charge_id TEXT UNIQUE NOT NULL,
      stars_amount               INTEGER NOT NULL,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("База данных готова");
}

// ── Online counter (in-memory, resets on restart — OK for mini-app) ──────────
const activeSessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 3 * 60 * 1000;
  for (const [id, ts] of activeSessions) {
    if (ts < cutoff) activeSessions.delete(id);
  }
}, 60_000);

function countOnline() {
  const cutoff = Date.now() - 2 * 60 * 1000;
  let n = 0;
  for (const ts of activeSessions.values()) {
    if (ts > cutoff) n++;
  }
  return Math.max(1, n);
}

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// ── Online ───────────────────────────────────────────────────────────────────
app.post("/api/online/ping", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && typeof sessionId === "string") {
    activeSessions.set(sessionId.slice(0, 64), Date.now());
  }
  res.json({ online: countOnline() });
});

app.get("/api/online/count", (_req, res) => {
  res.json({ online: countOnline() });
});

// ── Balance ──────────────────────────────────────────────────────────────────
app.get("/api/balance/:userId", async (req, res) => {
  if (!pool) {
    return res.json({
      balance: 0, subscribers: 100, rating: 1000,
      gamesPlayed: 0, maxMultiplier: 1, totalEarnings: 0, isNew: true,
    });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM user_balances WHERE telegram_user_id = $1 LIMIT 1",
      [req.params.userId]
    );
    if (!rows.length) {
      return res.json({
        balance: 0, subscribers: 100, rating: 1000,
        gamesPlayed: 0, maxMultiplier: 1, totalEarnings: 0, isNew: true,
      });
    }
    const r = rows[0];
    res.json({
      balance:       r.balance,
      subscribers:   r.subscribers,
      rating:        r.rating,
      gamesPlayed:   r.games_played,
      maxMultiplier: r.max_multiplier_x100 / 100,
      totalEarnings: r.total_earnings,
      isNew: false,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/balance/save", async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: "DATABASE_URL не задан" });
  }
  const { telegramUserId, balance, subscribers, rating, gamesPlayed, maxMultiplier, totalEarnings } = req.body;
  if (!telegramUserId) return res.status(400).json({ error: "Нет telegramUserId" });
  try {
    await pool.query(
      `INSERT INTO user_balances
         (telegram_user_id, balance, subscribers, rating, games_played, max_multiplier_x100, total_earnings, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (telegram_user_id) DO UPDATE SET
         balance             = EXCLUDED.balance,
         subscribers         = EXCLUDED.subscribers,
         rating              = EXCLUDED.rating,
         games_played        = EXCLUDED.games_played,
         max_multiplier_x100 = EXCLUDED.max_multiplier_x100,
         total_earnings      = EXCLUDED.total_earnings,
         updated_at          = NOW()`,
      [
        telegramUserId,
        Math.max(0, Math.floor(balance       || 0)),
        Math.max(0, Math.floor(subscribers   || 100)),
        Math.max(0, Math.floor(rating        || 1000)),
        Math.max(0, Math.floor(gamesPlayed   || 0)),
        Math.max(100, Math.floor((maxMultiplier || 1) * 100)),
        Math.max(0, Math.floor(totalEarnings || 0)),
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Referral ─────────────────────────────────────────────────────────────────
app.post("/api/referral/register", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL не задан" });
  const { referrerId, newUserId } = req.body || {};
  if (!referrerId || !newUserId || referrerId === newUserId) {
    return res.status(400).json({ error: "Неверные данные" });
  }
  try {
    await pool.query(
      "INSERT INTO referrals (referrer_id, new_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [referrerId, newUserId]
    );
    // Бонус рефереру +50 звёзд
    await pool.query(
      `INSERT INTO user_balances (telegram_user_id, balance) VALUES ($1, 50)
       ON CONFLICT (telegram_user_id) DO UPDATE
         SET balance = user_balances.balance + 50, updated_at = NOW()`,
      [referrerId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/referral/list/:userId", async (req, res) => {
  if (!pool) return res.json({ referrals: [] });
  try {
    const { rows } = await pool.query(
      "SELECT new_user_id, created_at FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC",
      [req.params.userId]
    );
    res.json({ referrals: rows.map(r => ({ userId: r.new_user_id, date: r.created_at })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Telegram Stars payments ───────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.post("/api/payments/create-invoice", async (req, res) => {
  if (!BOT_TOKEN) return res.status(503).json({ error: "TELEGRAM_BOT_TOKEN не задан" });
  const { userId, stars } = req.body || {};
  if (!userId || !stars || stars < 1) return res.status(400).json({ error: "Неверные данные" });
  try {
    const payload = JSON.stringify({ userId, stars, ts: Date.now() });
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title:       `${stars} ⭐ для StreamRush`,
        description: `Пополнение баланса на ${stars} звёзд`,
        payload,
        currency: "XTR",
        prices: [{ label: `${stars} Звёзд`, amount: stars }],
      }),
    });
    const data = await r.json();
    if (!data.ok) return res.status(400).json({ error: data.description });
    res.json({ invoiceUrl: data.result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/payments/webhook", async (req, res) => {
  // Всегда отвечаем 200 сразу (Telegram требует быстрый ответ)
  res.json({ ok: true });
  try {
    const update = req.body;
    if (update?.pre_checkout_query) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }),
      });
      return;
    }
    if (update?.message?.successful_payment && pool) {
      const p = update.message.successful_payment;
      const { userId } = JSON.parse(p.invoice_payload);
      await pool.query(
        "INSERT INTO payments (user_id, telegram_payment_charge_id, stars_amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [userId, p.telegram_payment_charge_id, p.total_amount]
      );
      await pool.query(
        `INSERT INTO user_balances (telegram_user_id, balance) VALUES ($1,$2)
         ON CONFLICT (telegram_user_id) DO UPDATE
           SET balance = user_balances.balance + $2, updated_at = NOW()`,
        [userId, p.total_amount]
      );
    }
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
});

// ── Static frontend (SPA) ────────────────────────────────────────────────────
const staticDir = path.join(__dirname, "public");
app.use(express.static(staticDir));
app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));

// ── Start ────────────────────────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`StreamRush запущен на порту ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Ошибка инициализации БД:", e.message);
    app.listen(PORT, () => {
      console.log(`StreamRush запущен на порту ${PORT} (без БД)`);
    });
  });
