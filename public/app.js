const page = document.body.dataset.page;

async function api(url, method = "GET", data = null) {
  const options = {
    method,
    headers: {}
  };
  if (data !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Something went wrong.");
  }
  return result;
}

function showMessage(text, error = false) {
  const element = document.getElementById("message");
  if (element) {
    element.textContent = text;
    element.className = error ? "message error" : "message success";
  }
}

if (page === "login") {
  const form = document.getElementById("loginForm");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const remember = document.getElementById("remember");

  remember.checked = localStorage.getItem("remember") === "true";
  if (remember.checked) {
    username.value = localStorage.getItem("savedUsername") || "";
  }

  function saveRememberSettings() {
    localStorage.setItem("remember", remember.checked);
    if (remember.checked) {
      localStorage.setItem("savedUsername", username.value);
    } else {
      localStorage.removeItem("savedUsername");
    }
  }

  remember.addEventListener("change", saveRememberSettings);
  username.addEventListener("input", () => {
    if (remember.checked) saveRememberSettings();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveRememberSettings();
    try {
      await api("/api/login", "POST", { username: username.value, password: password.value });
      window.location.href = "form.html";
    } catch (error) {
      alert(error.message);
      showMessage(error.message, true);
    }
  });
}

if (page === "register") {
  const form = document.getElementById("registerForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    if (!username.trim() || !password.trim()) {
      alert("Username and password cannot be empty.");
      return;
    }
    try {
      const result = await api("/api/register", "POST", { username, password });
      showMessage("Account created! Your ID is " + result.id);
      form.reset();
      const link = document.createElement("a");
      link.href = "index.html";
      link.textContent = " Continue to Login";
      document.getElementById("message").appendChild(link);
    } catch (error) {
      alert(error.message);
      showMessage(error.message, true);
    }
  });
}

async function checkLogin() {
  try {
    return await api("/api/me");
  } catch (error) {
    window.location.href = "index.html";
    throw error;
  }
}

if (page === "form" || page === "records") {
  document.querySelectorAll(".logout").forEach(button => {
    button.addEventListener("click", async () => {
      await api("/api/logout", "POST");
      window.location.href = "index.html";
    });
  });
}

if (page === "form") {
  const form = document.getElementById("surveyForm");

  async function loadSurvey() {
    try {
      const user = await checkLogin();
      document.getElementById("welcome").textContent = "Logged in as " + user.username;
      const result = await api("/api/survey");
      const saved = result.survey;
      if (!saved) return;

      document.getElementById("name").value = saved.name;
      document.getElementById("year").value = saved.year;
      document.getElementById("hours").value = saved.hours;
      document.getElementById("comments").value = saved.comments;
      document.getElementById("music").checked = saved.music;
      const selected = document.querySelector('input[name="method"][value="' + saved.method + '"]');
      if (selected) selected.checked = true;
    } catch (error) {
      console.error(error.message);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedMethod = document.querySelector('input[name="method"]:checked');
    const survey = {
      name: document.getElementById("name").value,
      year: document.getElementById("year").value,
      method: selectedMethod ? selectedMethod.value : "",
      hours: document.getElementById("hours").value,
      comments: document.getElementById("comments").value,
      music: document.getElementById("music").checked
    };
    try {
      const result = await api("/api/survey", "POST", survey);
      showMessage(result.message);
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  loadSurvey();
}

if (page === "records") {
  async function loadRecords() {
    try {
      await checkLogin();
      const result = await api("/api/records");
      const records = result.records;
      const stats = result.stats;

      document.getElementById("totalAccounts").textContent = stats.accounts;
      document.getElementById("completed").textContent = stats.completed;
      document.getElementById("averageHours").textContent = stats.averageHours;
      document.getElementById("methods").textContent =
        "Alone: " + stats.methods.Alone + " | Group: " + stats.methods.Group + " | Both: " + stats.methods.Both;

      const select = document.getElementById("accountSelect");
      const table = document.getElementById("recordTable");

      records.forEach(record => {
        const option = document.createElement("option");
        option.value = record.id;
        option.textContent = record.id;
        select.appendChild(option);
      });

      select.addEventListener("change", () => {
        const record = records.find(r => r.id === select.value);
        table.replaceChildren();
        if (!record) {
          addRow("Status", "Select an account");
          return;
        }
        if (!record.survey) {
          addRow("Status", "No survey submitted");
          return;
        }
        addRow("Account ID", record.id);
        addRow("Name", record.survey.name);
        addRow("Academic Year", record.survey.year);
        addRow("Study Method", record.survey.method);
        addRow("Study Hours", record.survey.hours);
        addRow("Music While Studying", record.survey.music ? "Yes" : "No");
        addRow("Study Environment", record.survey.comments);
      });

      function addRow(label, value) {
        const row = document.createElement("tr");
        const heading = document.createElement("th");
        const cell = document.createElement("td");
        heading.textContent = label;
        cell.textContent = value === "" || value === null || value === undefined ? "Not provided" : String(value);
        row.append(heading, cell);
        table.appendChild(row);
      }
    } catch (error) {
      console.error(error.message);
    }
  }

  loadRecords();
}
