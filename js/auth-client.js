
/* GAS-INFO authentication client. Uses the live Render API. */
(() => {
  const API = 'https://gas-info-api.onrender.com';
  const $ = id => document.getElementById(id);

  async function request(path, options = {}) {
    let response;

    try {
      response = await fetch(API + path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error(
        'Unable to connect to the server. Please check your internet connection and try again.'
      );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Request failed (${response.status})`
      );
    }

    return data;
  }

  function message(text, kind = 'info') {
    if (window.gasInfoNotify) window.gasInfoNotify(text, kind);
    else {
      const form = document.querySelector('form');
      let notice = document.getElementById('auth-feedback');
      if (!notice) {
        notice = document.createElement('p');
        notice.id = 'auth-feedback';
        notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        notice.setAttribute('aria-live', 'polite');
        notice.className = 'notice';
        form?.before(notice);
      }
      notice.textContent = text;
    }
  }

  function saveSession(data) {
    if (!data.token || !data.user) {
      throw new Error(
        'The server returned an incomplete login response.'
      );
    }

    localStorage.setItem('gasInfoToken', data.token);
    localStorage.setItem('gasInfoUser', JSON.stringify(data.user));
  }

  function roleHome(role) {
    return role === 'admin'
      ? '../admin/dashboard.html'
      : role === 'trader'
        ? '../trader/dashboard.html'
        : '../customer/profile.html';
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('[type="submit"]');
    if (!button) return;

    if (busy) {
      if (!button.disabled) {
        button.dataset.originalText = button.textContent.trim();
      }

      button.disabled = true;
      button.textContent = label || 'Please wait…';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Submit';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // If a signed-in customer opened the trader form from their profile, reuse that account.
    const traderForm = $('traderRegisterForm');
    let upgradingCustomer = false;
    if (traderForm && new URLSearchParams(location.search).get('upgrade') === '1') {
      try {
        const savedUser = JSON.parse(localStorage.getItem('gasInfoUser') || 'null');
        const savedToken = localStorage.getItem('gasInfoToken');
        if (savedToken && savedUser?.role === 'customer') {
          upgradingCustomer = true;
          const username = $('username'), email = $('email'), confirmPassword = $('confirmPassword');
          if (username) { username.value = savedUser.username || ''; username.readOnly = true; }
          if (email) { email.value = savedUser.email || ''; email.readOnly = true; }
          const passwordLabel = traderForm.querySelector('label[for="password"]');
          if (passwordLabel) passwordLabel.innerHTML = 'Current account password <span class="required">*</span>';
          if ($('password')) { $('password').placeholder = 'Enter your current account password'; $('password').autocomplete = 'current-password'; }
          if (confirmPassword) { confirmPassword.required = false; confirmPassword.closest('.form-group')?.setAttribute('hidden', ''); }
          const heading = document.querySelector('h1');
          if (heading) heading.textContent = 'Switch to Trader';
          const intro = document.querySelector('.page-title p, .form-intro, .muted');
          if (intro) intro.textContent = 'Complete your shop details to upgrade your existing customer account. Your account details and password will stay the same.';
          const submit = traderForm.querySelector('[type="submit"]');
          if (submit) submit.textContent = 'Switch to Trader & Submit Shop';
        }
      } catch { /* Keep the standard registration flow if saved session data is invalid. */ }
    }
    // LOGIN
    const login = $('loginForm');

    if (login) {
      login.addEventListener('submit', async event => {
        event.preventDefault();
        setBusy(login, true, 'Signing in…');

        try {
          const data = await request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              email: $('email').value.trim(),
              password: $('password').value
            })
          });

          saveSession(data);

          const role = data.user.role;
          // Navigate directly after success; avoid a browser-origin popup.
          window.location.href = roleHome(role);
        } catch (err) {
          message(err.message, 'error');
        } finally {
          setBusy(login, false);
        }
      });
    }

    // CUSTOMER REGISTRATION
    const customer = $('customerRegisterForm');

    if (customer) {
      customer.addEventListener('submit', async event => {
        event.preventDefault();

        const password = $('password').value;

        if (password !== $('confirmPassword').value) {
          return message('Passwords do not match.');
        }

        if (password.length < 8) {
          return message('Password must be at least 8 characters.');
        }

        setBusy(customer, true, 'Creating account…');

        try {
          const data = await request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              username: $('username').value.trim(),
              email: $('email').value.trim(),
              password,
              role: 'customer'
            })
          });

          saveSession(data);

          window.location.href = '../customer/profile.html';
        } catch (err) {
          message(err.message, 'error');
        } finally {
          setBusy(customer, false);
        }
      });
    }

    // TRADER REGISTRATION
    const trader = $('traderRegisterForm');

    if (trader) {
      trader.addEventListener('submit', async event => {
        event.preventDefault();

        const password = $('password').value;

        if (upgradingCustomer) {
          if (!password) return message('Enter your current account password to confirm the switch.', 'error');
        } else {
          if (password !== $('confirmPassword').value) {
            return message('Passwords do not match.', 'error');
          }
          if (password.length < 8) {
            return message('Password must be at least 8 characters.', 'error');
          }
        }

        if (!$('terms').checked) {
          return message('Please agree to the Terms & Legal requirements.');
        }

        if (!$('latitude').value || !$('longitude').value) {
          return message('Please select the exact shop location on the map.');
        }

        const province = $('province').value;
        const district = $('district').value;
        const municipality = $('municipality').value;
        const ward = $('wardNo').value;

        if (!province || !district || !municipality || !ward) {
          return message(
            'Please complete Province, District, Municipality and Ward.'
          );
        }

        setBusy(trader, true, 'Checking shop details…');

        let accountCreated = false;

        try {
          const duplicate = await request(
            '/api/trader/shops/check-duplicate',
            {
              method: 'POST',
              body: JSON.stringify({
                shop_name: $('shopName').value.trim(),
                municipality,
                phone: $('phone').value.trim(),
                business_email: $('businessEmail').value.trim()
              })
            }
          );

          if (
            duplicate.possibleDuplicate &&
            !(await (window.gasInfoConfirm
              ? window.gasInfoConfirm(duplicate.message + '\n\nContinue registration anyway?')
              : Promise.resolve(false)))
          ) {
            return;
          }

          setBusy(trader, true, upgradingCustomer ? 'Switching account…' : 'Creating trader account…');

          if (upgradingCustomer) {
            const token = localStorage.getItem('gasInfoToken');
            const sendUpgrade = async confirmDuplicate => request('/api/auth/upgrade-to-trader', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                password,
                shop_name: $('shopName').value.trim(),
                phone: $('phone').value.trim(),
                business_email: $('businessEmail').value.trim(),
                province, district, municipality, ward_no: ward,
                town_village: $('townVillage').value.trim(),
                exact_location: $('exactLocation').value.trim(),
                latitude: $('latitude').value,
                longitude: $('longitude').value,
                confirm_possible_duplicate: confirmDuplicate
              })
            });
            let upgraded;
            try { upgraded = await sendUpgrade(false); }
            catch (err) {
              if (err.message.includes('similar shop may already be registered')) {
                const confirmed = await (window.gasInfoConfirm
                  ? window.gasInfoConfirm(err.message + '\n\nIf you have checked and this is your shop, continue?')
                  : Promise.resolve(window.confirm(err.message + '\n\nIf you have checked and this is your shop, continue?')));
                if (!confirmed) return;
                upgraded = await sendUpgrade(true);
              } else throw err;
            }
            saveSession(upgraded);
            window.location.href = '../trader/dashboard.html';
            return;
          }

          const authData = await request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username: $('username').value.trim(), email: $('email').value.trim(), password, role: 'trader' })
          });
          accountCreated = true;
          saveSession(authData);
          await request('/api/trader/shops', {
            method: 'POST',
            headers: { Authorization: `Bearer ${authData.token}` },
            body: JSON.stringify({ shop_name: $('shopName').value.trim(), phone: $('phone').value.trim(), business_email: $('businessEmail').value.trim(), province, district, municipality, ward_no: ward, town_village: $('townVillage').value.trim(), exact_location: $('exactLocation').value.trim(), latitude: $('latitude').value, longitude: $('longitude').value })
          });
          window.location.href = '../trader/dashboard.html';
        } catch (err) {
          if (accountCreated) {
            message(
              `Your trader account was created, but shop submission failed: ${err.message}. ` +
              'Opening shop setup so you can retry without registering another account.',
              'error'
            );
            window.setTimeout(() => { window.location.href = '../trader/dashboard.html?shopSetup=failed'; }, 2200);
          } else {
            message(err.message, 'error');
          }
        } finally {
          setBusy(trader, false);
        }
      });
    }
  });
})();
        
