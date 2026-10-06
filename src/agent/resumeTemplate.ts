import type { AgentName } from './agentTypes';

const DEFAULT_TEMPLATES: Record<AgentName, string> = {
  claude: 'claude --resume {id}',
  codex: 'codex --no-daemon resume {id}',
};

export type ResumeTemplateSettings = Partial<Record<AgentName, string>>;

export class ResumeTemplate {
  constructor(private readonly templates: ResumeTemplateSettings = {}) {}

  render(agent: AgentName, id: string): string {
    return this.templateFor(agent).replaceAll('{id}', id);
  }

  private templateFor(agent: AgentName): string {
    const template = this.templates[agent];
    if (template && template.trim() !== '' && template.includes('{id}')) return template;
    return DEFAULT_TEMPLATES[agent];
  }
}
