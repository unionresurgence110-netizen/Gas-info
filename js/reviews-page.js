(() => {
  const API = 'https://gas-info-api.onrender.com';
  const token = () => localStorage.getItem('gasInfoToken') || '';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

  async function api(path, options = {}) {
    const r = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {})
      }
    });

    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(d.error || 'Request failed');
    }

    return d;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const sections = document.querySelectorAll('.review-section');

    if (sections.length < 2) return;

    const shopEmpty = sections[0].querySelector('.empty-reviews');

    if (shopEmpty) {
      shopEmpty.innerHTML =
        'Shop-specific reviews appear on search result cards. ' +
        '<a href="index.html#search">Search for a shop</a>, ' +
        'then choose “View reviews” on its card.';
    }

    const website = sections[1];
    const notice = website.querySelector('.login-notice');
    const empty = website.querySelector('.empty-reviews');

    if (token()) {
      if (notice) {
        notice.innerHTML = `
          <h3>Write a website review</h3>

          <form id="websiteReviewForm">
            <label for="websiteRating">Rating</label>

            <select id="websiteRating" name="rating" required>
              <option value="">Choose rating</option>
              <option value="5">5 — Excellent</option>
              <option value="4">4 — Good</option>
              <option value="3">3 — Okay</option>
              <option value="2">2 — Poor</option>
              <option value="1">1 — Very poor</option>
            </select>

            <label for="websiteReviewText">
              Comment (optional)
            </label>

            <textarea
              id="websiteReviewText"
              name="review_text"
              maxlength="3000"
              placeholder="Share your experience"
            ></textarea>

            <button class="login-button" type="submit">
              Submit review
            </button>
          </form>
        `;
      }

      const form = website.querySelector('#websiteReviewForm');

      if (form) {
        form.onsubmit = async e => {
          e.preventDefault();

          const fd = new FormData(form);

          try {
            await api('/api/website-reviews', {
              method: 'POST',
              body: JSON.stringify({
                rating: Number(fd.get('rating')),
                review_text: fd.get('review_text')
              })
            });

            if (window.gasInfoNotify) {
              window.gasInfoNotify(
                'Website review submitted.',
                'success'
              );
            }

            form.reset();
            loadReviews();

          } catch (err) {
            if (window.gasInfoNotify) {
              window.gasInfoNotify(err.message, 'error');
            } else {
              console.error(err);
            }
          }
        };
      }

    } else if (notice) {
      const p = notice.querySelector('p');

      if (p) {
        p.textContent =
          'Log in to submit feedback about the GAS-INFO website.';
      }
    }

    async function loadReviews() {
      if (!empty) return;

      try {
        const d = await api('/api/website-reviews');

        empty.innerHTML = d.reviews.length
          ? d.reviews.map(r => `
              <article style="padding:14px 0;border-bottom:1px solid #30363d">
                <strong>
                  ${esc(r.username)} · ${esc(r.rating)}/5
                </strong>

                <p>${esc(r.review_text || 'No written comment.')}</p>

                <small>
                  ${esc(new Date(r.created_at).toLocaleString())}
                </small>
              </article>
            `).join('')
          : `
              <strong>No website reviews to display yet.</strong>
              <p>Real user feedback will appear here when available.</p>
            `;

      } catch (e) {
        empty.textContent =
          'Website reviews could not be loaded right now.';
      }
    }

    await loadReviews();
  });
})();
