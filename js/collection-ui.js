import "./tool-page-nav.js";

const page = document.querySelector(".collection-page");
const tabs = document.querySelector(".collection-tabs");

function resetCollectionScroll() {
  requestAnimationFrame(() => {
    if (!page) return;
    const header = document.querySelector(".collection-body > .tools-header");
    const offset = Number(header?.getBoundingClientRect().height || 0) + 8;
    const top = page.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
}

tabs?.querySelectorAll("[data-collection-tab]").forEach(button => {
  button.addEventListener("click", resetCollectionScroll);
});

document.addEventListener("click", event => {
  if (event.target.closest("[data-set-name]")) resetCollectionScroll();
  if (event.target.closest("#planner-missing [data-card-id]")) resetCollectionScroll();
});

const preview = document.createElement("dialog");
preview.className = "collection-card-preview";
preview.innerHTML = `
  <div class="collection-card-preview-head">
    <strong id="collection-preview-title"></strong>
    <button type="button" aria-label="Close card preview">×</button>
  </div>
  <div class="collection-card-preview-image-wrap">
    <img id="collection-preview-image" alt="">
  </div>
`;
document.body.append(preview);

const previewTitle = preview.querySelector("#collection-preview-title");
const previewImage = preview.querySelector("#collection-preview-image");
preview.querySelector("button")?.addEventListener("click", () => preview.close());

preview.addEventListener("click", event => {
  if (event.target !== preview) return;
  const rect = preview.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) preview.close();
});

document.addEventListener("click", event => {
  const image = event.target.closest(".collection-card-row img");
  if (!image) return;
  const row = image.closest(".collection-card-row");
  const name = row?.querySelector(".collection-card-copy > strong")?.textContent?.trim() || "Card preview";
  previewTitle.textContent = name;
  previewImage.src = image.currentSrc || image.src;
  previewImage.alt = name;
  if (!preview.open) preview.showModal();
});
