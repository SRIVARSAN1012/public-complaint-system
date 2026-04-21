let searchTimer;
let hotspotMap;
let hotspotLayer;

async function ensureAdminPage() {
    try {
        const response = await fetch("/me");

        if (!response.ok) {
            window.location.replace("/");
            return false;
        }

        const user = await response.json();
        if (user.role !== "admin") {
            window.location.replace(user.redirectTo);
            return false;
        }

        const usernameLabel = document.getElementById("usernameLabel");
        const topCreditsValue = document.getElementById("topCreditsValue");

        if (usernameLabel) {
            usernameLabel.innerText = user.username;
        }

        if (topCreditsValue) {
            topCreditsValue.innerText = `${user.credits || 0}`;
        }

        return true;
    } catch (error) {
        window.location.replace("/");
        return false;
    }
}

function logout() {
    window.location.replace("/logout");
}

function scrollToSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function getAffirmationCount(complaint) {
    if (typeof complaint?.affirmationCount === "number") {
        return complaint.affirmationCount;
    }

    return complaint?.affirmations ? complaint.affirmations.length : 0;
}

function getSupportText(affirmationCount) {
    return affirmationCount === 1 ? "1 supporter" : `${affirmationCount} supporters`;
}

function getFilters() {
    const search = document.getElementById("searchInput").value.trim();
    const status = document.getElementById("statusFilter").value;
    const params = new URLSearchParams();

    if (search) {
        params.set("search", search);
    }

    if (status && status !== "All") {
        params.set("status", status);
    }

    return params.toString() ? `?${params.toString()}` : "";
}

