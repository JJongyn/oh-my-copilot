import type { SkillDefinition } from './types';

export const BUNDLED_SKILLS: SkillDefinition[] = [
  {
    name: 'playwright',
    source: 'bundled',
    description: 'Browser automation, testing, screenshots, and page interaction workflow.',
    preferredAgent: 'hephaestus',
    recommendedMcpServers: ['playwright'],
    tags: ['browser', 'testing', 'automation'],
    systemPrompt: `You are using the playwright skill.

Use this skill when the task involves browser automation, screenshots, user flows, scraping, or interactive verification in a real page.

When active:
- Prefer Playwright-style browser operations when available through MCP or editor tools
- Use browser automation to verify UI behavior instead of guessing
- Be explicit when the environment does not expose a browser tool, then fall back to static code analysis or local implementation
- Keep browser steps purposeful and tied to the user's task`,
  },
  {
    name: 'git-master',
    source: 'bundled',
    description: 'Git-focused skill for status, diff, history analysis, and clean commit preparation.',
    preferredAgent: 'sisyphus',
    tags: ['git', 'history', 'review'],
    systemPrompt: `You are using the git-master skill.

Use this skill when the task involves repository history, commit hygiene, branch state, blame, bisect, or preparing precise changes.

When active:
- Prefer focused git inspection before making assumptions about change history
- Use concise, atomic repository operations
- Surface risk when the worktree is dirty or when unrelated changes are present
- Keep commit-oriented reasoning clean and explicit`,
  },
  {
    name: 'stich-design',
    source: 'bundled',
    description: 'Unified UI and design workflow skill inspired by Google Stitch.',
    preferredAgent: 'basic',
    recommendedMcpServers: ['stitch'],
    tags: ['ui', 'design', 'stitch'],
    systemPrompt: `You are using the stich-design skill.

Use this skill for UI and product design work where the user wants stronger visual direction, clearer layout intent, and design-system awareness.

When active:
- Improve vague UI requests into concrete design goals
- Identify typography, spacing, hierarchy, color, and interaction decisions
- Prefer structured design direction over generic UI boilerplate
- If Stitch MCP or equivalent design-generation tools are available, use them
- If those tools are unavailable, say so clearly and continue with the best local implementation or review path

Always keep the output grounded in the current codebase and existing product constraints.`,
  },
  {
    name: 'stich-loop',
    source: 'bundled',
    description: 'Multi-screen UI generation and iteration workflow inspired by Stitch.',
    preferredAgent: 'atlas',
    recommendedMcpServers: ['stitch'],
    tags: ['ui', 'workflow', 'stitch'],
    systemPrompt: `You are using the stich-loop skill.

Use this skill when the user wants a larger UI flow, not a single isolated component.

When active:
- Think in screens, routes, and shared layout patterns
- Plan generation or editing as a sequence: explore, define structure, implement, validate
- Keep files organized and avoid dumping all UI into one file
- If a Stitch-style MCP workflow exists, use it to iterate on multiple screens
- If not, emulate the same discipline locally with explicit file structure and verification`,
  },
  {
    name: 'stich-design-md',
    source: 'bundled',
    description: 'Generate or update design-system documentation in a DESIGN.md style.',
    preferredAgent: 'prometheus',
    tags: ['docs', 'design-system', 'stitch'],
    systemPrompt: `You are using the stich-design-md skill.

Use this skill to analyze an interface and write or refresh semantic design documentation.

When active:
- Describe design systems in plain language, not raw token dumps
- Capture typography, spacing, density, color, tone, component rhythm, and motion
- Produce documentation that helps future screen generation or frontend implementation
- Prefer stable design language over transient implementation details`,
  },
  {
    name: 'stich-enhance-prompt',
    source: 'bundled',
    description: 'Turn vague UI ideas into stronger design prompts.',
    preferredAgent: 'basic',
    tags: ['prompting', 'ui', 'stitch'],
    systemPrompt: `You are using the stich-enhance-prompt skill.

Use this skill when a UI request is too vague.

When active:
- Rewrite weak prompts into concrete, high-signal design instructions
- Add missing UX context, atmosphere, hierarchy, and interaction intent
- Keep the rewritten prompt concise, specific, and directly usable for implementation or generation
- Do not add fantasy details unrelated to the product goal`,
  },
  {
    name: 'stich-react-components',
    source: 'bundled',
    description: 'Translate screen-level UI into React component systems.',
    preferredAgent: 'hephaestus',
    tags: ['react', 'components', 'stitch'],
    systemPrompt: `You are using the stich-react-components skill.

Use this skill for converting screen concepts into maintainable React components.

When active:
- Extract reusable components instead of repeating screen markup
- Preserve consistent tokens, spacing, and state behavior
- Prefer composition over oversized monolithic components
- Verify that the output matches the codebase's React patterns`,
  },
  {
    name: 'stich-remotion',
    source: 'bundled',
    description: 'Plan or generate UI walkthrough video assets with Remotion-style structure.',
    preferredAgent: 'atlas',
    tags: ['video', 'remotion', 'stitch'],
    systemPrompt: `You are using the stich-remotion skill.

Use this skill when the user wants a walkthrough, demo video, or animated product tour.

When active:
- Think in scenes, transitions, overlays, pacing, and narration beats
- Organize the work into reusable video components where possible
- Be explicit about what can only be planned versus what can be generated in the current environment`,
  },
  {
    name: 'stich-shadcn-ui',
    source: 'bundled',
    description: 'Guide and implementation help for shadcn/ui-style component work.',
    preferredAgent: 'hephaestus',
    tags: ['shadcn', 'react', 'ui', 'stitch'],
    systemPrompt: `You are using the stich-shadcn-ui skill.

Use this skill when the user is building or extending a shadcn/ui-based interface.

When active:
- Favor existing component primitives and composition patterns
- Avoid unnecessary divergence from the current design system
- Be explicit about installation or generator steps if the project is missing required components
- Keep variants and styling consistent across the component set`,
  },
];
