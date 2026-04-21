const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/complaintsDB";
const PORT = Number(process.env.PORT) || 5000;
const isProduction = process.env.NODE_ENV === "production";
const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, "uploads");
const DEADLINE_DAYS = 2;
const RESOLVED_COMPLAINT_RETENTION_HOURS = 24;
const RESOLVED_COMPLAINT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const COMPLAINT_CREDIT_REWARD = 5;
const AFFIRM_CREDIT_REWARD = 2;
const COUPON_CREDIT_THRESHOLD = 500;
const COUPON_VALUE = 50;
const departmentAssignments = {
    Infrastructure: {
        adminName: "Infra Admin",
        adminPhone: "+91 90000 11111"
    },
    Health: {
        adminName: "Health Admin",
        adminPhone: "+91 90000 22222"
    },
    Cleaning: {
        adminName: "Sanitation Admin",
        adminPhone: "+91 90000 33333"
    }
};

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

if (isProduction) {
    app.set("trust proxy", 1);
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension)
            .replace(/[^a-zA-Z0-9-_]/g, "-")
            .toLowerCase();

        cb(null, `${Date.now()}-${baseName}${extension}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
            return;
        }

        cb(new Error("Only image uploads are allowed"));
    }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));

function calculateDeadline(fromDate = new Date()) {
    const deadline = new Date(fromDate);
    deadline.setDate(deadline.getDate() + DEADLINE_DAYS);
    return deadline;
}

const LocationSchema = new mongoose.Schema({
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    area: { type: String, default: "" }
}, { _id: false });

const ComplaintSchema = new mongoose.Schema({
    name: { type: String, required: true },
    issue: { type: String, required: true },
    location: {
        type: LocationSchema,
        default: () => ({ lat: null, lng: null, area: "" })
    },
    category: {
        type: String,
        enum: ["Infrastructure", "Health", "Cleaning"],
        default: "Infrastructure"
    },
    adminName: {
        type: String,
        default: departmentAssignments.Infrastructure.adminName
    },
    adminPhone: {
        type: String,
        default: departmentAssignments.Infrastructure.adminPhone
    },
    image: { type: String, default: "" },
    affirmations: {
        type: [
            new mongoose.Schema({
                name: { type: String, required: true, trim: true }
            }, { _id: false })
        ],
        default: []
    },
    priority: {
        type: String,
        enum: ["High", "Medium", "Low"],
        default: "Medium"
    },
    deadline: {
        type: Date,
        default: calculateDeadline
    },
    isOverdue: {
        type: Boolean,
        default: false
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        default: "Pending"
    }
}, { timestamps: true });

const Complaint = mongoose.model("Complaint", ComplaintSchema);

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    role: {
        type: String,
        enum: ["admin", "user"],
        default: "user"
    },
    credits: {
        type: Number,
        default: 0,
        min: 0
    }
}, { timestamps: true });

const CouponSchema = new mongoose.Schema({
    userName: { type: String, required: true, trim: true, index: true },
    code: { type: String, required: true, unique: true, trim: true },
    value: { type: Number, default: COUPON_VALUE },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const User = mongoose.model("User", UserSchema);
const Coupon = mongoose.model("Coupon", CouponSchema);

const users = [
    { username: "admin", password: "admin123", role: "admin" },
    { username: "user", password: "user123", role: "user" }
];

function parseCookies(req) {
    const header = req.headers.cookie;

    if (!header) {
        return {};
    }

    return header.split(";").reduce((cookies, part) => {
        const [rawKey, ...rawValue] = part.trim().split("=");

        if (!rawKey) {
            return cookies;
        }

        cookies[rawKey] = decodeURIComponent(rawValue.join("=") || "");
        return cookies;
    }, {});
}

function getCurrentUser(req) {
    const cookies = parseCookies(req);
    const username = cookies.authUser;
    const role = cookies.authRole;

    if (!username || !role) {
        return null;
    }

    return users.find(user => user.username === username && user.role === role) || null;
}

function setAuthCookies(res, user) {
    const cookieOptions = ["Path=/", "HttpOnly", "SameSite=Lax"];

    if (isProduction) {
        cookieOptions.push("Secure");
    }

    res.setHeader("Set-Cookie", [
        `authUser=${encodeURIComponent(user.username)}; ${cookieOptions.join("; ")}`,
        `authRole=${encodeURIComponent(user.role)}; ${cookieOptions.join("; ")}`
    ]);
}

function clearAuthCookies(res) {
    res.setHeader("Set-Cookie", [
        "authUser=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        "authRole=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    ]);
}

function getRedirectPath(user) {
    return user.role === "admin" ? "/admin.html" : "/index.html";
}

function requireAuth(req, res, next) {
    const user = getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ message: "Please log in first" });
    }

    req.user = user;
    next();
}

function requireAdmin(req, res, next) {
    const user = getCurrentUser(req);

    if (!user) {
        return res.status(401).json({ message: "Please log in first" });
    }

    if (user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }

    req.user = user;
    next();
}

function serveProtectedPage(expectedRole, pageName) {
    return (req, res) => {
        const user = getCurrentUser(req);

        if (!user) {
            return res.redirect("/");
        }

        if (expectedRole && user.role !== expectedRole) {
            return res.redirect(getRedirectPath(user));
        }

        return res.sendFile(path.join(__dirname, "public", pageName));
    };
}

function getDepartmentAssignment(category) {
    return departmentAssignments[category] || departmentAssignments.Infrastructure;
}

function inferCategory(issueText) {
    const text = issueText.toLowerCase();

    const cleaningKeywords = ["garbage", "waste", "trash", "dump", "sewage", "drain", "clean", "sanitation", "smell"];
    const healthKeywords = ["hospital", "health", "medical", "clinic", "mosquito", "fever", "disease", "infection", "toilet", "water contamination"];
    const infrastructureKeywords = ["road", "pothole", "streetlight", "bridge", "electric", "power", "water supply", "pipe", "building", "traffic"];

    if (cleaningKeywords.some(keyword => text.includes(keyword))) {
        return "Cleaning";
    }

    if (healthKeywords.some(keyword => text.includes(keyword))) {
        return "Health";
    }

    if (infrastructureKeywords.some(keyword => text.includes(keyword))) {
        return "Infrastructure";
    }

    return "Infrastructure";
}

function inferPriority(issueText, category) {
    const text = issueText.toLowerCase();
    const highKeywords = ["urgent", "danger", "collapse", "fire", "flood", "severe", "accident", "outbreak", "blocked drain", "overflow"];
    const lowKeywords = ["minor", "routine", "small", "request", "slow", "suggestion"];

    if (highKeywords.some(keyword => text.includes(keyword))) {
        return "High";
    }

    if (lowKeywords.some(keyword => text.includes(keyword))) {
        return "Low";
    }

    if (category === "Health") {
        return "High";
    }

    if (category === "Cleaning") {
        return "Medium";
    }

    return "Medium";
}

function inferAffirmationPriority(affirmationCount) {
    if (affirmationCount > 5) {
        return "High";
    }

    if (affirmationCount > 2) {
        return "Medium";
    }

    return "Low";
}

function affirmationCountToScore(affirmationCount) {
    if (affirmationCount > 5) {
        return 3;
    }

    if (affirmationCount > 2) {
        return 2;
    }

    return 1;
}

function priorityToScore(priority) {
    if (priority === "High") {
        return 3;
    }

    if (priority === "Medium") {
        return 2;
    }

    return 1;
}

function resolvePriority(...priorities) {
    const validPriorities = priorities.filter(Boolean);

    if (!validPriorities.length) {
        return "Low";
    }

    return validPriorities.reduce((highest, current) => (
        priorityToScore(current) > priorityToScore(highest) ? current : highest
    ));
}

function getAffirmationCount(complaint) {
    return Array.isArray(complaint?.affirmations) ? complaint.affirmations.length : 0;
}

function getCreditsToNextCoupon(credits = 0) {
    const normalizedCredits = Number.isFinite(credits) ? credits : 0;
    const remainder = normalizedCredits % COUPON_CREDIT_THRESHOLD;
    return remainder === 0
        ? COUPON_CREDIT_THRESHOLD
        : COUPON_CREDIT_THRESHOLD - remainder;
}

function serializeCoupon(coupon) {
    const plainCoupon = typeof coupon?.toObject === "function"
        ? coupon.toObject()
        : coupon;

    return {
        ...plainCoupon
    };
}

function serializeComplaint(complaint) {
    const plainComplaint = typeof complaint?.toObject === "function"
        ? complaint.toObject()
        : complaint;

    return {
        ...plainComplaint,
        affirmationCount: getAffirmationCount(plainComplaint)
    };
}

async function ensureUserAccount(username, role = "user") {
    if (!username) {
        return null;
    }

    return User.findOneAndUpdate(
        { username },
        {
            $set: { role },
            $setOnInsert: { credits: 0 }
        },
        {
            new: true,
            upsert: true
        }
    );
}

function generateCouponCode() {
    return `GOVT${Math.floor(100000 + Math.random() * 900000)}`;
}

async function createUniqueCoupon(userName, value = COUPON_VALUE) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = generateCouponCode();

        try {
            const coupon = await Coupon.create({
                userName,
                code,
                value,
                used: false
            });

            return coupon;
        } catch (error) {
            if (error?.code === 11000) {
                continue;
            }

            throw error;
        }
    }

    throw new Error("Unable to generate a unique coupon code");
}

async function awardCreditsAndGenerateCoupons(username, role, creditAmount) {
    const userAccount = await ensureUserAccount(username, role);
    const earnedCredits = Number.isFinite(creditAmount) ? creditAmount : 0;

    if (!userAccount || earnedCredits <= 0) {
        return {
            user: userAccount,
            generatedCoupons: []
        };
    }

    userAccount.credits += earnedCredits;

    const generatedCoupons = [];

    while (userAccount.credits >= COUPON_CREDIT_THRESHOLD) {
        userAccount.credits -= COUPON_CREDIT_THRESHOLD;
        const coupon = await createUniqueCoupon(userAccount.username, COUPON_VALUE);
        generatedCoupons.push(serializeCoupon(coupon));
    }

    await userAccount.save();

    return {
        user: userAccount,
        generatedCoupons
    };
}

async function syncDefaultUsers() {
    await Promise.all(
        users.map(user => ensureUserAccount(user.username, user.role))
    );
}

function inferComplaintMetadata(issue, affirmationCount = 0) {
    const category = inferCategory(issue);
    const keywordPriority = inferPriority(issue, category);
    const communityPriority = inferAffirmationPriority(affirmationCount);
    const priority = resolvePriority(keywordPriority, communityPriority);
    return { category, priority };
}

function getHotspotSeverity(complaintCount, affirmationCount) {
    const normalizedComplaintCount = Number.isFinite(complaintCount) ? complaintCount : 0;
    const normalizedAffirmationCount = Number.isFinite(affirmationCount) ? affirmationCount : 0;
    const severityScore = normalizedComplaintCount + affirmationCountToScore(normalizedAffirmationCount);

    if (normalizedComplaintCount >= 5 || normalizedAffirmationCount >= 6 || severityScore >= 8) {
        return { severityScore, severityLevel: "High" };
    }

    if (normalizedComplaintCount >= 3 || normalizedAffirmationCount >= 3 || severityScore >= 5) {
        return { severityScore, severityLevel: "Medium" };
    }

    return { severityScore, severityLevel: "Low" };
}

function parseCoordinate(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractCoordinatesFromArea(area) {
    const text = (area || "").trim();

    if (!text) {
        return { lat: null, lng: null };
    }

    const directMatch = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (directMatch) {
        return {
            lat: parseCoordinate(directMatch[1]),
            lng: parseCoordinate(directMatch[2])
        };
    }

    const wrappedMatch = text.match(/coordinates\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
    if (wrappedMatch) {
        return {
            lat: parseCoordinate(wrappedMatch[1]),
            lng: parseCoordinate(wrappedMatch[2])
        };
    }

    return { lat: null, lng: null };
}

function normalizeArea(area, lat, lng) {
    const trimmedArea = (area || "").trim();

    if (trimmedArea) {
        return trimmedArea;
    }

    if (lat !== null && lng !== null) {
        return `Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }

    return "";
}

