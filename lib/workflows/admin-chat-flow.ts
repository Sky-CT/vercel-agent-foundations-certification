import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import {
  bash,
  getAllCategories,
  getInventoryStock,
  getReturnsHistory,
  getSalesAnalytics,
  getSupportTickets,
  searchProducts,
} from "@/lib/tools";
import { createOrGetSandbox, SANDBOX_NAME } from "@/lib/sandbox";

export async function readMemories() {
  "use step";
  const sandbox = await createOrGetSandbox(SANDBOX_NAME);
  // Same absolute path the agent is told to append to. A relative
  // "memories.md" is resolved from the session cwd, which is not always
  // /vercel/sandbox when bash runs as a login shell.
  const buffer = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/memories.md",
  });
  if (!buffer) return null;
  const text = new TextDecoder().decode(buffer).trim();
  return text.length > 0 ? text : null;
}

export const backOfficeInstructions = `You are the back-office assistant for the Vercel swag store. You have read-only access to returns, inventory, sales, and support tickets through tools, and a persistent bash sandbox for computation.

## Tools
- Returns: getReturnsHistory
- Inventory: getInventoryStock
- Sales: getSalesAnalytics
- Support: getSupportTickets
- Computation: bash (persistent sandbox)

## How to answer
- All prices, refund amounts, and revenues are in cents. Convert to dollars in user-facing answers (e.g. 2800 → $28.00).
- Be concrete: name specific products, give specific numbers, and state the date range you used.
- If the user gives a vague time window ("this month", "recently"), pick a sensible range, state it explicitly, and proceed.
- For multi-step inference (return rates, day-over-day trends, spike detection, joins between sales and returns), prefer the bash tool: write fetched JSON to /tmp with a heredoc, then run python3 (stdlib only, no pandas) to compute. Don't eyeball aggregates over more than ~10 rows.
- Keep answers short and scannable. Lead with the headline number or finding, then a brief breakdown.
- Never promise to change anything in the store, you have read-only tools.`;

export async function adminChatFlow(messages: UIMessage[]) {
  "use workflow";

  const modelMessages = await convertToModelMessages(messages);

  const memories = await readMemories();

  const agent = new WorkflowAgent({
    model: "anthropic/claude-sonnet-5",
    instructions: [
      backOfficeInstructions,
      "",
      "## Memory protocol",
      "You have a memories.md file at /vercel/sandbox/memories.md. Append to it with the bash tool.",
      "",
      memories
        ? `## Current memories\n\nThese are the contents of /vercel/sandbox/memories.md, already loaded for this turn. Use them. Do not say the file is missing.\n\n${memories}`
        : "## Current memories\n\nThe preloaded read of /vercel/sandbox/memories.md was empty. That does not mean the file is missing. If the user asks about memories, run `cat /vercel/sandbox/memories.md` with bash before you answer. Only say there are no memories after that command shows the file is absent or empty.",
      "",
      "## Priority order for any request",
      "1. Check your memories above and any scripts logged under '## Scripts for common tasks'. If a saved script handles this request, run it with bash and return the output.",
      "2. Otherwise, do the task using the data tools and bash.",
      "3. After answering, decide whether the task could be a reusable script for next time.",
      "",
      "## When to save",
      "Append a line to memories.md when the user shares something that should color future answers:",
      "- Presentation preferences (percentages vs raw counts, terse vs detailed breakdowns, currency formatting)",
      "- Business context that's not derivable from the data (which products are seasonal, what 'normal' looks like for a metric, which stakeholder cares about what)",
      "- Explanations the user has given for past anomalies so you don't re-flag them next time",
      "- Corrections or feedback the user gave you on a prior answer",
      "",
      "Do NOT save routine questions, one-off lookups, or anything you can re-derive from the data tools.",
      "",
      "## How to use memory",
      "Read the current memories above so prior context shapes your reply.",
      "When you notice the user repeating a question, giving feedback like 'show this as %', or correcting a past answer, append a one-liner to memories.md.",
      "Don't interview the user. Capture signal opportunistically as it comes up.",
      "",
      "## Reusable scripts",
      "After answering a recurring operational question (top sellers last week, refund rate by category, weekly summary), consider writing a Python script that produces the same report on demand.",
      "Save scripts to /vercel/sandbox/scripts/<name>.py so the user can re-run them later with `python3 scripts/<name>.py` instead of asking you again.",
      "Stdlib only, no pandas. Make scripts self-contained and well-commented. Always invoke with `python3`, never `python`.",
      "After creating a script, log it in memories.md under '## Scripts for common tasks' with the filename and a one-line description (e.g. `top_sellers_last_week.py: top 10 SKUs by units sold in the last 7 days`).",
    ].join("\n"),
    tools: {
      bash,
      getReturnsHistory,
      getInventoryStock,
      getSalesAnalytics,
      getSupportTickets,
      searchProducts,
      getAllCategories,
    },
  });

  await agent.stream({
    messages: modelMessages,
    writable: getWritable<ModelCallStreamPart>(),
  });
}
