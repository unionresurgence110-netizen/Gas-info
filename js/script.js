const NAV = [
  ["Home", "index.html"],
  ["Search / Explore", "index.html#search"],
  ["All Results", "results/all.html"],
  ["High Rated", "results/high-rated.html"],
  ["Others", "results/others.html"],
  ["Nearby", "nearby.html"],
  ["Updates", "updates.html"],
  ["Rate & Reviews", "reviews.html"]
];

function getLink(path) {
  const inResults = window.location.pathname
    .split("/")
    .includes("results");

  return inResults ? "../" + path.replace(/^\/+/, "") : path;
}

function renderNav() {
  const box = document.querySelector("#nav-links");
  const mobile = document.querySelector("#mobile-menu");

  if (!box || !mobile) return;

  const links = NAV.map(([text, path]) =>
    `<a href="${getLink(path)}">${text}</a>`
  );

  let account = null;

  try {
    const token = localStorage.getItem("gasInfoToken");
    const user = JSON.parse(
      localStorage.getItem("gasInfoUser") || "null"
    );

    if (
      token &&
      user &&
      ["customer", "trader", "admin"].includes(user.role)
    ) {
      const accountPath =
        user.role === "admin"
          ? "admin/dashboard.html"
          : user.role === "trader"
          ? "trader/dashboard.html"
          : "customer/profile.html";

      const accountLabel =
        user.role === "admin"
          ? "Admin Console"
          : user.role === "trader"
          ? "Trader Dashboard"
          : "My Profile";

      account =
        `<a class="nav-account" href="${getLink(accountPath)}">` +
        `${accountLabel}</a>` +
        `<button class="nav-btn" type="button" data-nav-logout>` +
        `Logout</button>`;
    }
  } catch (_) {
    /* Keep public navigation available if session data is malformed. */
  }

  if (!account) {
    links.push(
      `<a href="${getLink("auth/login.html")}">Login / Register</a>`
    );
  }

  const linkMarkup = links.join("");
  const accountMarkup = account || "";

  box.innerHTML =
    linkMarkup +
    accountMarkup +
    `<button class="nav-btn" type="button" onclick="toggleTheme()">` +
    `☾ Theme</button>`;

  mobile.innerHTML =
    linkMarkup +
    accountMarkup +
    `<a href="#" onclick="toggleTheme();return false">` +
    `☾ Theme</a>`;

  document.querySelectorAll("[data-nav-logout]").forEach(button =>
    button.addEventListener("click", () => {
      localStorage.removeItem("gasInfoToken");
      localStorage.removeItem("gasInfoUser");
      location.href = getLink("index.html");
    })
  );
}

function toggleMenu() {
  document.querySelector("#mobile-menu")?.classList.toggle("open");
}

function toggleTheme() {
  const light = document.body.classList.toggle("light");

  localStorage.setItem(
    "gasinfo-theme",
    light ? "light" : "dark"
  );
}

function loadTheme() {
  if (localStorage.getItem("gasinfo-theme") === "light") {
    document.body.classList.add("light");
  }
}

function openSearch() {
  document.querySelector("#search-form")?.classList.add("open");
  document.querySelector("#search-input")?.focus();
}

function closeSearch() {
  document.querySelector("#search-form")?.classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();
  renderNav();
});
