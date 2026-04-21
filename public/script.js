let searchTimer;
let currentUsername = "";
let currentCredits = 0;
let hotspotMap;
let hotspotLayer;
let selectedCoordinates = {
    lat: null,
    lng: null
};

function predictComplaintMetadata(issueText) {
    const text = issueText.toLowerCase();
    const cleaningKeywords = ["garbage", "waste", "trash", "dump", "sewage", "drain", "clean", "sanitation", "smell"];
    const healthKeywords = ["hospital", "health", "medical", "clinic", "mosquito", "fever", "disease", "infection", "toilet", "water contamination"];
    const highKeywords = ["urgent", "danger", "collapse", "fire", "flood", "severe", "accident", "outbreak", "blocked drain", "overflow"];
    const lowKeywords = ["minor", "routine", "small", "request", "slow", "suggestion"];

    let category = "Infrastructure";
    if (cleaningKeywords.some(keyword => text.includes(keyword))) {
        category = "Cleaning";
    } else if (healthKeywords.some(keyword => text.includes(keyword))) {
        category = "Health";
    }

    let priority = "Medium";
    if (highKeywords.some(keyword => text.includes(keyword))) {
        priority = "High";
    } else if (lowKeywords.some(keyword => text.includes(keyword))) {
        priority = "Low";
    } else if (category === "Health") {
        priority = "High";
    }

    return { category, priority };
}

async function ensureUserPage() {
    try {
        const response = await fetch("/me");

        if (!response.ok) {
            window.location.replace("/");
            return false;
        }

        const user = await response.json();
        if (user.role !== "user") {
            window.location.replace(user.redirectTo);
            return false;
        }

        const usernameLabel = document.getElementById("usernameLabel");
        if (usernameLabel) {
            usernameLabel.innerText = user.username;
        }

        currentUsername = user.username || "";
        renderCredits(user.credits || 0, user.creditsToNextCoupon);

        const nameInput = document.getElementById("name");
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = currentUsername;
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

async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        if (!response.ok) {
            throw new Error("Reverse geocoding failed");
        }

        const data = await response.json();
        const address = data.address || {};

        return address.suburb
            || address.neighbourhood
            || address.village
            || address.town
            || address.city
            || address.county
            || address.state_district
            || data.display_name
            || "";
    } catch (error) {
        return "";
    }
}

