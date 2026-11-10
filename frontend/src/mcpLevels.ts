import type { McpLevel } from './types'

/** Access levels of the MCP endpoint (Settings → AI assistants, consent page). */
export const MCP_LEVELS: { value: McpLevel; label: string; description: string }[] = [
  { value: 'read', label: 'Read only', description: 'See containers, stacks, settings, logs and update status. Cannot change anything.' },
  { value: 'basic', label: 'Read + basic actions', description: 'Also start, stop and restart containers and stacks, check for updates and update containers.' },
  {
    value: 'full',
    label: 'Full control',
    description: 'Also create, edit and remove containers and compose stacks, and run commands inside containers. Editing, removing and commands ask for your approval in the AI app.',
  },
]
