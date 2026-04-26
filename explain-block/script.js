/* explain-block v1.0.0
 *
 * Adds command-palette commands to "explain" the focused block via LiveAI_API.
 * Three modes:
 *   - Brief: 2-3 sentences inserted as a single child block
 *   - Detailed: structured explanation as nested children
 *   - Translate: translate to/from Russian (Svy is bilingual)
 *
 * Uses roamContext to pull the block + breadcrumb path automatically — no
 * need to copy-paste anywhere.
 *
 * Requires: Live AI Assistant with "Enable Public API" toggled ON.
 */
;(function () {
  const VERSION = "1.0.0";
  const NAMESPACE = "explain-block";

  const log = (lvl, msg, data) =>
    console[lvl](`[${NAMESPACE}] ${msg}`, data ?? "");

  function focusedBlock() {
    return window.roamAlphaAPI.ui.getFocusedBlock();
  }

  async function callAndInsert({ uid, systemPrompt, prompt, model, headerLabel }) {
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available");
      return;
    }
    log("info", `running on ((${uid})): ${headerLabel}`);
    try {
      await window.LiveAI_API.generate({
        prompt,
        systemPrompt,
        useDefaultSystemPrompt: true,  // keep Roam formatting rules
        model,
        roamContext: {
          block: true, blockArgument: [uid],
          path: true, pathDepth: 3,
          children: true,
        },
        output: "insert",
        targetUid: uid,
        targetBlockTitle: undefined,  // children inserted directly under the focused block
        caller: `${NAMESPACE}/${VERSION}`,
      });
      log("info", `done: ${headerLabel}`);
    } catch (e) {
      log("error", `failed: ${headerLabel}`, e);
    }
  }

  function registerCommands() {
    const add = (label, cb) => {
      try { window.roamAlphaAPI.ui.commandPalette.addCommand({ label, callback: cb }); }
      catch (e) { log("warn", `add cmd failed: ${label}`, e); }
    };

    add("Explain block (brief)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "You are explaining a Roam block to its writer. They wrote it; they know the surface meaning. Surface what's IMPLICIT — what they assume the reader knows, what's NOT said but matters, why this matters in the context of the parent path. Keep it to 2-3 sentences. Do not restate the block. Do not flatter. Plain prose, no lists.",
        prompt: "Explain in 2-3 sentences. Focus on what's implicit or assumed.",
        headerLabel: "explain (brief)",
      });
    });

    add("Explain block (detailed, nested)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "You are providing a detailed explanation of a Roam block to its writer. Structure: a brief plain-language restatement (1 sentence), then 2-4 hierarchical bullets covering: implicit assumptions, what's missing or unclear, key tradeoffs or alternatives, and one suggested next action if relevant. Use Roam's hierarchical bullet format. Be direct, no filler.",
        prompt: "Explain in detail with hierarchical bullets.",
        headerLabel: "explain (detailed)",
      });
    });

    add("Explain block: translate (English ↔ Russian)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Translate the focused block. If the source is English, output Russian. If the source is Russian, output English. Preserve any technical terms, proper nouns, code, and Roam syntax (block refs, page links, attribute :: blocks) verbatim. Output a single block with just the translation — no commentary, no source-language repetition.",
        prompt: "Translate as instructed.",
        headerLabel: "translate",
      });
    });

    add("Explain block: critique (Lori Boyd lens)", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Critique the focused block as Lori Boyd (senior QA reviewer at ByHeart) would. Focus on: data without context (numbers without denominators or scales), undefined terms or abbreviations, ambiguous procedure language (and/or, to/from, as needed), copy-paste leftovers, logical flow gaps. For each issue, quote the offending phrase and suggest a concrete fix. If there are no issues, say so in one sentence. Use bullet points.",
        prompt: "Critique with Lori's pragmatic-QA lens.",
        headerLabel: "lori critique",
      });
    });

    add("Explain block: define unfamiliar terms", async () => {
      const f = focusedBlock();
      if (!f) return log("info", "no focused block");
      await callAndInsert({
        uid: f["block-uid"],
        systemPrompt:
          "Identify any acronyms, technical terms, jargon, or proper nouns in the focused block that a general reader might not know. For each, give a one-line plain definition. Use one bullet per term. If everything is universally clear, write a single bullet '(no unfamiliar terms found)'.",
        prompt: "List and define unfamiliar terms.",
        headerLabel: "define terms",
      });
    });
  }

  function init() {
    log("info", `v${VERSION} starting`);
    if (!window.LiveAI_API?.isAvailable()) {
      log("warn", "LiveAI_API not available yet — script will start, calls will fail until LiveAI loads with public API enabled.");
    }
    registerCommands();
    log("info", "ready — open command palette and type 'Explain block'");
  }

  init();
})();