async function useMyLocation() {
    const areaInput = document.getElementById("area");
    const coordsLabel = document.getElementById("coordsLabel");

    if (!navigator.geolocation) {
        showMessage("Geolocation is not supported in this browser.", "danger");
        return;
    }

    areaInput.value = "Detecting area...";
    coordsLabel.innerText = "Detecting coordinates...";

    navigator.geolocation.getCurrentPosition(
        async position => {
            const latitude = Number(position.coords.latitude.toFixed(6));
            const longitude = Number(position.coords.longitude.toFixed(6));

            selectedCoordinates = { lat: latitude, lng: longitude };

            const areaName = await reverseGeocode(latitude, longitude);
            areaInput.value = areaName || `Coordinates (${latitude}, ${longitude})`;
            coordsLabel.innerText = `Coordinates: ${latitude}, ${longitude}`;
            showToast("Location added to the complaint.");
        },
        () => {
            areaInput.value = "";
            coordsLabel.innerText = "Coordinates not captured yet.";
            showMessage("Unable to fetch your location.", "danger");
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function previewSelectedImage() {
    const preview = document.getElementById("imagePreview");
    const fileInput = document.getElementById("image");
    const file = fileInput.files[0];

    if (!file) {
        preview.className = "image-preview empty-state";
        preview.innerHTML = "No image selected";
        return;
    }

    const reader = new FileReader();
    reader.onload = event => {
        preview.className = "image-preview";
        preview.innerHTML = `<img src="${event.target.result}" alt="Complaint preview">`;
    };
    reader.readAsDataURL(file);
}

function updateAiPreview() {
    const issue = document.getElementById("issue").value.trim();
    const prediction = predictComplaintMetadata(issue || "");

    document.getElementById("aiCategoryLabel").innerText = prediction.category;
    document.getElementById("aiPriorityLabel").innerText = prediction.priority;

    const priorityBadge = document.querySelector(".ai-preview-card .priority-pill");
    priorityBadge.className = `priority-pill ${getPriorityClass(prediction.priority)}`;
    priorityBadge.innerHTML = `Priority: <span id="aiPriorityLabel" class="ms-1">${prediction.priority}</span>`;

    const categoryBadge = document.querySelector(".ai-preview-card .status-pill");
    categoryBadge.innerHTML = `Category: <span id="aiCategoryLabel" class="ms-1">${prediction.category}</span>`;
}

async function submitComplaint() {
    const name = document.getElementById("name").value.trim();
    const issue = document.getElementById("issue").value.trim();
    const area = document.getElementById("area").value.trim();
    const image = document.getElementById("image").files[0];

    if (!name || !issue || !area) {
        showMessage("Please fill all fields.", "danger");
        return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("issue", issue);
    formData.append("area", area);

    if (selectedCoordinates.lat !== null && selectedCoordinates.lng !== null) {
        formData.append("lat", selectedCoordinates.lat);
        formData.append("lng", selectedCoordinates.lng);
    }

    if (image) {
        formData.append("image", image);
    }

    try {
        const response = await fetch("/add", {
            method: "POST",
            body: formData
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || data.error || "Unable to submit complaint");
        }

        showMessage("Complaint submitted successfully.", "success");
        showToast("Complaint created.");
        showAssignmentPanel(data.complaint);
        handleRewardUpdate(data.rewards);
        clearForm();

        await Promise.all([
            loadComplaints(),
            loadRewards(),
            loadUserSummary(),
            loadHotspots()
        ]);
        scrollToSection("complaintsSection");
    } catch (error) {
        if (error.message === "Please log in first") {
            window.location.replace("/");
            return;
        }

        showMessage(error.message || "Error submitting complaint.", "danger");
    }
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

function getAffirmationCount(complaint) {
    if (typeof complaint?.affirmationCount === "number") {
        return complaint.affirmationCount;
    }
    return complaint?.affirmations ? complaint.affirmations.length : 0;
}

function getSupportText(affirmationCount) {
    return affirmationCount === 1
        ? "1 person supports this issue"
        : `${affirmationCount} people support this issue`;
}

function getCreditsToNextCoupon(credits) {
    const remainder = credits % 500;
    return remainder === 0 ? 500 : 500 - remainder;
}

function renderCredits(credits, creditsToNextCoupon = getCreditsToNextCoupon(credits)) {
    currentCredits = credits;

    const creditsValue = document.getElementById("creditsValue");
    const creditsHint = document.getElementById("creditsHint");
    const topCreditsValue = document.getElementById("topCreditsValue");

    if (creditsValue) {
        creditsValue.innerText = credits;
    }

    if (topCreditsValue) {
        topCreditsValue.innerText = `${credits}`;
    }

    if (creditsHint) {
        creditsHint.innerText = `${creditsToNextCoupon} more credits to unlock a ₹50 coupon.`;
    }
}

function renderCoupons(coupons) {
    const couponList = document.getElementById("couponList");
    if (!couponList) {
        return;
    }

    if (!coupons.length) {
        couponList.innerHTML = `
            <div class="empty-state">
                No coupons yet. Keep reporting and affirming issues to build credits faster.
            </div>
        `;
        return;
    }

    couponList.innerHTML = coupons.map(coupon => `
        <div class="coupon-card ${coupon.used ? "coupon-used" : ""}">
            <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                    <div class="coupon-label">Coupon Code</div>
                    <div class="coupon-code">${escapeHtml(coupon.code)}</div>
                </div>
                <span class="status-pill ${coupon.used ? "status-resolved" : "status-progress"}">${coupon.used ? "Used" : "Available"}</span>
            </div>
            <div class="coupon-value mb-3">₹${coupon.value || 50}</div>
            <div class="small text-muted mb-3">Issued on ${formatDate(coupon.createdAt)}</div>
            <div class="card-actions pt-0 border-0 mt-0">
                ${coupon.used
                    ? '<button class="btn btn-outline-secondary w-100" disabled>Redeemed</button>'
                    : `<button class="btn btn-outline-primary w-100" onclick="redeemCoupon('${coupon.code}')">Redeem Coupon</button>`}
            </div>
        </div>
    `).join("");
}

function handleRewardUpdate(rewards) {
    if (!rewards) {
        return;
    }

    if (typeof rewards.credits === "number") {
        renderCredits(rewards.credits);
    }

    if (Array.isArray(rewards.generatedCoupons) && rewards.generatedCoupons.length) {
        rewards.generatedCoupons.forEach(coupon => {
            showToast(`Coupon unlocked: ${coupon.code}`);
        });
    }
}

async function loadRewards() {
    if (!currentUsername) {
        return;
    }

    try {
        const [profileResponse, couponsResponse] = await Promise.all([
            fetch("/me"),
            fetch(`/coupons/${encodeURIComponent(currentUsername)}`)
        ]);

        if (profileResponse.status === 401 || couponsResponse.status === 401) {
            window.location.replace("/");
            return;
        }

        const profile = await profileResponse.json();
        const coupons = await couponsResponse.json();

        if (!profileResponse.ok) {
            throw new Error(profile.message || profile.error || "Unable to load credits");
        }
        if (!couponsResponse.ok) {
            throw new Error(coupons.message || coupons.error || "Unable to load coupons");
        }

        renderCredits(profile.credits || 0, profile.creditsToNextCoupon);
        renderCoupons(coupons);
    } catch (error) {
        showMessage(error.message || "Unable to load rewards.", "danger");
    }
}

async function redeemCoupon(code) {
    try {
        const response = await fetch(`/redeem/${encodeURIComponent(code)}`, {
            method: "POST"
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || data.error || "Unable to redeem coupon");
        }

        showToast(`Coupon ${code} redeemed.`);
        await loadRewards();
    } catch (error) {
        showMessage(error.message || "Unable to redeem coupon.", "danger");
    }
}

async function affirmComplaint(id) {
    const defaultName = currentUsername || document.getElementById("name").value.trim() || "";
    const enteredName = window.prompt("Enter your name to support this issue:", defaultName);

    if (enteredName === null) {
        return;
    }

    const name = enteredName.trim();
    if (!name) {
        showMessage("Please enter a name to affirm this issue.", "danger");
        return;
    }

    try {
        const response = await fetch(`/affirm/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || data.error || "Unable to support this complaint");
        }

        showToast("Support added to the complaint.");
        handleRewardUpdate(data.rewards);
        await Promise.all([
            loadComplaints(),
            loadRewards(),
            loadUserSummary(),
            loadHotspots()
        ]);
    } catch (error) {
        if (error.message === "Please log in first") {
            window.location.replace("/");
            return;
        }

        showMessage(error.message || "Unable to support this complaint.", "danger");
    }
}

function updateUserSummary(complaints) {
    const total = complaints.length;
    const pending = complaints.filter(complaint => complaint.status === "Pending").length;
    const resolved = complaints.filter(complaint => complaint.status === "Resolved").length;
    const highPriority = complaints.filter(complaint => complaint.priority === "High" || complaint.isOverdue).length;

    document.getElementById("userTotalCount").innerText = total;
    document.getElementById("userPendingCount").innerText = pending;
    document.getElementById("userResolvedCount").innerText = resolved;
    document.getElementById("userHighPriorityCount").innerText = highPriority;
}

async function loadUserSummary() {
    try {
        const response = await fetch("/complaints");
        if (response.status === 401) {
            window.location.replace("/");
            return;
        }

        const data = await response.json();
        updateUserSummary(Array.isArray(data) ? data : []);
    } catch (error) {
        showToast("Unable to load dashboard summary.");
    }
}

async function loadComplaints() {
    try {
        const response = await fetch(`/complaints${getFilters()}`);
        if (response.status === 401) {
            window.location.replace("/");
            return;
        }

        const data = await response.json();
        const list = document.getElementById("list");

        if (!data.length) {
            list.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">
                        No complaints match the current search or filter.
                    </div>
                </div>
            `;
            return;
        }

        list.innerHTML = data.map(complaint => {
            const location = formatLocation(complaint.location);
            const affirmationCount = getAffirmationCount(complaint);
            const canFocusMap = Boolean(complaint.location?.area);

            return `
                <div class="col-xl-6">
                    <div class="card complaint-card h-100 ${complaint.isOverdue ? "overdue-complaint" : ""}">
                        ${complaint.image ? `<img src="${complaint.image}" class="complaint-image" alt="Complaint image">` : ""}
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                                <div>
                                    <h5 class="card-title mb-1">${escapeHtml(complaint.issue)}</h5>
                                    <p class="text-muted small mb-0">Reported by ${escapeHtml(complaint.name)}</p>
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
                                    <div class="meta-tile-label">Created</div>
                                    <div class="meta-tile-value">${formatDate(complaint.createdAt)}</div>
                                </div>
                            </div>

                            <div class="card-actions">
                                <span class="support-count">👍 ${getSupportText(affirmationCount)}</span>
                                <div class="d-flex gap-2 flex-wrap">
                                    <button class="btn btn-outline-primary btn-sm" onclick="affirmComplaint('${complaint._id}')">Affirm</button>
                                    <button class="btn btn-outline-primary btn-sm" ${canFocusMap ? `onclick="focusHotspotArea('${escapeJs(complaint.location.area)}')"` : "disabled"}>View Map</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    } catch (error) {
        showMessage("Unable to load complaints.", "danger");
    }
}

function initHotspotMap() {
    if (hotspotMap || typeof L === "undefined") {
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
        initHotspotMap();
        if (!hotspotLayer) {
            return;
        }

        hotspotLayer.clearLayers();
        const response = await fetch("/hotspots");

        if (!response.ok) {
            throw new Error("Unable to load hotspots");
        }

        const hotspots = await response.json();
        const areaTitle = document.getElementById("areaPanelTitle");
        const areaList = document.getElementById("areaComplaintList");

        if (!hotspots.length) {
            areaTitle.innerText = "No complaint hotspots available yet.";
            areaList.innerHTML = `
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

async function focusHotspotArea(area) {
    scrollToSection("hotspotsSection");
    await loadHotspots();
    await loadAreaComplaints(area);
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

function clearForm() {
    document.getElementById("name").value = currentUsername;
    document.getElementById("issue").value = "";
    document.getElementById("area").value = "";
    document.getElementById("image").value = "";
    document.getElementById("coordsLabel").innerText = "Coordinates not captured yet.";
    selectedCoordinates = { lat: null, lng: null };
    previewSelectedImage();
    updateAiPreview();
}

function showAssignmentPanel(complaint) {
    const panel = document.getElementById("assignmentPanel");
    panel.classList.remove("d-none");
    document.getElementById("assignedAdminName").innerText = complaint.adminName || "-";
    document.getElementById("assignedAdminPhone").innerText = complaint.adminPhone || "-";
    document.getElementById("assignedCategory").innerText = complaint.category || "-";
    document.getElementById("assignedDeadline").innerText = formatDate(complaint.deadline);
}

function showMessage(message, type) {
    let msgBox = document.getElementById("msg");

    if (!msgBox) {
        msgBox = document.createElement("div");
        msgBox.id = "msg";
        msgBox.className = "mb-3";
        document.querySelector(".app-shell").prepend(msgBox);
    }

    msgBox.innerHTML = `
        <div class="alert alert-${type} mb-0 text-center">
            ${message}
        </div>
    `;

    setTimeout(() => {
        msgBox.innerHTML = "";
    }, 3000);
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

function escapeJs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function bindFilters() {
    document.getElementById("searchInput").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadComplaints, 250);
    });

    document.getElementById("statusFilter").addEventListener("change", loadComplaints);
    document.getElementById("image").addEventListener("change", previewSelectedImage);
    document.getElementById("issue").addEventListener("input", updateAiPreview);
}

document.addEventListener("DOMContentLoaded", async () => {
    const allowed = await ensureUserPage();
    if (!allowed) {
        return;
    }

    bindFilters();
    bindSectionNavigation();
    previewSelectedImage();
    updateAiPreview();
    initHotspotMap();

    await Promise.all([
        loadUserSummary(),
        loadComplaints(),
        loadRewards(),
        loadHotspots()
    ]);
});
