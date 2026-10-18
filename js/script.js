
const NAV = [
  ["Home","index.html"],
  ["Search / Explore","index.html#search"],
  ["Updates","updates.html"],
  ["Rate & Reviews","reviews.html"],
  ["Customer / Trader","auth/login.html"]
];

function renderNav(){
  const box=document.querySelector("#nav-links");
  const mobile=document.querySelector("#mobile-menu");
  if(!box||!mobile)return;
  const links=NAV.map(([t,h])=>`<a href="${h}">${t}</a>`).join("");
  box.innerHTML=links+`<button class="nav-btn" onclick="toggleTheme()">☾ Theme</button>`;
  mobile.innerHTML=links+`<a href="#" onclick="toggleTheme();return false">☾ Theme</a>`;
}
function toggleMenu(){document.querySelector("#mobile-menu")?.classList.toggle("open")}
function toggleTheme(){
  const light=document.body.classList.toggle("light");
  localStorage.setItem("gasinfo-theme",light?"light":"dark");
}
function loadTheme(){
  if(localStorage.getItem("gasinfo-theme")==="light")document.body.classList.add("light");
}
function openSearch(){
  document.querySelector("#search-form")?.classList.add("open");
  document.querySelector("#search-input")?.focus();
}
function closeSearch(){document.querySelector("#search-form")?.classList.remove("open")}
document.addEventListener("DOMContentLoaded",()=>{loadTheme();renderNav();});
