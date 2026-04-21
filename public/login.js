async function login() {
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const errorBox = document.getElementById("error");
    const loginButton = document.getElementById("loginButton");

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    errorBox.innerText = "";

    if (!username || !password) {
        errorBox.innerText = "Enter both username and password.";
        return;
    }

    loginButton.disabled = true;
    loginButton.innerText = "Logging in...";

    try {
        const response = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Invalid credentials");
        }

        window.location.replace(data.redirectTo);
    } catch (error) {
        errorBox.innerText = error.message || "Login failed.";
        passwordInput.value = "";
        passwordInput.focus();
    } finally {
        loginButton.disabled = false;
        loginButton.innerText = "Login";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");

    form.addEventListener("submit", event => {
        event.preventDefault();
        login();
    });
});