function isComplaintOverdue(complaint, now = new Date()) {
    if (!complaint || !complaint.deadline) {
        return false;
    }

    return complaint.status !== "Resolved" && new Date(complaint.deadline) < now;
}

async function refreshOverdueComplaints() {
    const now = new Date();

    await Promise.all([
        Complaint.updateMany(
            {
                status: { $ne: "Resolved" },
                deadline: { $lt: now },
                isOverdue: { $ne: true }
            },
            { $set: { isOverdue: true } }
        ),
        Complaint.updateMany(
            {
                $or: [
                    { status: "Resolved" },
                    { deadline: { $gte: now } }
                ],
                isOverdue: true
            },
            { $set: { isOverdue: false } }
        )
    ]);
}

function getResolvedComplaintExpiryDate(now = new Date()) {
    return new Date(now.getTime() - (RESOLVED_COMPLAINT_RETENTION_HOURS * 60 * 60 * 1000));
}

async function purgeExpiredResolvedComplaints(now = new Date()) {
    const expiryDate = getResolvedComplaintExpiryDate(now);

    const result = await Complaint.deleteMany({
        status: "Resolved",
        resolvedAt: {
            $ne: null,
            $lt: expiryDate
        }
    });

    if (result.deletedCount > 0) {
        console.log(`Deleted ${result.deletedCount} resolved complaints older than ${RESOLVED_COMPLAINT_RETENTION_HOURS} hours`);
    }

    return result;
}

