const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ACCOUNT_DIR = path.join(DATA_DIR, "accounts");
const ACCOUNT_LIST = path.join(DATA_DIR, "accounts.json");
const SECRET = process.env.SESSION_SECRET || "development-secret-key-uky";

// Ensure data folders exist
fs.mkdirSync(ACCOUNT_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNT_LIST)) {
  fs.writeFileSync(ACCOUNT_LIST, "[]");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(file, data) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

function accountPath(id) {
  return path.join(ACCOUNT_DIR, id + ".json");
}

function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function checkPassword(password, stored) {
  const [salt, original] = stored.split(":");
  if (!salt || !original) return false;
  const supplied = hashPassword(password, salt).split(":")[1];
  const a = Buffer.from(original, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function makeToken(id) {
  const expires = Date.now() + 86400000;
  const payload = id + "." + expires;
  return payload + "." + sign(payload);
}

function getLoggedInUser(req) {
  const cookies = req.headers.cookie || "";
  const cookie = cookies.split(";").map(s => s.trim()).find(s => s.startsWith("session="));
  if (!cookie) return null;
  const token = cookie.substring(8);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expires, signature] = parts;
  const payload = id + "." + expires;
  const expected = Buffer.from(sign(payload), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return null;
  }
  if (Date.now() > Number(expires)) return null;
  const accounts = readJSON(ACCOUNT_LIST);
  return accounts.find(a => a.id === id) || null;
}

function requireLogin(req, res, next) {
  const user = getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please log in first." });
  }
  req.user = user;
  next();
}

function setLoginCookie(res, id) {
  res.cookie("session", makeToken(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400000
  });
}

// CREATE ACCOUNT
app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password.trim()) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const accounts = readJSON(ACCOUNT_LIST);
  if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username already exists." });
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  const file = "accounts/" + id + ".json";

  const account = { id, username, password: passwordHash, accountFile: file };
  const userData = { id, username, password: passwordHash, survey: null };

  saveJSON(accountPath(id), userData);
  accounts.push(account);
  saveJSON(ACCOUNT_LIST, accounts);

  res.json({ message: "Account created successfully!", id });
});

// LOGIN
app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  const accounts = readJSON(ACCOUNT_LIST);
  const user = accounts.find(a => a.username === username && checkPassword(password, a.password));

  if (!user) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  setLoginCookie(res, user.id);
  res.json({ message: "Login successful", id: user.id, username: user.username });
});

// CHECK USER STATUS
app.get("/api/me", requireLogin, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ message: "Logged out" });
});

// LOAD SAVED SURVEY
app.get("/api/survey", requireLogin, (req, res) => {
  const userData = readJSON(accountPath(req.user.id));
  res.json({ survey: userData.survey });
});

// SAVE OR UPDATE SURVEY
app.post("/api/survey", requireLogin, (req, res) => {
  const body = req.body;
  const allowedYears = ["Freshman", "Sophomore", "Junior", "Senior", "Graduate"];
  const allowedMethods = ["Alone", "Group", "Both"];
  const hours = Number(body.hours);

  if (
    !allowedYears.includes(body.year) ||
    !allowedMethods.includes(body.method) ||
    body.hours === "" ||
    body.hours === null ||
    !Number.isFinite(hours) ||
    hours < 0 ||
    hours > 24
  ) {
    return res.status(400).json({ error: "Please provide valid survey entries." });
  }

  const survey = {
    name: String(body.name || "").slice(0, 100),
    year: body.year,
    method: body.method,
    hours,
    comments: String(body.comments || "").slice(0, 2000),
    music: body.music === true
  };

  const userData = readJSON(accountPath(req.user.id));
  userData.survey = survey;
  saveJSON(accountPath(req.user.id), userData);

  res.json({ message: "Survey saved successfully!" });
});

// RECORDS AND STATISTICS
app.get("/api/records", requireLogin, (req, res) => {
  const accounts = readJSON(ACCOUNT_LIST);
  const records = accounts.map(account => {
    const userData = readJSON(accountPath(account.id));
    return {
      id: account.id,
      username: account.username,
      survey: userData.survey
    };
  });

  const completed = records.filter(r => r.survey !== null);
  const totalHours = completed.reduce((sum, r) => sum + r.survey.hours, 0);
  const averageHours = completed.length ? (totalHours / completed.length
