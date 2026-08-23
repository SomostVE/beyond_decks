if (document.getElementById("dependency-graph")) {
  import("./lab-combo-explorer.js");
  import("./lab-turn-planner.js");
  import("./lab-combo-cost.js");
}

if (document.querySelector(".engines-page")) {
  import("./engines-shared.js");
  import("./engines-impact.js");
}

if (document.querySelector(".sidebar")) {
  import("./deck-only-view.js");
}

if (document.querySelector(".battle-page")) {
  import("./battle-v2-ui.js");
}
