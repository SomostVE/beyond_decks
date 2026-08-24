const statusRewrites = [
  {
    id: "battle-status",
    from: "win-rate benchmarking stays locked until rule coverage is stronger.",
    to: "replay and benchmark remain experimental for this matchup."
  },
  {
    id: "benchmark-status",
    from: "unresolved-rule rate",
    to: "rule-gap exposure rate"
  }
];

for (const { id, from, to } of statusRewrites) {
  const root = document.getElementById(id);
  if (!root) continue;

  const sync = () => {
    const text = root.textContent || "";
    if (text.includes(from)) root.textContent = text.replaceAll(from, to);
  };

  new MutationObserver(sync).observe(root, {
    childList: true,
    characterData: true,
    subtree: true
  });
  sync();
}
