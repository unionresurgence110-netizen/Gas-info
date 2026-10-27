
// ===== PART 1 START =====
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

  const getToken = () => localStorage.getItem("gasInfoToken") || "";

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
          <span class="tag">Reported stock: ${esc(r.quantity)} ${esc(r.cylinder_name)}${Number(r.quantity) <= 0 ? " — OUT OF STOCK" : ""}</span>
        </p>

        ${r.distance_km != null && Number.isFinite(Number(r.distance_km))
          ? `<p class="muted">Approx. straight-line distance: ${Number(r.distance_km).toFixed(2)} km away</p>`
          : ""}

        <p>${esc([
          r.exact_location,
          r.town_village,
          r.ward_no != null && r.ward_no !== "" ? "Ward " + r.ward_no : "",
          r.municipality,
          r.district,
          r.province
        ].filter(Boolean).join(", "))}</p>

        ${hasCoords
          ? `<p><a class="shop-map-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">View shop pin on map</a> · <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.latitude + "," + r.longitude)}" target="_blank" rel="noopener noreferrer">Get directions</a></p>`
          : `<p class="muted">Map pin and directions are not available for this shop yet.</p>`}

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

// ===== PART 1 END — PART 2 CONTINUES BELOW =====
 
// ===== PART 2 START =====

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

// ===== PART 2 END — PART 3 CONTINUES BELOW =====
      
