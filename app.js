const express = require("express");
const path = require("path");
const cors = require("cors");

const indexRouter = require("./routes/index");
const patientsRouter = require("./routes/patients");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware (must be before routes)
app.use(cors());
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/", indexRouter);
app.use("/api/patients", patientsRouter);

// Catch-all route for handling 404 errors
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "views", "404.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
