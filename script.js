document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();

  const form = document.getElementById("notify-form");
  const input = document.getElementById("email");
  const message = document.getElementById("form-message");

  const showMessage = (text, type) => {
    message.textContent = text;
    message.className = `form-message ${type}`;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!input.checkValidity() || email === "") {
      showMessage("Please enter a valid email address.", "error");
      input.focus();
      return;
    }

    // Placeholder: no backend yet, so just acknowledge the signup.
    showMessage("Thanks! We'll let you know when we launch.", "success");
    form.reset();
  });
});
