document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;

  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    },
  };

  document.getElementById("year").textContent = new Date().getFullYear();

  // Theme toggle: follows the system setting until the visitor picks one.
  const toggle = document.getElementById("theme-toggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  const activeTheme = () =>
    root.getAttribute("data-theme") || (systemDark.matches ? "dark" : "light");

  const syncToggle = () => {
    const theme = activeTheme();
    root.setAttribute("data-active-theme", theme);
    toggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  };

  toggle.addEventListener("click", () => {
    const next = activeTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    storage.set("theme", next);
    syncToggle();
  });

  systemDark.addEventListener("change", syncToggle);
  syncToggle();

  // Entrance animation.
  const revealed = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    revealed.forEach((el) => observer.observe(el));
  } else {
    revealed.forEach((el) => el.classList.add("is-visible"));
  }

  // Notify form.
  const form = document.getElementById("notify-form");
  const input = document.getElementById("email");
  const message = document.getElementById("form-message");

  const showMessage = (text, type) => {
    message.textContent = text;
    message.className = `form-message ${type}`;
  };

  const savedEmail = storage.get("notifyEmail");
  if (savedEmail) {
    showMessage(`You're on the list as ${savedEmail}.`, "success");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!input.checkValidity() || email === "") {
      showMessage("Please enter a valid email address.", "error");
      input.focus();
      return;
    }

    // Placeholder: no backend yet, so remember the signup locally and acknowledge it.
    storage.set("notifyEmail", email);
    showMessage(`Thanks! We'll email ${email} when gabarker.com launches.`, "success");
    form.reset();
  });
});
