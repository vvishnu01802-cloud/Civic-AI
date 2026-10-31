import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "development_only_change_this_secret");
if (!JWT_SECRET) throw new Error("JWT_SECRET must be set before starting CivicPulse in production.");
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));

const db = new Database(path.join(__dirname, "civicpulse.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'citizen', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS complaints (
 id INTEGER PRIMARY KEY AUTOINCREMENT, complaint_code TEXT UNIQUE NOT NULL, user_id INTEGER,
 title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL,
 department TEXT NOT NULL, confidence INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Submitted',
 location TEXT, latitude REAL, longitude REAL, photo_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT, complaint_id INTEGER, rating INTEGER, comment TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare("SELECT COUNT(*) n FROM users").get().n;
if (!count) {
  const hash = bcrypt.hashSync("Admin@12345", 10);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
    .run("CivicPulse Administrator", "admin@civicpulse.local", hash);
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Only JPG, PNG, or WebP images are allowed"), allowed.includes(file.mimetype));
  }
});

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  try {
    if (!header.startsWith("Bearer ")) throw new Error("Missing token");
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Please log in to continue." }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function classify(title, description) {
  const t = `${title} ${description}`.toLowerCase();
  const rules = [
    { keys:["pothole","road","crack","street damage","சாலை","குழி"], category:"Road Damage", department:"PWD", priority:"High" },
    { keys:["garbage","waste","rubbish","dump","குப்பை"], category:"Garbage", department:"Sanitation", priority:"Medium" },
    { keys:["water","leak","pipe","drinking water","தண்ணீர்"], category:"Water Issue", department:"Water Board", priority:"High" },
    { keys:["street light","lamp","dark road","விளக்கு"], category:"Street Light", department:"Electrical", priority:"Medium" },
    { keys:["drain","sewage","blocked"], category:"Drainage", department:"Drainage Department", priority:"High" }
  ];
  const match = rules.find(r => r.keys.some(k => t.includes(k)));
  return match ? { ...match, confidence: 92 } : { category:"Other", department:"Municipal Corporation", priority:"Medium", confidence:70 };
}
function safeComplaint(row) { return row; }
app.post("/api/ai/test", async (req, res) => {
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL,
          messages: [
            {
              role: "user",
              content: "Say Hello! CivicPulse AI is connected."
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: data.error?.message || "API failed" });
    }

    res.json({
      success: true,
      message: data.choices?.[0]?.message?.content
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/health", (_req,res) => res.json({ ok:true, service:"CivicPulse AI API" }));
app.post("/api/auth/register", async (req,res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error:"Name, email, and password are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error:"Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error:"Password must be at least 8 characters." });
  try {
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
      .run(name.trim(), email.toLowerCase().trim(), await bcrypt.hash(password,10));
    const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(result.lastInsertRowid);
    res.status(201).json({ token:tokenFor(user), user });
  } catch { res.status(409).json({ error:"An account with this email already exists." }); }
});
// User Login and Logout Activity Table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    activity TEXT NOT NULL,
    activity_time TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
app.post("/api/auth/login", async (req,res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error:"Email and password are required." });
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email.toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({ error:"Email or password is incorrect." });
  db.prepare(`
  INSERT INTO user_activity (user_id, user_name, user_email, activity)
  VALUES (?, ?, ?, 'LOGIN')
`).run(user.id, user.name, user.email);
  res.json({ token:tokenFor(user), user:{id:user.id,name:user.name,email:user.email,role:user.role} });
});
app.get("/api/auth/me", auth, (req,res) => {
  const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(401).json({error:"Account not found."});
  res.json({ user });
});
app.post("/api/classify", (req,res) => {
  const { title="", description="" } = req.body || {};
  if (!title.trim() && !description.trim()) return res.status(400).json({error:"Enter a title or description to classify."});
  res.json({ ...classify(title,description), note:"Rule-based demo classification. Validate recommendations before dispatch." });
});
app.post("/api/complaints", upload.single("photo"), (req,res) => {
  const { title, description, location="", latitude, longitude } = req.body || {};
  if (!title?.trim() || !description?.trim()) return res.status(400).json({error:"Title and description are required."});
  const ai = classify(title,description);
  const code = `CP${new Date().getFullYear()}${String(Date.now()).slice(-6)}`;
  const result = db.prepare(`INSERT INTO complaints
    (complaint_code,user_id,title,description,category,priority,department,confidence,location,latitude,longitude,photo_path)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, req.user?.id || null, title.trim(), description.trim(), ai.category, ai.priority, ai.department, ai.confidence,
      location, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null, req.file ? `/uploads/${req.file.filename}` : null);
  const row = db.prepare("SELECT * FROM complaints WHERE id=?").get(result.lastInsertRowid);
  res.status(201).json({ complaint: safeComplaint(row), ai });
});
app.get("/api/complaints/track/:code", (req,res) => {
  const row = db.prepare("SELECT complaint_code,title,description,category,priority,department,status,location,latitude,longitude,photo_path,created_at,updated_at FROM complaints WHERE complaint_code=?")
    .get(req.params.code.toUpperCase().trim());
  if (!row) return res.status(404).json({error:"No complaint found with that ID."});
  res.json({ complaint:row });
});
app.get("/api/complaints/mine", auth, (req,res) => {
  const rows = db.prepare("SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json({ complaints:rows });
});
app.get("/api/admin/summary", auth, adminOnly, (_req,res) => {
  const totals = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) resolved,
    SUM(CASE WHEN status='In Progress' THEN 1 ELSE 0 END) in_progress,
    SUM(CASE WHEN status='Submitted' THEN 1 ELSE 0 END) submitted FROM complaints`).get();
  const recent = db.prepare("SELECT c.*,u.name citizen_name FROM complaints c LEFT JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 30").all();
  res.json({ totals, complaints:recent });
});
app.patch("/api/admin/complaints/:id/status", auth, adminOnly, (req,res) => {
  const allowed = ["Submitted","Under Review","In Progress","Resolved","Rejected"];
  const { status } = req.body || {};
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid complaint status."});
  const result = db.prepare("UPDATE complaints SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({error:"Complaint not found."});
  res.json({ ok:true });
});
app.post("/api/feedback", (req,res) => {
  const { complaintCode, rating, comment="" } = req.body || {};
  if (!complaintCode || !Number.isInteger(Number(rating)) || Number(rating)<1 || Number(rating)>5) return res.status(400).json({error:"Complaint ID and rating from 1 to 5 are required."});
  const complaint = db.prepare("SELECT id FROM complaints WHERE complaint_code=?").get(complaintCode.toUpperCase().trim());
  if (!complaint) return res.status(404).json({error:"Complaint not found."});
  db.prepare("INSERT INTO feedback(complaint_id,rating,comment) VALUES(?,?,?)").run(complaint.id, Number(rating), String(comment).slice(0,1000));
  res.status(201).json({ok:true});
});
app.use((err,_req,res,_next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({error:err.code==="LIMIT_FILE_SIZE"?"Image must be 5 MB or smaller.":err.message});
  res.status(400).json({error:err.message || "Request failed."});
});
app.listen(PORT, () => console.log(`CivicPulse API running at http://localhost:${PORT}`));