// ===== PART 3 START =====

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
  let currentSearchLocation = null;
  let savedSearchLocation = null;

  function locationNote(message, kind = "info") {
    const note = $("location-note");
    if (!note) return;
    note.textContent = message;
    note.classList.toggle("error", kind === "error");
  }

  function applySearchLocation(location, message) {
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
      locationNote("That location could not be used. Please try again.", "error");
      return;
    }
    currentSearchLocation = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      label: String(location.label || "Selected location")
    };
    locationNote(message || `${currentSearchLocation.label} selected. Press Search to find nearby shops.`);
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) {
      locationNote("This browser does not support location. Enable location services or use the text fields to search.", "error");
      return;
    }
    locationNote("Requesting your current location…");
    navigator.geolocation.getCurrentPosition(
      position => {
        applySearchLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Current location"
        }, "Current location found. Press Search to find nearby shops, or Save My Location to keep it in your account.");
      },
      error => {
        let message = "Could not get your location. Enable device location and allow location permission for this browser, then tap Use My Location to retry.";
        if (error && error.code === 1) message = "Location permission was denied. Enable location permission for this browser in your device/app settings, then tap Use My Location to retry.";
        else if (error && error.code === 2) message = "Your device could not determine the location. Turn on device location/GPS, then tap Use My Location to retry.";
        else if (error && error.code === 3) message = "Location request timed out. Check device location/GPS, then tap Use My Location to retry.";
        locationNote(message, "error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function loadSavedLocation() {
    if (!getToken()) return;
    try {
      const data = await request("/api/customer/location");
      savedSearchLocation = data.location || null;
      if ($("use-saved-location")) $("use-saved-location").hidden = !savedSearchLocation;
      if ($("clear-saved-location")) $("clear-saved-location").hidden = !savedSearchLocation;
      if (savedSearchLocation) locationNote(`Saved location available: ${savedSearchLocation.label || "Saved location"}. You can use it for this search.`);
    } catch (error) {
      // Keep guest search usable; account-location loading is optional.
      console.warn("Saved location could not be loaded:", error.message);
    }
  }

  async function saveCurrentLocation() {
    if (!getToken()) {
      locationNote("To save a location to your account, please log in or register. You can still use My Location without an account.");
      const note = $("location-note");
      if (note) {
        const link = document.createElement("a");
        link.href = "auth/login.html";
        link.textContent = " Log in / Register";
        note.appendChild(link);
      }
      return;
    }
    if (!currentSearchLocation) {
      locationNote("First tap Use My Location and allow location permission. You can then save that location.", "error");
      return;
    }
    try {
      const data = await request("/api/customer/location", {
        method: "PUT",
        body: JSON.stringify({
          latitude: currentSearchLocation.latitude,
          longitude: currentSearchLocation.longitude,
          label: currentSearchLocation.label || "Saved location"
        })
      });
      savedSearchLocation = data.location;
      if ($("use-saved-location")) $("use-saved-location").hidden = false;
      if ($("clear-saved-location")) $("clear-saved-location").hidden = false;
      locationNote("Location saved to your account. It stays saved until you update or clear it.");
    } catch (error) {
      locationNote(`Could not save location: ${error.message}`, "error");
    }
  }

  async function clearSavedLocation() {
    if (!getToken()) return;
    try {
      await request("/api/customer/location", { method: "DELETE" });
      savedSearchLocation = null;
      if ($("use-saved-location")) $("use-saved-location").hidden = true;
      if ($("clear-saved-location")) $("clear-saved-location").hidden = true;
      locationNote("Saved location cleared from your account.");
    } catch (error) {
      locationNote(`Could not clear saved location: ${error.message}`, "error");
    }
  }

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

// ===== PART 3 END — PART 4 CONTINUES BELOW =====
          // ===== PART 4 START =====

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
      quantity: String(formData.get("quantity") || "").trim(),
      ...(currentSearchLocation ? {
        latitude: String(currentSearchLocation.latitude),
        longitude: String(currentSearchLocation.longitude)
      } : {})
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
      filters.cylinder,
      filters.latitude,
      filters.longitude
    ].some(value => value !== "");
  }

  async function search(filters, root, kind = "all", options = {}) {
    if (!root) return false;

    root.innerHTML =
      `<p class="notice">Searching actual GAS-INFO records…</p>`;

    const queryFilters = { ...(filters || {}) };
    if (options.lowerQuantityOnly) queryFilters.lowerQuantityOnly = "true";
    if (options.allowLocationFallback) queryFilters.allowLocationFallback = "true";

    // Category pages intentionally ignore the previous search filters.
    if (options.categoryPage) {
      Object.keys(queryFilters).forEach(key => delete queryFilters[key]);
    }

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
        results = results.filter(record => Number(record.rating) >= 4);
      } else if (kind === "others") {
        results = results.filter(record => Number(record.rating) < 4);
      }

      // The backend returns distance_km and ranks by distance when valid customer
      // coordinates are supplied. Without coordinates, it uses progressive text-location matching.
      const missingFields = Array.isArray(data.unmatchedLocationFields) ? data.unmatchedLocationFields : [];
      const missingLocationNote = missingFields.length && !options.categoryPage
        ? `<div class="notice">We don't have matching location data for: ${missingFields.map(esc).join(", ")}.</div>`
        : "";
      const fallbackPrompt = data.fallbackAvailable && !options.categoryPage
        ? `<div class="notice"><p>Would you like to continue using the other location details you entered? Results may be from a broader area, so check each shop's address.</p><button class="btn secondary" id="continue-location-fallback" type="button">Search using available location details</button></div>`
        : "";
      root.innerHTML = missingLocationNote + fallbackPrompt + (results.length
        ? results.map(card).join("")
        : options.lowerQuantityOnly
          ? `<div class="notice">No shops currently report a positive quantity below your requested amount. Stock information may change after a trader updates it.</div>`
          : missingFields.length && !data.fallbackAvailable && !options.allowLocationFallback
            ? `<div class="notice">No matching location details were found. Try a broader location or search by cylinder name.</div>`
            : !results.length && options.allowLocationFallback
              ? `<div class="notice">No actual shops match the available location details yet. Try a broader location or search by cylinder name.</div>`
              : `<div class="notice">We are still growing. We don't have the data yet.</div>`);

      bindCards(root);
      $("continue-location-fallback")?.addEventListener("click", () => {
        search(filters, root, kind, { ...options, allowLocationFallback: true });
      });

      if (data.lowerQuantityAvailable && !options.categoryPage && !options.lowerQuantityOnly && !data.fallbackAvailable && Number(data.requestedQuantity) > 1) {
        root.insertAdjacentHTML("beforeend", `<div class="notice"><p>Some shops report a positive quantity below your requested amount (${esc(data.requestedQuantity)}).</p><button class="btn secondary" id="show-lower-quantity" type="button">Show shops with lower quantity</button></div>`);
        $("show-lower-quantity")?.addEventListener("click", () => {
          search(filters, root, kind, { ...options, lowerQuantityOnly: true });
        });
      }

      const summary = $("search-summary");
      if (summary) {
        summary.textContent = options.categoryPage
          ? `${results.length} shop result(s) loaded from current GAS-INFO records.`
          : options.lowerQuantityOnly
            ? `${results.length} shop(s) report a positive quantity below your requested amount.`
            : `${results.length} result(s) found.`;
      }

      return true;
    } catch (error) {
      root.innerHTML =
        `<div class="notice">Could not load results: ${esc(error.message)}</div>`;
      const summary = $("search-summary");
      if (summary) summary.textContent = "Results could not be loaded. Please try again.";
      return false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const isNearbyPage = document.body.dataset.page === "nearby";
    const categoryKind = document.body.dataset.resultKind || "";
    const resultRoot = $("results-list");
    const nearbyRoot = $("nearby-results-list");

    if ($("search-form")) {
      loadLocations();
      loadSavedLocation();
      $("use-my-location")?.addEventListener("click", getCurrentLocation);
      $("save-my-location")?.addEventListener("click", saveCurrentLocation);
      $("use-saved-location")?.addEventListener("click", () => {
        if (savedSearchLocation) applySearchLocation(savedSearchLocation, `Saved location selected (${savedSearchLocation.label || "Saved location"}). Press Search to continue.`);
      });
      $("clear-saved-location")?.addEventListener("click", clearSavedLocation);

      ["province", "district", "municipality", "ward"].forEach(id => {
        $(id)?.addEventListener("input", updateSuggestions);
        $(id)?.addEventListener("change", updateSuggestions);
      });
      ["province", "district", "municipality", "ward", "town", "location"].forEach(id => {
        $(id)?.addEventListener("input", () => {
          if (currentSearchLocation) {
            currentSearchLocation = null;
            locationNote("Manual location details selected. Search will use those details instead of GPS coordinates.");
          }
        });
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
          (window.gasInfoNotify || ((m) => console.warn(m)))(
            "Quantity must be at least 1.", "warning"
          );
          return;
        }

        localStorage.setItem("gasInfoLastSearch", JSON.stringify(filters));

        const resultsSection = $("results");
        if (resultsSection) resultsSection.style.display = "block";
        form.classList.remove("open");

        const nearbyEntry = $("nearby-entry");
        if (nearbyEntry) nearbyEntry.hidden = true;

        const success = await search(filters, resultRoot);

        // Reveal Nearby only after the API returned successfully.
        if (success && nearbyEntry) nearbyEntry.hidden = false;

        resultsSection?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }

    // Category pages are independent of the customer's last search.
    if (resultRoot && categoryKind) {
      search({}, resultRoot, categoryKind, { categoryPage: true });
      return;
    }

    // Nearby page uses the last valid search and actual backend results.
    if (isNearbyPage && nearbyRoot) {
      let filters = {};
      try {
        filters = JSON.parse(localStorage.getItem("gasInfoLastSearch") || "{}");
      } catch {
        filters = {};
      }

      if (!hasSearchFilter(filters)) {
        nearbyRoot.innerHTML =
          `<div class="notice">Start from Search / Explore and enter a location or cylinder name before opening Nearby.</div>`;
        const summary = $("search-summary");
        if (summary) summary.textContent = "No previous search found.";
        return;
      }

      search(filters, nearbyRoot, "nearby");
      return;
    }

    // Compatibility fallback for any older result page without a category marker.
    if (resultRoot && !$("search-form")) {
      let filters = {};
      try {
        filters = JSON.parse(localStorage.getItem("gasInfoLastSearch") || "{}");
      } catch {
        filters = {};
      }

      if (!hasSearchFilter(filters)) {
        resultRoot.innerHTML =
          `<div class="notice">Go to Search / Explore and enter a location or cylinder name to find matching shops.</div>`;
        return;
      }

      search(filters, resultRoot);
    }
  });
})();

// ===== PART 4 END =====    