function buildComplaintFilters(query) {
    const filters = {};
    const search = (query.search || "").trim();
    const status = (query.status || "").trim();

    if (search) {
        filters.issue = { $regex: search, $options: "i" };
    }

    if (status === "Overdue") {
        filters.isOverdue = true;
    } else if (status && status !== "All") {
        filters.status = status;
    }

    return filters;
}

async function migrateLegacyComplaints() {
    await Complaint.collection.updateMany(
        { location: { $type: "string" } },
        [
            {
                $set: {
                    location: {
                        lat: null,
                        lng: null,
                        area: "$location"
                    }
                }
            }
        ]
    );

    const complaints = await Complaint.find({});

    for (const complaint of complaints) {
        let changed = false;
        const currentArea = complaint.location?.area || "";
        const extractedCoordinates = extractCoordinatesFromArea(currentArea);

        if ((complaint.location?.lat === null || complaint.location?.lat === undefined) && extractedCoordinates.lat !== null) {
            complaint.location.lat = extractedCoordinates.lat;
            changed = true;
        }

        if ((complaint.location?.lng === null || complaint.location?.lng === undefined) && extractedCoordinates.lng !== null) {
            complaint.location.lng = extractedCoordinates.lng;
            changed = true;
        }

        if (!complaint.category) {
            const metadata = inferComplaintMetadata(complaint.issue || "", getAffirmationCount(complaint));
            complaint.category = metadata.category;
            complaint.priority = complaint.priority || metadata.priority;
            const assignment = getDepartmentAssignment(metadata.category);
            complaint.adminName = assignment.adminName;
            complaint.adminPhone = assignment.adminPhone;
            changed = true;
        }

        if (!Array.isArray(complaint.affirmations)) {
            complaint.affirmations = [];
            changed = true;
        }

        if (!complaint.priority) {
            const metadata = inferComplaintMetadata(complaint.issue || "", getAffirmationCount(complaint));
            complaint.priority = metadata.priority;
            changed = true;
        }

        if (!complaint.adminName || !complaint.adminPhone) {
            const assignment = getDepartmentAssignment(complaint.category || inferComplaintMetadata(complaint.issue || "", getAffirmationCount(complaint)).category);
            complaint.adminName = assignment.adminName;
            complaint.adminPhone = assignment.adminPhone;
            changed = true;
        }

        const recalculatedPriority = inferComplaintMetadata(complaint.issue || "", getAffirmationCount(complaint)).priority;
        if (complaint.priority !== recalculatedPriority) {
            complaint.priority = recalculatedPriority;
            changed = true;
        }

        if (!complaint.deadline) {
            complaint.deadline = calculateDeadline(complaint.createdAt || new Date());
            changed = true;
        }

        if (complaint.status === "Resolved" && !complaint.resolvedAt) {
            complaint.resolvedAt = complaint.updatedAt || complaint.createdAt || new Date();
            changed = true;
        }

        if (complaint.status !== "Resolved" && complaint.resolvedAt !== null) {
            complaint.resolvedAt = null;
            changed = true;
        }

        const overdueValue = isComplaintOverdue(complaint);
        if (complaint.isOverdue !== overdueValue) {
            complaint.isOverdue = overdueValue;
            changed = true;
        }

        if (changed) {
            await complaint.save();
        }
    }
}

