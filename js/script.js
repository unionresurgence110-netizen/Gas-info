
const NAV = [
  ["Home", "index.html"],
  ["Search / Explore", "index.html#search"],
  ["All Results", "results/all.html"],
  ["High Rated", "results/high-rated.html"],
  ["Others", "results/others.html"],
  ["Updates", "updates.html"],
  ["Rate & Reviews", "reviews.html"],
  ["Customer / Trader", "auth/login.html"]
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
  ).join("");

  box.innerHTML =
    links +
    `<button class="nav-btn" onclick="toggleTheme()">☾ Theme</button>`;

  mobile.innerHTML =
    links +
    `<a href="#" onclick="toggleTheme();return false">☾ Theme</a>`;
}

function toggleMenu() {
  document.querySelector("#mobile-menu")?.classList.toggle("open");
}

function toggleTheme() {
  const light = document.body.classList.toggle("light");
  localStorage.setItem("gasinfo-theme", light ? "light" : "dark");
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
