const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

// ✅ Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 🔗 MongoDB Connection (improved)
mongoose.connect("mongodb://127.0.0.1:27017/complaintsDB", {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1); // stop server if DB fails
});

// 🧱 Schema
const ComplaintSchema = new mongoose.Schema({
    name: { type: String, required: true },
    issue: { type: String, required: true },
    location: { type: String, required: true },
    status: {
        type: String,
        default: "Pending"
    }
}, { timestamps: true });

// 📦 Model
const Complaint = mongoose.model("Complaint", ComplaintSchema);

// 🏠 Test route
app.get("/", (req, res) => {
    res.send("🚀 Server running with MongoDB");
});

// ➕ Add complaint
app.post("/add", async (req, res) => {
    try {
        const { name, issue, location } = req.body;

        if (!name || !issue || !location) {
            return res.status(400).json({ message: "All fields required" });
        }

        const newComplaint = new Complaint({ name, issue, location });
        await newComplaint.save();

        res.status(201).json({ message: "Complaint Submitted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📥 Get complaints
app.get("/complaints", async (req, res) => {
    try {
        const data = await Complaint.find().sort({ createdAt: -1 });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🚀 Start server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});