app.get("/", (req, res) => {
    const user = getCurrentUser(req);

    if (user) {
        return res.redirect(getRedirectPath(user));
    }

    return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login.html", (req, res) => {
    const user = getCurrentUser(req);

    if (user) {
        return res.redirect(getRedirectPath(user));
    }

    return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/index.html", serveProtectedPage("user", "index.html"));
app.get("/admin.html", serveProtectedPage("admin", "admin.html"));

app.get("/me", (req, res) => {
    Promise.resolve().then(async () => {
        const user = getCurrentUser(req);

        if (!user) {
            return res.status(401).json({ message: "Not logged in" });
        }

        const userAccount = await ensureUserAccount(user.username, user.role);

        return res.json({
            username: user.username,
            role: user.role,
            redirectTo: getRedirectPath(user),
            credits: userAccount?.credits || 0,
            creditsToNextCoupon: getCreditsToNextCoupon(userAccount?.credits || 0)
        });
    }).catch(err => res.status(500).json({ error: err.message }));
});

app.post("/login", (req, res) => {
    Promise.resolve().then(async () => {
        const body = req.body || {};
        const username = (body.username || "").trim();
        const password = (body.password || "").trim();

        const user = users.find(
            item => item.username === username && item.password === password
        );

        if (!user) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const userAccount = await ensureUserAccount(user.username, user.role);

        setAuthCookies(res, user);

        return res.json({
            role: user.role,
            redirectTo: getRedirectPath(user),
            credits: userAccount?.credits || 0
        });
    }).catch(err => res.status(500).json({ error: err.message }));
});

app.post("/logout", (_req, res) => {
    clearAuthCookies(res);
    return res.json({
        message: "Logged out successfully",
        redirectTo: "/login.html"
    });
});

app.get("/logout", (_req, res) => {
    clearAuthCookies(res);
    return res.redirect("/login.html");
});

app.get("/health", (_req, res) => {
    return res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/add", requireAuth, upload.single("image"), async (req, res) => {
    try {
        console.log("Add complaint payload:", req.body, req.file);

        const {
            name: rawName = "",
            issue: rawIssue = "",
            area: rawArea = "",
            lat: rawLat = "",
            lng: rawLng = ""
        } = req.body || {};

        const name = rawName.trim();
        const issue = rawIssue.trim();
        const lat = parseCoordinate(rawLat);
        const lng = parseCoordinate(rawLng);
        const area = normalizeArea(rawArea, lat, lng);

        if (!name || !issue || !area) {
            return res.status(400).json({ message: "All fields required" });
        }

        const aiMetadata = inferComplaintMetadata(issue, 0);
        const assignedDepartment = getDepartmentAssignment(aiMetadata.category);

        const newComplaint = new Complaint({
            name,
            issue,
            location: {
                lat,
                lng,
                area
            },
            category: aiMetadata.category,
            adminName: assignedDepartment.adminName,
            adminPhone: assignedDepartment.adminPhone,
            affirmations: [],
            priority: aiMetadata.priority,
            deadline: calculateDeadline(),
            isOverdue: false,
            image: req.file ? `/uploads/${req.file.filename}` : ""
        });

        await newComplaint.save();
        const rewardUpdate = await awardCreditsAndGenerateCoupons(
            req.user.username,
            req.user.role,
            COMPLAINT_CREDIT_REWARD
        );

        return res.status(201).json({
            message: "Complaint submitted",
            complaint: serializeComplaint(newComplaint),
            rewards: {
                credits: rewardUpdate.user?.credits || 0,
                earnedCredits: COMPLAINT_CREDIT_REWARD,
                generatedCoupons: rewardUpdate.generatedCoupons
            }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post("/affirm/:id", requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        console.log("Affirm request body:", body);

        const supporterName = typeof body.name === "string"
            ? body.name.trim()
            : "";

        if (!supporterName) {
            return res.status(400).json({ message: "Supporter name is required" });
        }

        const complaint = await Complaint.findById(req.params.id);

        if (!complaint) {
            return res.status(404).json({ message: "Complaint not found" });
        }

        if (!Array.isArray(complaint.affirmations)) {
            complaint.affirmations = [];
        }

        const hasAlreadyAffirmed = complaint.affirmations.some(entry => (
            (entry.name || "").trim().toLowerCase() === supporterName.toLowerCase()
        ));

        if (hasAlreadyAffirmed) {
            return res.status(409).json({ message: "This user already supported the complaint" });
        }

        complaint.affirmations.push({ name: supporterName });
        complaint.priority = inferComplaintMetadata(complaint.issue || "", getAffirmationCount(complaint)).priority;
        await complaint.save();
        console.log("Affirmation count after save:", complaint.affirmations.length);
        const rewardUpdate = await awardCreditsAndGenerateCoupons(
            req.user.username,
            req.user.role,
            AFFIRM_CREDIT_REWARD
        );

        return res.json({
            message: "Support recorded successfully",
            affirmationCount: complaint.affirmations.length,
            complaint: serializeComplaint(complaint),
            rewards: {
                credits: rewardUpdate.user?.credits || 0,
                earnedCredits: AFFIRM_CREDIT_REWARD,
                generatedCoupons: rewardUpdate.generatedCoupons
            }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/coupons/:name", requireAuth, async (req, res) => {
    try {
        const requestedName = (req.params.name || "").trim();

        if (!requestedName) {
            return res.status(400).json({ message: "User name is required" });
        }

        if (req.user.role !== "admin" && req.user.username !== requestedName) {
            return res.status(403).json({ message: "You can only view your own coupons" });
        }

        await ensureUserAccount(requestedName, req.user.username === requestedName ? req.user.role : "user");

        const coupons = await Coupon.find({ userName: requestedName }).sort({ createdAt: -1 });
        return res.json(coupons.map(serializeCoupon));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post("/redeem/:code", requireAuth, async (req, res) => {
    try {
        const couponCode = (req.params.code || "").trim().toUpperCase();

        if (!couponCode) {
            return res.status(400).json({ message: "Coupon code is required" });
        }

        const coupon = await Coupon.findOne({ code: couponCode });

        if (!coupon) {
            return res.status(404).json({ message: "Coupon not found" });
        }

        if (req.user.role !== "admin" && coupon.userName !== req.user.username) {
            return res.status(403).json({ message: "You can only redeem your own coupons" });
        }

        if (coupon.used) {
            return res.status(409).json({ message: "Coupon has already been used" });
        }

        coupon.used = true;
        await coupon.save();

        return res.json({
            message: "Coupon redeemed successfully",
            coupon: serializeCoupon(coupon)
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/complaints/summary", requireAdmin, async (_req, res) => {
    try {
        await refreshOverdueComplaints();

        const [total, pending, inProgress, resolved, overdue] = await Promise.all([
            Complaint.countDocuments(),
            Complaint.countDocuments({ status: "Pending" }),
            Complaint.countDocuments({ status: "In Progress" }),
            Complaint.countDocuments({ status: "Resolved" }),
            Complaint.countDocuments({ isOverdue: true })
        ]);

        return res.json({
            total,
            pending,
            inProgress,
            resolved,
            overdue
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/complaints", requireAuth, async (req, res) => {
    try {
        await refreshOverdueComplaints();
        const filters = buildComplaintFilters(req.query);
        const data = await Complaint.find(filters).sort({ createdAt: -1 });
        return res.json(data.map(serializeComplaint));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/complaints/area/:area", requireAdmin, async (req, res) => {
    try {
        await refreshOverdueComplaints();
        const area = decodeURIComponent(req.params.area);
        const complaints = await Complaint.find({ "location.area": area }).sort({ createdAt: -1 });
        return res.json(complaints.map(serializeComplaint));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/hotspots", requireAdmin, async (_req, res) => {
    try {
        await migrateLegacyComplaints();
        const rawHotspots = await Complaint.aggregate([
            {
                $match: {
                    "location.area": { $nin: ["", null] },
                    "location.lat": { $type: "number" },
                    "location.lng": { $type: "number" }
                }
            },
            {
                $group: {
                    _id: "$location.area",
                    count: { $sum: 1 },
                    affirmationCount: {
                        $sum: {
                            $size: { $ifNull: ["$affirmations", []] }
                        }
                    },
                    lat: { $avg: "$location.lat" },
                    lng: { $avg: "$location.lng" }
                }
            },
            {
                $project: {
                    _id: 0,
                    area: "$_id",
                    count: 1,
                    affirmationCount: 1,
                    lat: 1,
                    lng: 1
                }
            },
            { $sort: { affirmationCount: -1, count: -1 } }
        ]);

        const hotspots = rawHotspots
            .map(hotspot => ({
                ...hotspot,
                ...getHotspotSeverity(hotspot.count, hotspot.affirmationCount)
            }))
            .sort((left, right) => (
                right.severityScore - left.severityScore
                || right.affirmationCount - left.affirmationCount
                || right.count - left.count
            ));

        return res.json(hotspots);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/trending", requireAdmin, async (_req, res) => {
    try {
        await migrateLegacyComplaints();

        const complaints = await Complaint.aggregate([
            {
                $addFields: {
                    affirmationCount: {
                        $size: { $ifNull: ["$affirmations", []] }
                    }
                }
            },
            { $sort: { affirmationCount: -1, createdAt: -1 } },
            { $limit: 8 }
        ]);

        return res.json(complaints);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/insights", requireAdmin, async (_req, res) => {
    try {
        await migrateLegacyComplaints();
        const [topAreas, topCategory, highPriorityCount] = await Promise.all([
            Complaint.aggregate([
                {
                    $match: {
                        "location.area": { $nin: ["", null] }
                    }
                },
                {
                    $group: {
                        _id: "$location.area",
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 3 },
                {
                    $project: {
                        _id: 0,
                        area: "$_id",
                        count: 1
                    }
                }
            ]),
            Complaint.aggregate([
                {
                    $match: {
                        category: { $nin: [null, ""] }
                    }
                },
                {
                    $group: {
                        _id: "$category",
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]),
            Complaint.countDocuments({ priority: "High" })
        ]);

        return res.json({
            topAreas,
            mostCommonCategory: topCategory[0]?._id || "None",
            highPriorityCount
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.put("/update/:id", requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const status = (body.status || "").trim();
        const complaint = await Complaint.findById(req.params.id);
        const now = new Date();

        if (!status) {
            return res.status(400).json({ message: "Status is required" });
        }

        if (!complaint) {
            return res.status(404).json({ message: "Complaint not found" });
        }

        complaint.status = status;
        complaint.resolvedAt = status === "Resolved" ? now : null;
        complaint.isOverdue = isComplaintOverdue(complaint);
        await complaint.save();

        return res.json({
            message: "Status updated",
            complaint: serializeComplaint(complaint)
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.use((err, _req, res, next) => {
    if (!err) {
        next();
        return;
    }

    console.error("Unhandled request error:", err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: err.message });
    }

    if (err.message === "Only image uploads are allowed") {
        return res.status(400).json({ message: err.message });
    }

    return res.status(500).json({ message: "Something went wrong" });
});

async function startServer() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("MongoDB connected");
        await Promise.all([
            User.init(),
            Coupon.init()
        ]);
        await syncDefaultUsers();
        await migrateLegacyComplaints();
        await purgeExpiredResolvedComplaints();

        setInterval(() => {
            purgeExpiredResolvedComplaints().catch(err => {
                console.error("Resolved complaint cleanup failed:", err);
            });
        }, RESOLVED_COMPLAINT_CLEANUP_INTERVAL_MS);

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("MongoDB error:", err);
        process.exit(1);
    }
}

startServer();
