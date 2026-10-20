
const navItems = [
  ["Home", "index.html"],
  ["Search", "index.html#search"],
  ["All", "results/all.html"],
  ["High-Rated", "results/high-rated.html"],
  ["Others", "results/others.html"],
  ["Nearby", "nearby.html"],
  ["Updates", "updates.html"],
  ["Reviews", "reviews.html"],
  ["About Us", "about.html"],
  ["Contact", "contact.html"]
];

// Resolve all links from the project root, regardless of page depth.
const APP_ROOT = new URL("../", document.currentScript.src);

function appPath(path) {
  return new URL(path, APP_ROOT).href;
}

function renderShell() {
  const header = document.querySelector("#site-header");

  if (header) {
    header.innerHTML = `
      <div class="container">
        <div class="nav">
          <a class="logo" href="${appPath("index.html")}">
            GAS<span>-INFO</span>
          </a>

          <div class="nav-links">
            ${navItems.map(([title, url]) =>
              `<a href="${appPath(url)}">${title}</a>`
            ).join("")}

            <a href="${appPath("auth/login.html")}">Login</a>
            <a href="${appPath("auth/register.html")}">Register</a>

            <button id="themeBtn" type="button"
              aria-label="Toggle color theme">☼/☾</button>
          </div>

          <button class="nav-toggle" id="navToggle"
            type="button" aria-label="Open navigation"
            aria-expanded="false">☰</button>
        </div>

        <div class="mobile-menu" id="mobileMenu">
          ${navItems.map(([title, url]) =>
            `<a href="${appPath(url)}">${title}</a>`
          ).join("")}

          <a href="${appPath("auth/login.html")}">Login</a>
          <a href="${appPath("auth/register.html")}">Register</a>

          <button id="themeBtnMobile" type="button">
            Toggle theme
          </button>
        </div>
      </div>
    `;

    const toggle = document.querySelector("#navToggle");
    const mobileMenu = document.querySelector("#mobileMenu");

    toggle?.addEventListener("click", () => {
      const isOpen = mobileMenu?.classList.toggle("open") ?? false;
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    document.querySelector("#themeBtn")
      ?.addEventListener("click", toggleTheme);

    document.querySelector("#themeBtnMobile")
      ?.addEventListener("click", toggleTheme);
  }

  const footer = document.querySelector("#site-footer");

  if (footer) {
    footer.innerHTML = `
      <div class="container">
        <strong>GAS-INFO</strong>

        <div class="footer-links">
          <a href="${appPath("terms.html")}">
            Terms &amp; Penalties
          </a>
          <a href="${appPath("legal.html")}">
            Legal &amp; Compliance
          </a>
          <a href="${appPath("contact.html")}">
            Contact / Report
          </a>
          <a href="${appPath("privacy.html")}">
            Privacy Policy
          </a>
        </div>

        <p>
          GAS-INFO is an information platform. Stock information is
          trader-provided and may change at any time.
        </p>

        <small>
          © <span id="year"></span> GAS-INFO.
          Final legal and contact details should be reviewed before launch.
        </small>
      </div>
    `;

    const year = footer.querySelector("#year");
    if (year) {
      year.textContent = new Date().getFullYear();
    }
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light");

  try {
    localStorage.setItem(
      "gasinfo-theme",
      isLight ? "light" : "dark"
    );
  } catch (error) {
    // Theme still works for this page if storage is unavailable.
  }
}

function loadTheme() {
  try {
    if (localStorage.getItem("gasinfo-theme") === "light") {
      document.body.classList.add("light");
    }
  } catch (error) {
    // Keep the default theme if storage is unavailable.
  }
}

function setupSearch() {
  const trigger = document.querySelector("#searchTrigger");
  const panel = document.querySelector("#searchPanel");
  const close = document.querySelector("#closeSearch");

  if (trigger && panel) {
    trigger.addEventListener("click", () => {
      panel.classList.add("open");
    });
  }

  if (close && panel) {
    close.addEventListener("click", () => {
      panel.classList.remove("open");
    });
  }

  // Search submission is intentionally not handled here.
  // Keep live search logic in js/public-api.js to avoid
  // duplicate submit listeners and placeholder results.
}

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();
  renderShell();
  setupSearch();
});
