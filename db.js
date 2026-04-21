import { Pool } from "pg";

// ===== CONNECT TO DATABASE =====
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ===== INIT TABLE =====
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0
    )
  `);

  console.log("Database ready");
}

// ===== GET USER =====
export async function getUser(id) {
  const res = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [id]
  );

  if (res.rows.length === 0) {
    const created = await pool.query(
      "INSERT INTO users (id, balance) VALUES ($1, 0) RETURNING *",
      [id]
    );
    return created.rows[0];
  }

  return res.rows[0];
}

// ===== GET BALANCE =====
export async function getBalance(id) {
  const user = await getUser(id);
  return user.balance;
}

// ===== ADD BALANCE =====
export async function addBalance(id, amount) {
  const res = await pool.query(
    "UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING *",
    [amount, id]
  );

  return res.rows[0];
}

// ===== SET BALANCE =====
export async function setBalance(id, amount) {
  const res = await pool.query(
    `
    INSERT INTO users (id, balance)
    VALUES ($1, $2)
    ON CONFLICT (id)
    DO UPDATE SET balance = EXCLUDED.balance
    RETURNING *
    `,
    [id, amount]
  );

  return res.rows[0];
}
