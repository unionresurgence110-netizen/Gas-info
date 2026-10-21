
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

  function message(text) {
    alert(text);
  }

  function saveSession(data) {
    if (!data.token || !data.user) {
      throw new Error(
        'The server returned an incomplete login response.'
      );
    }

    sessionStorage.setItem('gasInfoToken', data.token);
    sessionStorage.setItem('gasInfoUser', JSON.stringify(data.user));
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
          message(`Login successful. Signed in as ${role}.`);

          window.location.href = roleHome(role);
        } catch (err) {
          message(err.message);
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

          message('Customer account created successfully.');
          window.location.href = '../customer/profile.html';
        } catch (err) {
          message(err.message);
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

        if (password !== $('confirmPassword').value) {
          return message('Passwords do not match.');
        }

        if (password.length < 8) {
          return message('Password must be at least 8 characters.');
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
            !window.confirm(
              duplicate.message +
              '\n\nContinue registration anyway?'
            )
          ) {
            return;
          }

          setBusy(trader, true, 'Creating trader account…');

          const authData = await request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              username: $('username').value.trim(),
              email: $('email').value.trim(),
              password,
              role: 'trader'
            })
          });

          accountCreated = true;
          saveSession(authData);

          const shopData = await request('/api/trader/shops', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authData.token}`
            },
            body: JSON.stringify({
              shop_name: $('shopName').value.trim(),
              phone: $('phone').value.trim(),
              business_email: $('businessEmail').value.trim(),
              province,
              district,
              municipality,
              ward_no: ward,
              town_village: $('townVillage').value.trim(),
              exact_location: $('exactLocation').value.trim(),
              latitude: $('latitude').value,
              longitude: $('longitude').value
            })
          });

          message(
            shopData.message ||
            'Trader account and shop submitted. Shop approval is still required.'
          );

          window.location.href = '../trader/dashboard.html';
        } catch (err) {
          if (accountCreated) {
            message(
              `Your trader account was created, but shop submission failed: ${err.message}. ` +
              'Your login session is saved. Sign in again later and contact support before creating another account.'
            );
          } else {
            message(err.message);
          }
        } finally {
          setBusy(trader, false);
        }
      });
    }
  });
})();
        
