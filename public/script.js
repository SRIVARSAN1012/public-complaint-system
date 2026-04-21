// 🚀 Submit Complaint
function submitComplaint() {
    const name = document.getElementById("name").value.trim();
    const issue = document.getElementById("issue").value.trim();
    const location = document.getElementById("location").value.trim();

    // ✅ Simple validation
    if (!name || !issue || !location) {
        showMessage("⚠️ Please fill all fields", "danger");
        return;
    }

    fetch("/add", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, issue, location })
    })
    .then(res => res.text())
    .then(data => {
        showMessage("✅ Complaint submitted successfully", "success");
        clearForm();
        loadComplaints();
    })
    .catch(err => {
        showMessage("❌ Error submitting complaint", "danger");
        console.log(err);
    });
}


// 📥 Load Complaints
function loadComplaints() {
    fetch("/complaints")
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("list");
        list.innerHTML = "";

        if (data.length === 0) {
            list.innerHTML = `<li class="list-group-item text-center">No complaints yet</li>`;
            return;
        }

        data.reverse().forEach(c => {
            list.innerHTML += `
                <li class="list-group-item">
                    <div class="d-flex justify-content-between">
                        <strong>${c.name}</strong>
                        <span class="badge ${getStatusColor(c.status)}">${c.status}</span>
                    </div>
                    <div>${c.issue}</div>
                    <small class="text-muted">📍 ${c.location}</small>
                </li>
            `;
        });
    })
    .catch(err => console.log(err));
}


// 🎨 Status Color
function getStatusColor(status) {
    if (status === "Pending") return "bg-warning";
    if (status === "Resolved") return "bg-success";
    return "bg-secondary";
}


// 🧹 Clear Form
function clearForm() {
    document.getElementById("name").value = "";
    document.getElementById("issue").value = "";
    document.getElementById("location").value = "";
}


// 🔔 Show Message (better than alert)
function showMessage(message, type) {
    let msgBox = document.getElementById("msg");

    if (!msgBox) {
        msgBox = document.createElement("div");
        msgBox.id = "msg";
        msgBox.className = "mt-3";
        document.querySelector(".container").prepend(msgBox);
    }

    msgBox.innerHTML = `
        <div class="alert alert-${type} text-center">
            ${message}
        </div>
    `;

    // Auto remove after 3 sec
    setTimeout(() => {
        msgBox.innerHTML = "";
    }, 3000);
}


// 🔄 Auto load on page open
window.onload = loadComplaints;