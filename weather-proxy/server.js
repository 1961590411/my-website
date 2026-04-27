import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const PORT = 3000;
const AMAP_KEY = process.env.AMAP_KEY;

if (!AMAP_KEY) {
  throw new Error("缺少环境变量 AMAP_KEY");
}

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://127.0.0.1:8080",
      "http://localhost:8080"
    ]
  })
);

// 全局限流：每 IP 每分钟最多 30 次
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试" }
});
app.use("/api", globalLimiter);

// 天气查询专用限流：每 IP 每分钟最多 10 次
const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "天气查询过于频繁，请 1 分钟后重试" }
});

// 同一 IP + 同一城市 10 秒冷却
const cooldownStore = new Map();
function cooldownGuard(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const city = String(req.query.city || "").trim();
  const key = `${ip}|${city}`;
  const now = Date.now();
  const last = cooldownStore.get(key) || 0;

  if (now - last < 10_000) {
    return res.status(429).json({ error: "查询太快了，请 10 秒后再试" });
  }

  cooldownStore.set(key, now);
  next();
}

app.get("/api/district", async (req, res) => {
  try {
    const keywords = String(req.query.keywords || "").trim();
    if (!keywords) {
      return res.status(400).json({ error: "keywords 必填" });
    }

    const url =
      "https://restapi.amap.com/v3/config/district?keywords=" +
      encodeURIComponent(keywords) +
      "&subdistrict=1&extensions=base&key=" +
      encodeURIComponent(AMAP_KEY);

    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "行政区查询失败" });
  }
});

app.get("/api/weather", weatherLimiter, cooldownGuard, async (req, res) => {
  try {
    const city = String(req.query.city || "").trim();
    if (!city) {
      return res.status(400).json({ error: "city 必填" });
    }

    const url =
      "https://restapi.amap.com/v3/weather/weatherInfo?city=" +
      encodeURIComponent(city) +
      "&key=" +
      encodeURIComponent(AMAP_KEY);

    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "天气查询失败" });
  }
});

app.listen(PORT, () => {
  console.log(`天气代理服务已启动: http://localhost:${PORT}`);
});