const express = require("express");
const path = require("path");
const cors = require("cors");

const indexRouter = require("./routes/index");
const patientsRouter = require("./routes/patients");
const providerRouter = require("./routes/provider");

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/provider", providerRouter);

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "views", "404.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
