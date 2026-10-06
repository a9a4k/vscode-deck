import { describe, expect, it } from 'vitest';
import { ResumeTemplate } from '../src/agent/resumeTemplate';

describe('ResumeTemplate', () => {
  it('renders the default Claude resume command', () => {
    expect(new ResumeTemplate().render('claude', 'abc-123')).toBe('claude --resume abc-123');
  });

  it('runs the default Codex resume unshared', () => {
    expect(new ResumeTemplate().render('codex', 'codex-123')).toBe(
      'codex --no-daemon resume codex-123',
    );
  });

  it('renders a Codex override with the session id substituted', () => {
    expect(new ResumeTemplate({
      codex: 'codex --dangerously-bypass-approvals-and-sandbox resume {id}',
    }).render('codex', 'codex-123')).toBe(
      'codex --dangerously-bypass-approvals-and-sandbox resume codex-123',
    );
  });

  it('falls back when a template is empty or missing the id placeholder', () => {
    const template = new ResumeTemplate({
      claude: '',
      codex: 'codex resume',
    });

    expect(template.render('claude', 'abc-123')).toBe('claude --resume abc-123');
    expect(template.render('codex', 'codex-123')).toBe('codex --no-daemon resume codex-123');
  });
});
