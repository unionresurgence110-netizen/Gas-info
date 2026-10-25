
(()=>{
  'use strict';

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : location.href;

  const rootUrl = new URL('../', scriptUrl);
  const link = path => new URL(path, rootUrl).href;

  const navItems = [
    ['Home', 'index.html'],
    ['Search / Explore', 'index.html#search'],
    ['All Shops', 'results/all.html'],
    ['High-Rated Shops', 'results/high-rated.html'],
    ['Others', 'results/others.html'],
    ['Updates', 'updates.html'],
    ['Reviews', 'reviews.html']
  ];

  const getUser = () => {
    try {
      return JSON.parse(
        localStorage.getItem('gasInfoUser') || 'null'
      );
    } catch (_) {
      return null;
    }
  };

  const isLogged = () => {
    const user = getUser();

    return !!(
      localStorage.getItem('gasInfoToken') &&
      user &&
      ['customer', 'trader', 'admin'].includes(user.role)
    );
  };

  function buildHeader() {
    const user = getUser();
    let account = '';

    if (isLogged()) {
      const target =
        user.role === 'admin'
          ? 'admin/dashboard.html'
          : user.role === 'trader'
            ? 'trader/dashboard.html'
            : 'customer/profile.html';

      const label =
        user.role === 'admin'
          ? 'Admin Console'
          : user.role === 'trader'
            ? 'Trader Dashboard'
            : 'My Profile';

      const logoutId = document.body.hasAttribute('data-dashboard')
        ? ' id="logout"'
        : '';

      account =
        `<a href="${link(target)}">${label}</a>` +
        `<button type="button" class="gi-logout"${logoutId}>Logout</button>`;
    } else {
      account = `<a href="${link('auth/login.html')}">Login / Register</a>`;
    }

    const links = navItems
      .map(([label, path]) =>
        `<a href="${link(path)}">${label}</a>`
      )
      .join('');

    return `
      <header class="gi-header">
        <div class="gi-bar">
          <a class="gi-brand" href="${link('index.html')}">GAS-INFO</a>

          <button
            class="gi-menu-button"
            type="button"
            aria-label="Open navigation menu"
            aria-expanded="false"
          >☰</button>

          <nav class="gi-nav" aria-label="Main navigation">
            ${links}
            ${account}
            <button type="button" class="gi-theme">☾ Theme</button>
          </nav>
        </div>

        <nav class="gi-mobile" aria-label="Mobile navigation" hidden>
          ${links}
          ${account.replace(' id="logout"', '')}
          <button type="button" class="gi-theme">☾ Theme</button>
        </nav>
      </header>
    `;
  }

  function buildFooter() {
    return `
      <footer class="gi-footer">
        <nav class="gi-footer-links" aria-label="Footer navigation">
          <a href="${link('about.html')}">About Us</a>
          <a href="${link('about.html')}">How It Works</a>
          <a href="${link('terms.html')}">Terms &amp; Penalties</a>
          <a href="${link('legal.html')}">Legal &amp; Compliance</a>
          <a href="${link('privacy.html')}">🔒 Privacy Policy</a>
          <a href="${link('contact.html')}">Contact / Report</a>
        </nav>

        <p>© 2026 GAS-INFO. Information platform for gas availability.</p>
      </footer>
    `;
  }

  function styles() {
    if (document.getElementById('gi-layout-styles')) return;

    const style = document.createElement('style');
    style.id = 'gi-layout-styles';

    style.textContent = `
      .gi-header {
        position: sticky;
        top: 0;
        z-index: 1000;
        background: #161b22;
        color: #e6edf3;
        border-bottom: 1px solid #30363d;
        font-family: Arial, sans-serif;
      }

      .gi-bar {
        max-width: 1200px;
        margin: auto;
        min-height: 66px;
        padding: 10px 18px;
        display: flex;
        align-items: center;
        gap: 18px;
      }

      .gi-brand {
        font-size: 1.28rem;
        font-weight: 800;
        letter-spacing: .2px;
        white-space: nowrap;
        color: #f0f6fc;
        text-decoration: none;
      }

      .gi-nav {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: clamp(7px, 1.2vw, 16px);
        margin-left: auto;
        flex-wrap: wrap;
      }

      .gi-nav a,
      .gi-nav button,
      .gi-mobile a,
      .gi-mobile button {
        font: inherit;
        font-size: .9rem;
        color: #c9d1d9;
        text-decoration: none;
        background: transparent;
        border: 0;
        cursor: pointer;
        padding: 8px 5px;
        white-space: nowrap;
      }

      .gi-nav a:hover,
      .gi-nav button:hover,
      .gi-mobile a:hover,
      .gi-mobile button:hover {
        color: #fff;
      }

      .gi-menu-button {
        display: none;
        background: transparent;
        color: #e6edf3;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 7px 11px;
        font-size: 1.1rem;
        cursor: pointer;
        margin-left: auto;
      }

      .gi-mobile {
        max-width: 1200px;
        margin: auto;
        padding: 8px 18px 14px;
        border-top: 1px solid #30363d;
        display: flex;
        flex-wrap: wrap;
        gap: 5px 14px;
      }

      .gi-mobile[hidden] {
        display: none;
      }

      .gi-footer {
        background: #161b22;
        color: #c9d1d9;
        border-top: 1px solid #30363d;
        margin-top: 36px;
        padding: 22px 18px 14px;
        text-align: center;
        font-family: Arial, sans-serif;
      }

      .gi-footer-links {
        max-width: 1000px;
        margin: 0 auto 12px;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 22px;
      }

      .gi-footer-links a {
        font-size: .92rem;
        color: #c9d1d9;
        text-decoration: none;
        padding: 4px 0;
      }

      .gi-footer-links a:hover {
        color: #fff;
        text-decoration: underline;
      }

      .gi-footer p {
        margin: 8px 0 0;
        font-size: .84rem;
        color: #8b949e;
      }

      body.light .gi-header,
      body.light-theme .gi-header {
        background: #f6f8fa;
        color: #24292f;
        border-color: #d0d7de;
      }

      body.light .gi-brand,
      body.light-theme .gi-brand {
        color: #24292f;
      }

      body.light .gi-nav a,
      body.light .gi-nav button,
      body.light .gi-mobile a,
      body.light .gi-mobile button,
      body.light-theme .gi-nav a,
      body.light-theme .gi-nav button,
      body.light-theme .gi-mobile a,
      body.light-theme .gi-mobile button {
        color: #24292f;
      }

      body.light .gi-mobile,
      body.light-theme .gi-mobile {
        border-color: #d0d7de;
      }

      body.light .gi-footer,
      body.light-theme .gi-footer {
        background: #f6f8fa;
        color: #24292f;
        border-color: #d0d7de;
      }

      body.light .gi-footer-links a,
      body.light-theme .gi-footer-links a {
        color: #24292f;
      }

      @media (max-width: 900px) {
        .gi-bar {
          min-height: 60px;
        }

        .gi-nav {
          display: none;
        }

        .gi-menu-button {
          display: block;
        }

        .gi-mobile:not([hidden]) {
          display: flex;
        }

        .gi-mobile {
          flex-direction: column;
          align-items: stretch;
          gap: 0;
        }

        .gi-mobile a,
        .gi-mobile button {
          display: block;
          text-align: left;
          padding: 10px 3px;
          border-bottom: 1px solid #30363d;
          white-space: normal;
        }

        .gi-footer-links {
          gap: 4px 16px;
        }
      }

      @media (max-width: 420px) {
        .gi-bar {
          padding: 10px 13px;
        }

        .gi-footer {
          padding-left: 12px;
          padding-right: 12px;
        }

        .gi-footer-links {
          gap: 4px 13px;
        }

        .gi-footer-links a {
          font-size: .88rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function init() {
    styles();

    const header = document.querySelector('[data-gi-header]');
    if (header) header.outerHTML = buildHeader();

    const footer = document.querySelector('[data-gi-footer]');
    if (footer) footer.outerHTML = buildFooter();

    const menu = document.querySelector('.gi-menu-button');
    const mobile = document.querySelector('.gi-mobile');

    menu?.addEventListener('click', () => {
      const open = mobile.hasAttribute('hidden');

      if (open) mobile.removeAttribute('hidden');
      else mobile.setAttribute('hidden', '');

      menu.setAttribute('aria-expanded', String(open));
    });

    document.querySelectorAll('.gi-theme').forEach(button => {
      button.addEventListener('click', () => {
        const light =
          document.body.classList.contains('light') ||
          document.body.classList.contains('light-theme');

        document.body.classList.toggle('light', !light);
        document.body.classList.toggle('light-theme', !light);

        try {
          localStorage.setItem(
            'gasinfo-theme',
            !light ? 'light' : 'dark'
          );
        } catch (_) {}
      });
    });

    try {
      if (localStorage.getItem('gasinfo-theme') === 'light') {
        document.body.classList.add('light');
        document.body.classList.add('light-theme');
      }
    } catch (_) {}

    document.querySelectorAll('.gi-logout').forEach(button => {
      button.addEventListener('click', () => {
        try {
          localStorage.removeItem('gasInfoToken');
          localStorage.removeItem('gasInfoUser');
        } catch (_) {}

        location.href = link('index.html');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
