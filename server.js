const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const session = require("express-session");

const app = express();
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: "advoc-secret-key",
    resave: false,
    saveUninitialized: true,
}));

// -------------------------
// Data Files
// -------------------------
const DATA_FILE = "data.json";
const BUSINESS_DATA_FILE = "business_data.json";
const USERS_FILE = "users.json";
const DM_FILE = "dm_data.json";

// Ensure files/folders exist
[USERS_FILE, DM_FILE, DATA_FILE, BUSINESS_DATA_FILE].forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
});

["public/uploads", "public/profile_pics", "public/business_uploads"].forEach(folder => {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

// -------------------------
// Helpers
// -------------------------
const loadData = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
const saveData = (data, file) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// -------------------------
// Multer Storage
// -------------------------
const storageMain = multer.diskStorage({
    destination: "public/uploads",
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const uploadMain = multer({ storage: storageMain });

const storageBusiness = multer.diskStorage({
    destination: "public/business_uploads",
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const uploadBusiness = multer({ storage: storageBusiness });

const storageProfile = multer.diskStorage({
    destination: "public/profile_pics",
    filename: (req, file, cb) => cb(null, req.params.username + path.extname(file.originalname))
});
const uploadProfile = multer({ storage: storageProfile });

// -------------------------
// Signup / Login
// -------------------------
app.post("/signup", (req, res) => {
    const { username, password, phone } = req.body;
    let users = loadData(USERS_FILE);
    if (users.find(u => u.username === username)) return res.json({ success: false, message: "Username exists" });
    users.push({ username, password, phone });
    saveData(users, USERS_FILE);
    res.json({ success: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const users = loadData(USERS_FILE);
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.json({ success: false, message: "Invalid credentials" });
    req.session.user = user;
    res.json({ success: true });
});

app.get("/auth-check", (req, res) => {
    if (!req.session.user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, username: req.session.user.username });
});

// -------------------------
// Upload Routes
// -------------------------
app.post("/upload", uploadMain.single("media"), (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const file = req.file;
    const caption = req.body.caption || "";
    if (!file) return res.json({ success: false, message: "No file uploaded" });

    const ext = path.extname(file.originalname).toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv"].includes(ext);

    const data = loadData(DATA_FILE);
    data.push({
        filename: file.filename,
        caption,
        type: isVideo ? "video" : "image",
        likes: 0,
        comments: [],
        user: req.session.user.username
    });
    saveData(data, DATA_FILE);
    res.json({ success: true });
});

app.post("/business/upload", uploadBusiness.single("media"), (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const file = req.file;
    const caption = req.body.caption || "";
    if (!file) return res.json({ success: false, message: "No file uploaded" });

    const ext = path.extname(file.originalname).toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv"].includes(ext);

    const data = loadData(BUSINESS_DATA_FILE);
    data.push({
        filename: file.filename,
        caption,
        type: isVideo ? "video" : "image",
        likes: 0,
        comments: [],
        user: req.session.user.username
    });
    saveData(data, BUSINESS_DATA_FILE);
    res.json({ success: true });
});

// -------------------------
// Get media
// -------------------------
app.get("/images", (req, res) => {
    const data = loadData(DATA_FILE);
    const dataWithProfile = data.map(m => {
        const profileFile = fs.readdirSync("public/profile_pics")
            .find(f => f.startsWith(m.user)) || "default.png";
        return { ...m, userProfile: profileFile };
    });
    res.json(dataWithProfile);
});

app.get("/business/images", (req, res) => {
    const data = loadData(BUSINESS_DATA_FILE);
    const dataWithProfile = data.map(m => {
        const profileFile = fs.readdirSync("public/profile_pics")
            .find(f => f.startsWith(m.user)) || "default.png";
        return { ...m, userProfile: profileFile };
    });
    res.json(dataWithProfile);
});

// -------------------------
// Profile Pics
// -------------------------
app.get("/profile-pic/:username", (req, res) => {
    const file = fs.readdirSync("public/profile_pics").find(f => f.startsWith(req.params.username));
    res.json({ pic: file || "default.png" });
});

app.post("/profile-pic/:username", uploadProfile.single("profilePic"), (req, res) => {
    if (!req.session.user || req.session.user.username !== req.params.username)
        return res.json({ success: false, message: "Unauthorized" });
    res.json({ success: true, pic: req.file.filename });
});

// -------------------------
// Likes
// -------------------------
function handleLike(fileArray, filename) {
    const file = fileArray.find(f => f.filename === filename);
    if (!file) return null;
    file.likes++;
    return file.likes;
}

app.post("/like/:filename", (req, res) => {
    let data = loadData(DATA_FILE);
    let likes = handleLike(data, req.params.filename);
    if (likes === null) return res.status(404).json({ error: "File not found" });
    saveData(data, DATA_FILE);
    res.json({ likes });
});

app.post("/business/like/:filename", (req, res) => {
    let data = loadData(BUSINESS_DATA_FILE);
    let likes = handleLike(data, req.params.filename);
    if (likes === null) return res.status(404).json({ error: "File not found" });
    saveData(data, BUSINESS_DATA_FILE);
    res.json({ likes });
});

// -------------------------
// Comments
// -------------------------
function getFileByFilename(fileArray, filename) {
    return fileArray.find(f => f.filename === filename);
}

app.get("/comments/:filename", (req, res) => {
    const data = loadData(DATA_FILE);
    const file = getFileByFilename(data, req.params.filename);
    if (!file) return res.status(404).json([]);
    res.json(file.comments || []);
});

app.post("/comments/:filename", (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const { text } = req.body;
    if (!text || text.trim() === "") return res.json({ success: false, message: "Empty comment" });

    let data = loadData(DATA_FILE);
    const file = getFileByFilename(data, req.params.filename);
    if (!file) return res.status(404).json({ success: false, message: "File not found" });

    if (!file.comments) file.comments = [];
    file.comments.push({ user: req.session.user.username, text });
    saveData(data, DATA_FILE);
    res.json({ success: true, comments: file.comments });
});

app.get("/business/comments/:filename", (req, res) => {
    const data = loadData(BUSINESS_DATA_FILE);
    const file = getFileByFilename(data, req.params.filename);
    if (!file) return res.status(404).json([]);
    res.json(file.comments || []);
});

app.post("/business/comments/:filename", (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const { text } = req.body;
    if (!text || text.trim() === "") return res.json({ success: false, message: "Empty comment" });

    let data = loadData(BUSINESS_DATA_FILE);
    const file = getFileByFilename(data, req.params.filename);
    if (!file) return res.status(404).json({ success: false, message: "File not found" });

    if (!file.comments) file.comments = [];
    file.comments.push({ user: req.session.user.username, text });
    saveData(data, BUSINESS_DATA_FILE);
    res.json({ success: true, comments: file.comments });
});
// -------------------------
// Get normal media (/images)
// -------------------------
app.get("/images", (req, res) => {
    const data = loadData(DATA_FILE);

    const dataWithProfile = data.map(m => {
        const profileFile = fs
            .readdirSync("public/profile_pics")
            .find(f => f.startsWith(m.user)) || "default.png";
        
        return { ...m, userProfile: profileFile };
    });

    res.json(dataWithProfile);
});


// -------------------------
// Private DMs
// -------------------------
app.get("/dm/:user1/:user2", (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const dmData = loadData(DM_FILE);
    const messages = dmData.filter(m =>
        (m.from === req.params.user1 && m.to === req.params.user2) ||
        (m.from === req.params.user2 && m.to === req.params.user1)
    );
    res.json(messages);
});

app.post("/dm/:user1/:user2", (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: "Not logged in" });
    const { message } = req.body;
    if (!message) return res.json({ success: false, message: "Message empty" });
    const dmData = loadData(DM_FILE);
    dmData.push({ from: req.session.user.username, to: req.params.user2, message, timestamp: Date.now() });
    saveData(dmData, DM_FILE);
    res.json({ success: true });
});



// -------------------------
// Start Server
// -------------------------
app.listen(process.env.PORT || 1998, () => {
    console.log("Server running...");
});

