
const navItems = [
  ["Home","index.html"],
  ["Search","index.html#search"],
  ["All","results/all.html"],
  ["High-Rated","results/high-rated.html"],
  ["Others","results/others.html"],
  ["Nearby","nearby.html"],
  ["Updates","updates.html"],
  ["Reviews","reviews.html"],
  ["About Us","about.html"],
  ["Contact","contact.html"]
];

function renderShell(){
  const header = document.querySelector("#site-header");
  if(header){
    header.innerHTML = `
      <div class="container">
        <div class="nav">
          <a class="logo" href="index.html">GAS<span>-INFO</span></a>
          <div class="nav-links">
            ${navItems.map(([t,u])=>`<a href="${u}">${t}</a>`).join("")}
            <a href="auth/login.html">Login</a>
            <a href="auth/register.html">Register</a>
            <button id="themeBtn" type="button">☼/☾</button>
          </div>
          <button class="nav-toggle" id="navToggle" type="button">☰</button>
        </div>
        <div class="mobile-menu" id="mobileMenu">
          ${navItems.map(([t,u])=>`<a href="${u}">${t}</a>`).join("")}
          <a href="auth/login.html">Login</a>
          <a href="auth/register.html">Register</a>
          <button id="themeBtnMobile" type="button">Toggle theme</button>
        </div>
      </div>`;
    document.querySelector("#navToggle")?.addEventListener("click",()=>{
      document.querySelector("#mobileMenu")?.classList.toggle("open");
    });
    document.querySelector("#themeBtn")?.addEventListener("click",toggleTheme);
    document.querySelector("#themeBtnMobile")?.addEventListener("click",toggleTheme);
  }
  const footer = document.querySelector("#site-footer");
  if(footer){
    footer.innerHTML = `
      <div class="container">
        <strong>GAS-INFO</strong>
        <div class="footer-links">
          <a href="terms.html">Terms & Penalties</a>
          <a href="legal.html">Legal & Compliance</a>
          <a href="contact.html">Contact / Report</a>
        </div>
        <p>GAS-INFO is an information platform. Stock information is trader-provided and may change at any time.</p>
        <small>© <span id="year"></span> GAS-INFO. Final legal/contact details should be reviewed before launch.</small>
      </div>`;
    document.querySelector("#year").textContent = new Date().getFullYear();
  }
}
function toggleTheme(){
  document.body.classList.toggle("light");
  localStorage.setItem("gasinfo-theme",document.body.classList.contains("light")?"light":"dark");
}
function loadTheme(){
  if(localStorage.getItem("gasinfo-theme")==="light") document.body.classList.add("light");
}
function setupSearch(){
  const trigger=document.querySelector("#searchTrigger");
  const panel=document.querySelector("#searchPanel");
  const close=document.querySelector("#closeSearch");
  if(trigger&&panel) trigger.addEventListener("click",()=>panel.classList.add("open"));
  if(close&&panel) close.addEventListener("click",()=>panel.classList.remove("open"));

  const form=document.querySelector("#gasSearchForm");
  if(form){
    form.addEventListener("submit",(e)=>{
      e.preventDefault();
      const result=document.querySelector("#searchResult");
      if(result){
        result.innerHTML = `
          <div class="notice">
            <strong>Search submitted.</strong>
            <p>This Phase 1 build has no live database yet, so it will not invent shop or stock information.</p>
            <p>When the database/search phase is connected, results will use the selected Province → District → Municipality → Ward → Town/Village → Exact Location → Cylinder → Quantity.</p>
          </div>`;
      }
    });
  }
}
document.addEventListener("DOMContentLoaded",()=>{
  loadTheme();
  renderShell();
  setupSearch();
});
