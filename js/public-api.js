(() => {
  const API = "https://gas-info-api.onrender.com";
  const $ = id => document.getElementById(id);

  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

  const getToken = () => sessionStorage.getItem("gasInfoToken") || "";

  const inResultsFolder = () =>
    location.pathname.split("/").includes("results");

  const pagePrefix = () => inResultsFolder() ? "../" : "";

  async function request(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  const paramsToQuery = filters =>
    new URLSearchParams(
      Object.entries(filters).filter(([key, value]) =>
        value !== "" && value !== null && value !== undefined
      )
    ).toString();

  function card(r) {
    const hasCoords =
      r.latitude != null &&
      r.longitude != null &&
      Number.isFinite(Number(r.latitude)) &&
      Number.isFinite(Number(r.longitude));

    const mapUrl = hasCoords
      ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(r.latitude)}&mlon=${encodeURIComponent(r.longitude)}#map=17/${encodeURIComponent(r.latitude)}/${encodeURIComponent(r.longitude)}`
      : "";

    return `
      <article class="result-card">
        <div class="gas-placeholder" role="img"
             aria-label="Default GAS-INFO gas cylinder illustration">
          <span class="cylinder"></span>
          <span class="placeholder-label">GAS-<br>INFO</span>
        </div>

        <h3>${esc(r.shop_name)}</h3>

        <p>
          <span class="tag">Rating ${Number(r.rating || 0).toFixed(1)}/5 (${esc(r.review_count || 0)} reviews)</span>
          <span class="tag">Reported stock: ${esc(r.quantity)} ${esc(r.cylinder_name)}</span>
        </p>

        <p>${esc([
          r.exact_location,
          r.town_village,
          r.ward_no != null && r.ward_no !== "" ? "Ward " + r.ward_no : "",
          r.municipality,
          r.district,
          r.province
        ].filter(Boolean).join(", "))}</p>

        ${hasCoords
          ? `<a class="shop-map-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">View shop pin on map</a>`
          : `<p class="muted">Map pin not available for this shop yet.</p>`}

        <p class="muted">
          Last updated: ${esc(r.last_updated_at ? new Date(r.last_updated_at).toLocaleString() : "Unknown")}
          · Phone: ${esc(r.phone || "Not provided")}
        </p>

        <p class="notice">
          Stock information is provided by the trader and may change at any time.
          Please check the latest information before visiting.
        </p>

        <div class="tabs">
          <button class="btn secondary" data-reviews="${esc(r.shop_id)}">View reviews</button>
          <button class="btn secondary" data-review="${esc(r.shop_id)}">Rate / Review</button>
          <button class="btn secondary" data-report="${esc(r.shop_id)}">Report stock mismatch</button>
        </div>

        <div id="shop-reviews-${esc(r.shop_id)}"></div>
      </article>
    `;
  }

  // Create the report popup when it is first needed.
  function ensureReportModal() {
    let modal = $("gas-report-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "gas-report-modal";
    modal.className = "report-modal";
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <section class="report-dialog" role="dialog" aria-modal="true"
               aria-labelledby="report-modal-title">

        <button type="button" class="report-close" id="report-close"
                aria-label="Close report form">×</button>

        <h2 id="report-modal-title">Report Stock Mismatch</h2>

        <p class="report-description">
          Help us identify information that may be incorrect.
          Please provide accurate details.
        </p>

        <p class="muted" id="report-shop-name"></p>

        <form id="gas-report-form">
          <div class="report-field">
            <label for="report-type">What is incorrect?</label>

            <select id="report-type" name="report_type" required>
              <option value="stock_mismatch">Stock availability is incorrect</option>
              <option value="wrong_quantity">Reported quantity is incorrect</option>
              <option value="wrong_cylinder">Cylinder type is incorrect</option>
              <option value="incorrect_shop_info">Shop information is incorrect</option>
              <option value="other">Other issue</option>
            </select>
          </div>

          <div class="report-field">
            <label for="report-description">Describe the issue</label>

            <textarea id="report-description"
                      name="description"
                      minlength="10"
                      maxlength="1000"
                      required
                      placeholder="Explain what seems incorrect (10–1000 characters)."></textarea>

            <p class="report-help">
              Don't include passwords, private information, or unrelated details.
            </p>
          </div>

          <div class="report-actions">
            <button class="btn" type="submit" id="report-submit">
              Submit report
            </button>

            <button class="btn secondary" type="button" id="report-cancel">
              Cancel
            </button>
          </div>

          <div id="report-status"
               class="report-status"
               role="status"
               aria-live="polite"></div>
        </form>
      </section>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
      if (modal.dataset.submitting === "true") return;

      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    };

    $("report-close").addEventListener("click", closeModal);
    $("report-cancel").addEventListener("click", closeModal);

    modal.addEventListener("click", event => {
      if (event.target === modal) closeModal();
    });

    if (!document.documentElement.dataset.reportEscapeBound) {
      document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          const openModal = $("gas-report-modal");

          if (
            openModal?.classList.contains("open") &&
            openModal.dataset.submitting !== "true"
          ) {
            openModal.classList.remove("open");
            openModal.setAttribute("aria-hidden", "true");
          }
        }
      });

      document.documentElement.dataset.reportEscapeBound = "true";
    }

    // Submit the report to the existing backend API.
    $("gas-report-form").addEventListener("submit", async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const shopId = modal.dataset.shopId;
      const type = $("report-type").value;
      const description = $("report-description").value.trim();
      const submitButton = $("report-submit");
      const status = $("report-status");

      status.className = "report-status";
      status.textContent = "";

      if (!shopId) {
        status.textContent =
          "Shop information is missing. Close this form and try again.";

        status.classList.add("visible", "error");
        return;
      }

      if (description.length < 10 || description.length > 1000) {
        status.textContent =
          "Please enter a description between 10 and 1000 characters.";

        status.classList.add("visible", "error");
        $("report-description").focus();
        return;
      }

      if (!getToken()) {
        location.href = pagePrefix() + "auth/login.html";
        return;
      }

      modal.dataset.submitting = "true";
      submitButton.disabled = true;
      submitButton.textContent = "Submitting…";

      status.textContent = "Submitting your report…";
      status.classList.add("visible", "info");

      try {
        await request(
          `/api/shops/${encodeURIComponent(shopId)}/reports`,
          {
            method: "POST",
            body: JSON.stringify({
              report_type: type,
              description
            })
          }
        );

        status.textContent =
          "Report submitted. Thank you for helping improve GAS-INFO.";

        status.className = "report-status visible success";

        form.reset();
        modal.dataset.submitted = "true";

      } catch (error) {
        status.textContent =
          `Could not submit the report: ${error.message}. Please try again later.`;

        status.className = "report-status visible error";
        modal.dataset.submitted = "false";

      } finally {
        modal.dataset.submitting = "false";

        if (modal.dataset.submitted === "true") {
          submitButton.disabled = true;
          submitButton.textContent = "Submitted";
        } else {
          submitButton.disabled = false;
          submitButton.textContent = "Submit report";
        }
      }
    });

    return modal;
  }

  function openReportModal(shopId, shopName) {
    const modal = ensureReportModal();

    modal.dataset.shopId = String(shopId);
    modal.dataset.submitted = "false";
    modal.dataset.submitting = "false";

    $("report-shop-name").textContent =
      `Shop: ${shopName || "Selected shop"}`;

    $("report-status").textContent = "";
    $("report-status").className = "report-status";

    $("gas-report-form").reset();

    const submitButton = $("report-submit");
    submitButton.disabled = false;
    submitButton.textContent = "Submit report";

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    $("report-type").focus();
  }

  function openReviewModal(shopId, shopName) {
    let modal = $("gas-review-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "gas-review-modal";
      modal.className = "report-modal";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = `
        <section class="report-dialog" role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
          <button type="button" class="report-close" id="review-close" aria-label="Close review form">×</button>
          <h2 id="review-modal-title">Rate this shop</h2>
          <p class="report-description" id="review-shop-name"></p>
          <form id="gas-review-form">
            <div class="report-field"><label for="review-rating">Your rating</label>
              <select id="review-rating" name="rating" required>
                <option value="">Choose a rating</option><option value="5">★★★★★ — Excellent</option><option value="4">★★★★☆ — Good</option><option value="3">★★★☆☆ — Okay</option><option value="2">★★☆☆☆ — Poor</option><option value="1">★☆☆☆☆ — Very poor</option>
              </select>
            </div>
            <div class="report-field"><label for="review-text">Written review (optional)</label><textarea id="review-text" name="review_text" maxlength="3000" placeholder="Share useful, respectful feedback (up to 3000 characters)."></textarea></div>
            <div class="report-actions"><button class="btn" type="submit" id="review-submit">Submit review</button><button class="btn secondary" type="button" id="review-cancel">Cancel</button></div>
            <div id="review-status" class="report-status" role="status" aria-live="polite"></div>
          </form>
        </section>`;
      document.body.appendChild(modal);
      const close = () => { if (modal.dataset.submitting === "true") return; modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); };
      $("review-close").addEventListener("click", close);
      $("review-cancel").addEventListener("click", close);
      modal.addEventListener("click", event => { if (event.target === modal) close(); });
      document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("open") && modal.dataset.submitting !== "true") close(); });
      $("gas-review-form").addEventListener("submit", async event => {
        event.preventDefault();
        const status = $("review-status"), submit = $("review-submit");
        const rating = Number($("review-rating").value), reviewText = $("review-text").value.trim();
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          status.textContent = "Please choose a rating from 1 to 5."; status.className = "report-status visible error"; $("review-rating").focus(); return;
        }
        modal.dataset.submitting = "true"; submit.disabled = true; submit.textContent = "Submitting…";
        status.textContent = "Submitting your review…"; status.className = "report-status visible info";
        try {
          const result = await request(`/api/shops/${encodeURIComponent(modal.dataset.shopId)}/reviews`, {method:"POST", body:JSON.stringify({rating,review_text:reviewText})});
          status.textContent = result.message || "Review saved. Thank you."; status.className = "report-status visible success"; modal.dataset.submitted = "true";
          const reviewButton = [...document.querySelectorAll("[data-review]")].find(b => b.dataset.review === modal.dataset.shopId);
          const reviewRoot = reviewButton?.closest(".result-card");
          if (reviewRoot && Number.isFinite(Number(result.rating)) && Number.isFinite(Number(result.review_count))) {
            const ratingTag = reviewRoot.querySelector(".tag");
            if (ratingTag) ratingTag.textContent = `Rating ${Number(result.rating).toFixed(1)}/5 (${Number(result.review_count)} reviews)`;
          }
          reviewRoot?.querySelector(`[data-reviews="${modal.dataset.shopId}"]`)?.click();
          if (window.gasInfoNotify) window.gasInfoNotify("Review saved. Thank you.", "success");
        } catch (error) {
          status.textContent = `Could not save your review: ${error.message}`; status.className = "report-status visible error";
        } finally { modal.dataset.submitting = "false"; submit.disabled = false; submit.textContent = "Submit review"; }
      });
    }
    modal.dataset.shopId = String(shopId); modal.dataset.submitted = "false"; modal.dataset.submitting = "false";
    $("review-shop-name").textContent = `Shop: ${shopName}`;
    $("gas-review-form").reset(); $("review-status").textContent = ""; $("review-status").className = "report-status";
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); $("review-rating").focus();
  }

  function bindCards(root) {
    // View shop reviews.
    root.querySelectorAll("[data-reviews]").forEach(button => {
      button.onclick = async () => {
        const id = button.dataset.reviews;
        const element = $(`shop-reviews-${id}`);

        try {
          const data = await request(
            `/api/shops/${encodeURIComponent(id)}/reviews`
          );

          const reviews = data.reviews || [];

          element.innerHTML = reviews.length
            ? reviews.map(review =>
                `<p><b>${esc(review.username)}</b> · ${esc(review.rating)}/5 — ${esc(review.review_text || "No comment")}</p>`
              ).join("")
            : `<p class="muted">No reviews yet.</p>`;

        } catch (error) {
          element.textContent = error.message;
        }
      };
    });

    // Submit a rating or review.
    root.querySelectorAll("[data-review]").forEach(button => {
      button.onclick = async () => {
        if (!getToken()) {
          location.href = pagePrefix() + "auth/login.html";
          return;
        }

        const shopCard = button.closest(".result-card");
        const shopName = shopCard?.querySelector("h3")?.textContent?.trim() || "Selected shop";
        openReviewModal(button.dataset.review, shopName);
      };
    });

    // Open the report popup for the selected shop.
    root.querySelectorAll("[data-report]").forEach(button => {
      button.onclick = () => {
        if (!getToken()) {
          location.href = pagePrefix() + "auth/login.html";
          return;
        }

        const shopId = button.dataset.report;
        const shopCard = button.closest(".result-card");

        const shopName =
          shopCard?.querySelector("h3")?.textContent?.trim()
          || "Selected shop";

        openReportModal(shopId, shopName);
      };
    });
  }

  // Location autocomplete uses real API data, never invented locations.
  const locationFields = {
    province: "province-options",
    district: "district-options",
    municipality: "municipality-options",
    ward: "ward-options"
  };

  let locationRows = [];

  function uniqueValues(values) {
    return [...new Set(
      values
        .filter(value =>
          value !== null &&
          value !== undefined &&
          String(value).trim() !== ""
        )
        .map(value => String(value).trim())
    )].sort((a, b) => a.localeCompare(b));
  }

  function setSuggestions(field, values) {
    const list = $(locationFields[field]);
    if (!list) return;

    list.innerHTML = uniqueValues(values)
      .map(value => `<option value="${esc(value)}"></option>`)
      .join("");
  }

  function updateSuggestions() {
    const province = $("province")?.value.trim() || "";
    const district = $("district")?.value.trim() || "";
    const municipality = $("municipality")?.value.trim() || "";

    setSuggestions(
      "province",
      locationRows.map(row => row.province)
    );

    setSuggestions(
      "district",
      locationRows
        .filter(row =>
          (!province || row.province === province) &&
          (
            !district ||
            String(row.district || "")
              .toLowerCase()
              .includes(district.toLowerCase())
          )
        )
        .map(row => row.district)
    );

    setSuggestions(
      "municipality",
      locationRows
        .filter(row =>
          (!province || row.province === province) &&
          (!district || row.district === district) &&
          (
            !municipality ||
            String(row.municipality || "")
              .toLowerCase()
              .includes(municipality.toLowerCase())
          )
        )
        .map(row => row.municipality)
    );

    setSuggestions(
      "ward",
      locationRows
        .filter(row =>
          (!province || row.province === province) &&
          (!district || row.district === district) &&
          (!municipality || row.municipality === municipality)
        )
        .map(row => row.ward_no)
    );
  }

  async function loadLocations() {
    if (!$("province")) return;

    const note = $("location-note");

    try {
      const data = await request("/api/locations");

      locationRows = Array.isArray(data.locations)
        ? data.locations
        : [];

      updateSuggestions();

      if (note && locationRows.length === 0) {
        note.textContent =
          "Verified location suggestions are not available yet. You can still enter a location manually.";
      } else if (note) {
        note.textContent =
          "Type to see matching location suggestions, or enter a location manually.";
      }

    } catch (error) {
      console.error("Location loading failed:", error);

      if (note) {
        note.textContent =
          "Location suggestions are temporarily unavailable. You can still search using text fields.";
      }
    }
  }

  function getFilters(form) {
    const formData = new FormData(form);

    return {
      province: String(formData.get("province") || "").trim(),
      district: String(formData.get("district") || "").trim(),
      municipality: String(formData.get("municipality") || "").trim(),
      ward: String(formData.get("ward") || "").trim(),
      town: String(formData.get("town") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      cylinder: String(formData.get("cylinder") || "").trim(),
      quantity: String(formData.get("quantity") || "").trim()
    };
  }

  function hasSearchFilter(filters) {
    return [
      filters.province,
      filters.district,
      filters.municipality,
      filters.ward,
      filters.town,
      filters.location,
      filters.cylinder
    ].some(value => value !== "");
  }

  async function search(filters, root, kind = "all") {
    if (!root) return;

    root.innerHTML =
      `<p class="notice">Searching actual GAS-INFO records…</p>`;

    const queryFilters = { ...filters };

    if (!queryFilters.quantity) {
      delete queryFilters.quantity;
    }

    try {
      const data = await request(
        "/api/search?" + paramsToQuery(queryFilters)
      );

      let results = Array.isArray(data.results)
        ? data.results
        : [];

      if (kind === "high-rated") {
        results = results.filter(
          record => Number(record.rating) >= 4
        );
      } else if (kind === "others") {
        results = results.filter(
          record => Number(record.rating) < 4
        );
      }

      root.innerHTML = results.length
        ? results.map(card).join("")
        : `<div class="notice">We are still growing. We don't have matching data yet.</div>`;

      bindCards(root);

      const summary = $("search-summary");

      if (summary) {
        const lower = data.lowerQuantityAvailable
          ? ` Some shops reported a quantity below your requested amount (${esc(data.requestedQuantity)}); check each reported quantity carefully.`
          : "";

        summary.textContent =
          `${results.length} result(s) found.${lower}`;
      }

    } catch (error) {
      root.innerHTML =
        `<div class="notice">Could not load results: ${esc(error.message)}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ($("search-form")) {
      loadLocations();

      ["province", "district", "municipality", "ward"].forEach(id => {
        $(id)?.addEventListener("input", updateSuggestions);
        $(id)?.addEventListener("change", updateSuggestions);
      });

      const form = $("search-form");

      form.addEventListener("submit", async event => {
        event.preventDefault();

        const filters = getFilters(form);

        if (!hasSearchFilter(filters)) {
          (window.gasInfoNotify || ((m) => console.warn(m)))(
            "Please enter a location or a cylinder name before searching.", "warning"
          );
          return;
        }

        if (
          filters.quantity &&
          (
            !Number.isFinite(Number(filters.quantity)) ||
            Number(filters.quantity) < 1
          )
        ) {
          (window.gasInfoNotify || ((m) => console.warn(m)))("Quantity must be at least 1.", "warning");
          return;
        }

        sessionStorage.setItem(
          "gasInfoLastSearch",
          JSON.stringify(filters)
        );

        const resultsSection = $("results");

        if (resultsSection) {
          resultsSection.style.display = "block";
        }

        form.classList.remove("open");

        const root = $("results-list");

        await search(filters, root);

        resultsSection?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }

    const root = $("results-list");

    if (root && !$("search-form")) {
      let filters = {};

      try {
        filters = JSON.parse(
          sessionStorage.getItem("gasInfoLastSearch") || "{}"
        );
      } catch {
        filters = {};
      }

      const kind = document.body.dataset.resultKind || "all";

      if (!hasSearchFilter(filters)) {
        root.innerHTML =
          `<div class="notice">Go to Search / Explore and enter a location or cylinder name to find matching shops.</div>`;
        return;
      }

      search(filters, root, kind);
    }
  });
})();
