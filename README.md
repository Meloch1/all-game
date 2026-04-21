# StreamRush — Telegram Mini App

Казино-платформа с 5 играми: Краш, Монета, Мины, Колесо, Кости.  
Оплата через Telegram Stars. Реферальная система (+50 звёзд за каждого друга).

## Деплой на Railway

### 1. Создай проект на Railway
1. Зайди на [railway.app](https://railway.app) → New Project → Deploy from GitHub repo  
2. Выбери этот репозиторий

### 2. Добавь PostgreSQL
1. В проекте Railway → New → Database → Add PostgreSQL  
2. `DATABASE_URL` подставится автоматически в переменные

### 3. Добавь переменные окружения
В Railway → Variables добавь:
| Переменная | Значение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от [@BotFather](https://t.me/BotFather) |
| `SESSION_SECRET` | Любая случайная строка (30+ символов) |
| `APP_DOMAIN` | URL твоего Railway сервиса (например `streamrush.up.railway.app`) |

### 4. Настрой бота в BotFather
```
/setmenubutton — выбери бота → Web App → укажи URL Railway сервиса
```

### 5. Настрой вебхук для платежей
После деплоя выполни (замени TOKEN и DOMAIN):
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<DOMAIN>/api/payments/webhook
```

---

## Структура
```
server.js      — Express сервер (API + раздача фронта)
public/        — Собранный React фронтенд
package.json   — Зависимости
railway.json   — Конфиг Railway
```

## API эндпоинты
- `GET  /api/healthz` — проверка работы
- `GET  /api/online/count` — сколько игроков онлайн
- `POST /api/online/ping` — обновить присутствие
- `GET  /api/balance/:userId` — баланс игрока
- `POST /api/balance/save` — сохранить баланс
- `POST /api/referral/register` — зарегистрировать реферала
- `GET  /api/referral/list/:userId` — список рефералов
- `POST /api/payments/create-invoice` — создать счёт (Telegram Stars)
- `POST /api/payments/webhook` — вебхук Telegram
