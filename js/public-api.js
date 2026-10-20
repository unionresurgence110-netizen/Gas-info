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

  function bindCards(root) {
    root.querySelectorAll("[data-reviews]").forEach(button => {
      button.onclick = async () => {
        const id = button.dataset.reviews;
        const element = $(`shop-reviews-${id}`);

        try {
          const data = await request(`/api/shops/${encodeURIComponent(id)}/reviews`);
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

    root.querySelectorAll("[data-review]").forEach(button => {
      button.onclick = async () => {
        if (!getToken()) {
          location.href = pagePrefix() + "auth/login.html";
          return;
        }

        const rating = Number(prompt("Give a rating from 1 to 5:"));
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;

        const reviewText = prompt("Optional written review (cancel to leave blank):") || "";

        try {
          await request(`/api/shops/${encodeURIComponent(button.dataset.review)}/reviews`, {
            method: "POST",
            body: JSON.stringify({ rating, review_text: reviewText })
          });
          alert("Review saved. Thank you.");
        } catch (error) {
          alert(error.message);
        }
      };
    });

    root.querySelectorAll("[data-report]").forEach(button => {
      button.onclick = async () => {
        if (!getToken()) {
          location.href = pagePrefix() + "auth/login.html";
          return;
        }

        const description = prompt("Describe the stock mismatch or incorrect shop information:");
        if (!description?.trim()) return;

        try {
          await request(`/api/shops/${encodeURIComponent(button.dataset.report)}/reports`, {
            method: "POST",
            body: JSON.stringify({
              report_type: "stock_mismatch",
              description: description.trim()
            })
          });
          alert("Report submitted for review.");
        } catch (error) {
          alert(error.message);
        }
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
    return [...new Set(values
      .filter(value => value !== null && value !== undefined && String(value).trim() !== "")
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

    const provinceRows = locationRows.filter(row =>
      !province || String(row.province || "").toLowerCase().includes(province.toLowerCase())
    );

    setSuggestions("province", locationRows.map(row => row.province));

    setSuggestions("district", locationRows
      .filter(row =>
        (!province || row.province === province) &&
        (!district || String(row.district || "").toLowerCase().includes(district.toLowerCase()))
      )
      .map(row => row.district)
    );

    setSuggestions("municipality", locationRows
      .filter(row =>
        (!province || row.province === province) &&
        (!district || row.district === district) &&
        (!municipality || String(row.municipality || "").toLowerCase().includes(municipality.toLowerCase()))
      )
      .map(row => row.municipality)
    );

    setSuggestions("ward", locationRows
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
      locationRows = Array.isArray(data.locations) ? data.locations : [];

      updateSuggestions();

      if (note && locationRows.length === 0) {
        note.textContent = "Verified location suggestions are not available yet. You can still enter a location manually.";
      } else if (note) {
        note.textContent = "Type to see matching location suggestions, or enter a location manually.";
      }
    } catch (error) {
      console.error("Location loading failed:", error);
      if (note) {
        note.textContent = "Location suggestions are temporarily unavailable. You can still search using text fields.";
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

    root.innerHTML = `<p class="notice">Searching actual GAS-INFO records…</p>`;

    const queryFilters = { ...filters };

    // Quantity is optional; it is not a search criterion by itself.
    if (!queryFilters.quantity) delete queryFilters.quantity;

    try {
      const data = await request("/api/search?" + paramsToQuery(queryFilters));
      let results = Array.isArray(data.results) ? data.results : [];

      if (kind === "high-rated") {
        results = results.filter(record => Number(record.rating) >= 4);
      } else if (kind === "others") {
        results = results.filter(record => Number(record.rating) < 4);
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
        summary.textContent = `${results.length} result(s) found.${lower}`;
      }
    } catch (error) {
      root.innerHTML = `<div class="notice">Could not load results: ${esc(error.message)}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Set up autocomplete on the homepage.
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
          alert("Please enter a location or a cylinder name before searching.");
          return;
        }

        if (filters.quantity && (!Number.isFinite(Number(filters.quantity)) || Number(filters.quantity) < 1)) {
          alert("Quantity must be at least 1.");
          return;
        }

        sessionStorage.setItem("gasInfoLastSearch", JSON.stringify(filters));

        const resultsSection = $("results");
        if (resultsSection) resultsSection.style.display = "block";

        // Close the expanded form after a valid search.
        form.classList.remove("open");

        const root = $("results-list");
        await search(filters, root);

        resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    // Results pages automatically reuse the last valid homepage search.
    const root = $("results-list");

    if (root && !$("search-form")) {
      let filters = {};

      try {
        filters = JSON.parse(sessionStorage.getItem("gasInfoLastSearch") || "{}");
      } catch {
        filters = {};
      }

      const kind = document.body.dataset.resultKind || "all";

      if (!hasSearchFilter(filters)) {
        root.innerHTML = `<div class="notice">Go to Search / Explore and enter a location or cylinder name to find matching shops.</div>`;
        return;
      }

      search(filters, root, kind);
    }
  });
})();
                          
