import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN NOT SET");
}

// ===== HELPER: запрос к Telegram =====
async function tg(method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("Telegram API error:", data);
      throw new Error(data.description);
    }

    return data.result;
  } catch (err) {
    console.error("❌ TG REQUEST FAILED:", err.message);
    throw err;
  }
}

// ===== СОЗДАТЬ ИНВОЙС (STARS) =====
app.post("/api/stars/create", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({ error: "no token" });
    }

    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: "bad params" });
    }

    const invoice = await tg("createInvoiceLink", {
      title: "Покупка Stars",
      description: "Пополнение баланса",
      payload: "stars_payment",
      currency: "XTR", // Telegram Stars
      prices: [
        {
          label: "Stars",
          amount: amount, // например 100 = 100 stars
        },
      ],
    });

    res.json({ ok: true, url: invoice });
  } catch (e) {
    res.status(500).json({
      error: "network error",
      message: e.message,
    });
  }
});

// ===== ПРОВЕРКА =====
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ===== СТАРТ =====
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on", PORT);
});
