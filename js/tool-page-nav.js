const header = document.querySelector(".tools-header");

ensureStylesheet("./css/tools-mobile.css", "tools-mobile.css");
ensureStylesheet("./css/tool-header.css", "tool-header.css");

if (header) {
  const pages = [
    { href: "./index.html", label: "Cards", key: "index.html" },
    { href: "./collection.html", label: "Collection", key: "collection.html" },
    { href: "./battle.html", label: "Battle Sim", key: "battle.html" },
    { href: "./engines.html", label: "Engines", key: "engines.html" },
    { href: "./lab.html", label: "Deck Lab", key: "lab.html" }
  ];

  const current = location.pathname.split("/").pop() || "index.html";
  const title = header.querySelector(".tools-title");

  for (const page of pages) {
    let link = [...header.querySelectorAll("a[href]")].find(item => {
      const url = new URL(item.getAttribute("href"), location.href);
      return url.pathname.endsWith(`/${page.key}`);
    });

    if (page.key === current) {
      link?.classList.add("tools-page-link", "active");
      continue;
    }

    if (!link) {
      link = document.createElement("a");
      link.href = page.href;
      link.className = "button tools-page-link";
      link.textContent = page.label;
    } else {
      link.classList.add("tools-page-link");
    }

    if (title) header.insertBefore(link, title);
  }

  if (!document.querySelector(".tools-mobile-nav")) {
    const nav = document.createElement("nav");
    nav.className = "tools-mobile-nav";
    nav.setAttribute("aria-label", "Main pages");
    nav.innerHTML = [
      ["index.html", "./index.html", "Cards"],
      ["collection.html", "./collection.html", "Collection"],
      ["battle.html", "./battle.html", "Battle"]
    ].map(([key, href, label]) => `<a href="${href}"${key === current ? ' class="active" aria-current="page"' : ""}>${label}</a>`).join("");
    document.body.appendChild(nav);
  }
}

function ensureStylesheet(href, suffix) {
  if (document.querySelector(`link[href*="${suffix}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}