function initMap() {
    if (hotspotMap) {
        return;
    }

    hotspotMap = L.map("hotspotMap").setView([20.5937, 78.9629], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(hotspotMap);

    hotspotLayer = L.layerGroup().addTo(hotspotMap);
}

function getDensityColor(hotspot) {
    if (hotspot?.severityLevel === "High") {
        return "#dc2626";
    }

    if (hotspot?.severityLevel === "Medium") {
        return "#f97316";
    }

    return "#16a34a";
}

async function loadSummary() {
    try {
        const response = await fetch("/complaints/summary");

        if (response.status === 401) {
            window.location.replace("/");
            return;
        }

        if (response.status === 403) {
            window.location.replace("/index.html");
            return;
        }

        const data = await response.json();
        document.getElementById("totalCount").innerText = data.total;
        document.getElementById("pendingCount").innerText = data.pending;
        document.getElementById("progressCount").innerText = data.inProgress;
        document.getElementById("resolvedCount").innerText = data.resolved;
        document.getElementById("overdueCount").innerText = data.overdue;
    } catch (error) {
        showToast("Unable to load summary right now.");
    }
}

async function loadInsights() {
    try {
        const response = await fetch("/insights");
        if (!response.ok) {
            throw new Error("Unable to load insights");
        }

        const data = await response.json();
        const topAreasLabel = data.topAreas.length
            ? data.topAreas.map(item => `${item.area} (${item.count})`).join(", ")
            : "No hotspot areas yet";

        document.getElementById("topAreasInsight").innerText = topAreasLabel;
        document.getElementById("commonCategoryInsight").innerText = data.mostCommonCategory || "None";
        document.getElementById("highPriorityInsight").innerText = data.highPriorityCount ?? 0;
    } catch (error) {
        showToast("Unable to load AI insights.");
    }
}

async function loadTrending() {
    try {
        const response = await fetch("/trending");
        if (!response.ok) {
            throw new Error("Unable to load trending complaints");
        }

        const complaints = await response.json();
        const trendingList = document.getElementById("trendingList");

        if (!complaints.length) {
            trendingList.innerHTML = `
                <div class="empty-state">
                    Supported complaints will appear here once citizens begin affirming issues.
                </div>
            `;
            return;
        }

        trendingList.innerHTML = complaints.map(complaint => {
            const supportCount = getAffirmationCount(complaint);

            return `
                <div class="trending-item">
                    <div class="d-flex justify-content-between align-items-start gap-3">
                        <div>
                            <div class="fw-semibold">${escapeHtml(complaint.issue)}</div>
                            <div class="small text-muted">${escapeHtml(complaint.location?.area || "-")} | ${escapeHtml(complaint.category || "-")}</div>
                        </div>
                        <span class="priority-pill ${getPriorityClass(complaint.priority)}">${complaint.priority || "Low"}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center gap-3 mt-3">
                        <span class="support-count">👍 ${getSupportText(supportCount)}</span>
                        <span class="status-pill ${getStatusClass(complaint.status)}">${complaint.status}</span>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        showToast("Unable to load trending complaints.");
    }
}

async function loadAreaComplaints(area) {
    try {
        const response = await fetch(`/complaints/area/${encodeURIComponent(area)}`);
        if (!response.ok) {
            throw new Error("Unable to load area complaints");
        }

        const complaints = await response.json();
        document.getElementById("areaPanelTitle").innerText = `Complaints in ${area}`;
        const areaComplaintList = document.getElementById("areaComplaintList");

        if (!complaints.length) {
            areaComplaintList.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">No complaints found for this area.</div>
                </div>
            `;
            return;
        }

        areaComplaintList.innerHTML = complaints.map(complaint => {
            const supportCount = getAffirmationCount(complaint);

            return `
                <div class="col-md-6">
                    <div class="mini-complaint ${complaint.isOverdue ? "overdue-complaint" : ""}">
                        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                            <strong>${escapeHtml(complaint.issue)}</strong>
                            <span class="priority-pill ${getPriorityClass(complaint.priority)}">${complaint.priority || "Medium"}</span>
                        </div>
                        <div class="small text-muted">${escapeHtml(complaint.name)} | ${escapeHtml(complaint.category || "-")}</div>
                        <div class="small mt-3">Status: <span class="status-pill ${getStatusClass(complaint.status)}">${complaint.status}</span></div>
                        <div class="small mt-2">👍 ${getSupportText(supportCount)}</div>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        showToast("Unable to load complaints for this area.");
    }
}

async function loadHotspots() {
    try {
        initMap();
        hotspotLayer.clearLayers();

        const response = await fetch("/hotspots");
        if (!response.ok) {
            throw new Error("Unable to load hotspots");
        }

        const hotspots = await response.json();
        if (!hotspots.length) {
            document.getElementById("areaPanelTitle").innerText = "No complaint hotspots available yet.";
            document.getElementById("areaComplaintList").innerHTML = `
                <div class="col-12">
                    <div class="empty-state">Hotspot markers will appear once complaints include usable area coordinates.</div>
                </div>
            `;
            return;
        }

        const bounds = [];
        hotspots.forEach(hotspot => {
            const markerColor = getDensityColor(hotspot);
            const marker = L.circleMarker([hotspot.lat, hotspot.lng], {
                radius: 12,
                color: markerColor,
                fillColor: markerColor,
                fillOpacity: 0.82,
                weight: 2
            });

            marker.bindPopup(`
                <strong>${escapeHtml(hotspot.area)}</strong><br>
                Complaints: ${hotspot.count}<br>
                Support votes: ${hotspot.affirmationCount || 0}<br>
                Severity: ${escapeHtml(hotspot.severityLevel || "Low")}
            `);
            marker.on("click", () => loadAreaComplaints(hotspot.area));
            marker.addTo(hotspotLayer);
            bounds.push([hotspot.lat, hotspot.lng]);
        });

        if (bounds.length) {
            hotspotMap.fitBounds(bounds, { padding: [40, 40] });
        }
    } catch (error) {
        showToast("Unable to load hotspot map.");
    }
}

function formatLocation(location) {
    if (!location) {
        return { area: "-", coords: "-" };
    }

    const area = location.area || "-";
    const coords = location.lat !== null && location.lng !== null
        ? `${location.lat}, ${location.lng}`
        : "-";

    return { area, coords };
}

async function loadComplaints() {
    try {
        const response = await fetch(`/complaints${getFilters()}`);

        if (response.status === 401) {
            window.location.replace("/");
            return;
        }

        if (response.status === 403) {
            window.location.replace("/index.html");
            return;
        }

        const data = await response.json();
        const complaintGrid = document.getElementById("complaintGrid");

        if (!data.length) {
            complaintGrid.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">
                        No complaints match the current search or filter.
                    </div>
                </div>
            `;
            return;
        }

        complaintGrid.innerHTML = data.map(complaint => {
            const location = formatLocation(complaint.location);
            const affirmationCount = getAffirmationCount(complaint);

            return `
                <div class="col-xl-6">
                    <div class="card complaint-card admin-card h-100 ${complaint.isOverdue ? "overdue-complaint" : ""}">
                        ${complaint.image ? `<img src="${complaint.image}" class="complaint-image" alt="Complaint image">` : ""}
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                                <div>
                                    <h5 class="card-title mb-1">${escapeHtml(complaint.issue)}</h5>
                                    <p class="text-muted small mb-0">${escapeHtml(complaint.name)} reported this issue</p>
                                </div>
                                <div class="d-flex flex-wrap gap-2 justify-content-end complaint-badges">
                                    <span class="status-pill ${getStatusClass(complaint.status)}">${complaint.status}</span>
                                    <span class="priority-pill ${getPriorityClass(complaint.priority)}">${complaint.priority || "Medium"} Priority</span>
                                    <span class="support-pill"><i class="bi bi-hand-thumbs-up-fill"></i>${affirmationCount}</span>
                                    ${complaint.isOverdue ? '<span class="status-pill status-overdue">Overdue</span>' : ""}
                                </div>
                            </div>

                            <div class="meta-grid">
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Location</div>
                                    <div class="meta-tile-value">${escapeHtml(location.area)}</div>
                                </div>
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Coordinates</div>
                                    <div class="meta-tile-value">${escapeHtml(location.coords)}</div>
                                </div>
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Category</div>
                                    <div class="meta-tile-value">${escapeHtml(complaint.category || "-")}</div>
                                </div>
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Assigned Admin</div>
                                    <div class="meta-tile-value">${escapeHtml(complaint.adminName || "-")} (${escapeHtml(complaint.adminPhone || "-")})</div>
                                </div>
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Deadline</div>
                                    <div class="meta-tile-value">${formatDate(complaint.deadline)}</div>
                                </div>
                                <div class="meta-tile">
                                    <div class="meta-tile-label">Community Support</div>
                                    <div class="meta-tile-value">👍 ${getSupportText(affirmationCount)}</div>
                                </div>
                            </div>

                            <div class="row g-2 align-items-center mt-3">
                                <div class="col-sm-8">
                                    <select id="status-${complaint._id}" class="form-select">
                                        <option value="Pending" ${complaint.status === "Pending" ? "selected" : ""}>Pending</option>
                                        <option value="In Progress" ${complaint.status === "In Progress" ? "selected" : ""}>In Progress</option>
                                        <option value="Resolved" ${complaint.status === "Resolved" ? "selected" : ""}>Resolved</option>
                                    </select>
                                </div>
                                <div class="col-sm-4">
                                    <button class="btn btn-outline-primary w-100" onclick="saveStatus('${complaint._id}')">Save</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        showToast("Unable to load complaints.");
    }
}

async function saveStatus(id) {
    const status = document.getElementById(`status-${id}`).value;
    await updateStatus(id, status);
}

async function updateStatus(id, status) {
    try {
        const response = await fetch(`/update/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Unable to update status");
        }

        showToast("Status updated successfully.");
        await loadDashboard();
    } catch (error) {
        showToast(error.message || "Unable to update status.");
    }
}

function loadDashboard() {
    loadSummary();
    loadInsights();
    loadHotspots();
    loadTrending();
    loadComplaints();
}

function getStatusClass(status) {
    if (status === "Pending") return "status-pending";
    if (status === "In Progress") return "status-progress";
    if (status === "Overdue") return "status-overdue";
    return "status-resolved";
}

function getPriorityClass(priority) {
    if (priority === "High") return "priority-high";
    if (priority === "Low") return "priority-low";
    return "priority-medium";
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString() : "-";
}

function showToast(message) {
    const toastBox = document.getElementById("toastBox");
    const toast = document.createElement("div");

    toast.className = "app-toast";
    toast.innerText = message;
    toastBox.appendChild(toast);

    setTimeout(() => toast.classList.add("visible"), 10);
    setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => toast.remove(), 250);
    }, 2500);
}

function bindSectionNavigation() {
    const links = Array.from(document.querySelectorAll(".sidebar-link"));
    const sections = links
        .map(link => document.getElementById(link.dataset.navTarget))
        .filter(Boolean);

    links.forEach(link => {
        link.addEventListener("click", () => {
            links.forEach(item => item.classList.remove("active"));
            link.classList.add("active");
        });
    });

    if (!("IntersectionObserver" in window) || !sections.length) {
        return;
    }

    const observer = new IntersectionObserver(entries => {
        const visibleEntry = entries
            .filter(entry => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visibleEntry) {
            return;
        }

        const activeId = visibleEntry.target.id;
        links.forEach(link => {
            link.classList.toggle("active", link.dataset.navTarget === activeId);
        });
    }, {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.2, 0.4, 0.6]
    });

    sections.forEach(section => observer.observe(section));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function bindFilters() {
    document.getElementById("searchInput").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadComplaints, 250);
    });

    document.getElementById("statusFilter").addEventListener("change", loadComplaints);
}

document.addEventListener("DOMContentLoaded", async () => {
    const allowed = await ensureAdminPage();
    if (!allowed) {
        return;
    }

    bindFilters();
    bindSectionNavigation();
    initMap();
    loadDashboard();
});
