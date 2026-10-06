import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAgentHookScript } from '../src/agent/agentHookScript';

const tempRoots: string[] = [];

describe('renderAgentHookScript', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders atomic sidecar writes without redirecting into the sidecar path', () => {
    const script = renderAgentHookScript('/tmp/deck/hooks');

    expect(script).not.toContain('> "$sidecar_dir/$DECK_SESSION.json"');
    expect(script).toContain('tmp=$(mktemp "$sidecar_dir/$DECK_SESSION.XXXXXX")');
    expect(script).toContain('mv "$tmp" "$sidecar_dir/$DECK_SESSION.json"');
  });

  it('writes a Claude sidecar keyed by DECK_SESSION', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    const sidecar = JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(sidecar).toMatchObject({
      agent: 'claude',
      session_id: 'abc-123',
    });
    expect(typeof sidecar.pid).toBe('number');
    expect(sidecar.pid).toBe(process.pid);
    expect(typeof sidecar.startTime).toBe('string');
    expect(sidecar.startTime.length).toBeGreaterThan(0);
  });

  it('records the agent process above a stayed hook shell', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    const shellPid = await runScriptThroughStayedShell(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    const sidecar = JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(sidecar.pid).toBe(process.pid);
    expect(sidecar.pid).not.toBe(shellPid);
  });

  it('does not resolve beyond four stayed hook shells', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const hookPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const pidLogPath = join(root, 'shell-pids.log');

    await runScriptThroughStayedShells(hookPath, pidLogPath, 5, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    const shellPids = readFileSync(pidLogPath, 'utf8').trim().split('\n').map(Number);
    const sidecar = JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(shellPids).toHaveLength(5);
    expect(shellPids).toContain(sidecar.pid);
    expect(sidecar.pid).not.toBe(process.pid);
  });

  it('writes a completed status on Stop without writing a sidecar', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Stop"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('completed');
    expect(typeof status.statusAt).toBe('number');
  });

  it('writes an in-progress status on UserPromptSubmit after the sidecar write', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toMatchObject({
      agent: 'claude',
      session_id: 'abc-123',
    });
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(typeof status.statusAt).toBe('number');
  });

  it.each([
    ['PreToolUse'],
    ['PostToolUse'],
    ['PostToolUseFailure'],
  ])('writes an in-progress status on %s', async (hookEventName) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: `{"session_id":"abc-123","hook_event_name":"${hookEventName}"}`,
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(typeof status.statusAt).toBe('number');
  });

  it.each([
    ['PreToolUse', 'inProgress'],
    ['PostToolUse', 'inProgress'],
    ['PostToolUseFailure', 'inProgress'],
    ['Stop', 'completed'],
  ])('does not rewrite the sidecar on %s', async (hookEventName, expectedStatus) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const sidecarPath = join(sidecarDir, 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });
    const originalSidecar = readFileSync(sidecarPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: `{"session_id":"def-456","hook_event_name":"${hookEventName}"}`,
    });

    expect(readFileSync(sidecarPath, 'utf8')).toBe(originalSidecar);
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe(expectedStatus);
  });

  it('writes needs-input with the payload message on PermissionRequest and clears it after approval', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"PermissionRequest","message":"Allow Bash?"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toMatchObject({
      status: 'needsInput',
      message: 'Allow Bash?',
    });

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"PostToolUse"}',
    });

    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(status.message).toBeUndefined();
  });

  it.each([
    ['permission_prompt', 'needsInput', 'Approve edit?'],
    ['elicitation_dialog', 'needsInput', 'Choose an option'],
    ['idle_prompt', 'completed', undefined],
  ])('maps Notification(%s) to %s', async (notificationType, expectedStatus, expectedMessage) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'Notification',
        notification_type: notificationType,
        message: expectedMessage,
      }),
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe(expectedStatus);
    expect(status.message).toBe(expectedMessage);
  });

  it('keeps escaped quotes intact in the needs-input message', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'PermissionRequest',
        message: 'Allow Bash(echo "hi")?',
      }),
    });

    const status = JSON.parse(readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.message).toBe('Allow Bash(echo "hi")?');
  });

  it('extracts the top-level message, not tool_input lookalikes', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'PermissionRequest',
        // Escaped "message" lookalike ahead of the real field.
        tool_input: { command: 'printf %s {"message":"decoy"}' },
        message: 'Allow Edit?',
        // Unescaped nested message after the real field.
        tool_response: { message: 'trailing decoy' },
      }),
    });

    const status = JSON.parse(readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.message).toBe('Allow Edit?');
  });

  it('omits the message key when PermissionRequest carries none', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"PermissionRequest"}',
    });

    const raw = readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8');
    expect(raw).not.toContain('"message"');
    expect(JSON.parse(raw).status).toBe('needsInput');
  });

  it('keeps the Stop statusAt when idle_prompt later confirms the completion', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusPath = join(root, 'status', 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"Stop"}',
    });
    const afterStop = readFileSync(statusPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"idle_prompt"}',
    });

    expect(readFileSync(statusPath, 'utf8')).toBe(afterStop);
  });

  it('writes completed on idle_prompt when the recorded status is not completed', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    mkdirSync(statusDir, { recursive: true });
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    writeFileSync(statusPath, '{"status":"inProgress","statusAt":1710000000}\n', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"idle_prompt"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8')).status).toBe('completed');
  });

  it('leaves status unchanged on unknown Notification types', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    mkdirSync(statusDir, { recursive: true });
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    writeFileSync(statusPath, '{"status":"needsInput","statusAt":1710000000,"message":"still waiting"}\n', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"unknown"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toEqual({
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'still waiting',
    });
  });

  it('writes failed status on StopFailure', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"StopFailure"}',
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('failed');
    expect(typeof status.statusAt).toBe('number');
  });

  it('keeps the sidecar unchanged when Stop status writing fails', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    writeFileSync(join(root, 'status'), 'not a directory', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });
    const sidecarPath = join(sidecarDir, 'wt-_work_repo__term-1.json');
    const originalSidecar = readFileSync(sidecarPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"def-456","hook_event_name":"Stop"}',
    });

    expect(readFileSync(sidecarPath, 'utf8')).toBe(originalSidecar);
  });

  it('renames the Deck tmux window to the agent on SessionStart', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(readFileSync(tmuxLogPath, 'utf8')).toBe(
      '-L deck rename-window -t wt-_work_repo__term-1 claude\n',
    );
  });

  it('renames the Deck tmux window to the agent on UserPromptSubmit', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-2',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"codex-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(readFileSync(tmuxLogPath, 'utf8')).toBe(
      '-L deck rename-window -t wt-_work_repo__term-2 codex\n',
    );
  });

  it('ignores SessionEnd so only the sweep removes sidecars', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const sidecarPath = join(sidecarDir, 'wt-_work_repo__term-1.json');
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    const originalSidecar = '{"agent":"claude","session_id":"abc-123","pid":111,"startTime":"Thu Jun 11 20:00:00 2026"}\n';
    const originalStatus = '{"status":"completed","statusAt":1710000000}\n';
    mkdirSync(sidecarDir, { recursive: true });
    mkdirSync(statusDir, { recursive: true });
    writeFileSync(sidecarPath, originalSidecar, 'utf8');
    writeFileSync(statusPath, originalStatus, 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"hook_event_name":"SessionEnd"}',
    });

    expect(existsSync(tmuxLogPath)).toBe(false);
    expect(readFileSync(sidecarPath, 'utf8')).toBe(originalSidecar);
    expect(readFileSync(statusPath, 'utf8')).toBe(originalStatus);
  });

  it('writes a Codex sidecar keyed by DECK_SESSION', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"SessionStart"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toMatchObject({
      agent: 'codex',
      session_id: 'codex-123',
    });
    expect(existsSync(statusDir)).toBe(false);
  });

  it('refuses to attribute a Codex app-server hook to a Terminal', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const markerPath = join(root, 'codex-shared-server.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    const serverPid = await runScriptFromCodexAppServer(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'codex-123',
        cwd: '/work/repo',
        hook_event_name: 'UserPromptSubmit',
      }),
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(statusDir)).toBe(false);
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toMatchObject({
      serverPid,
      sessionId: 'codex-123',
      cwd: '/work/repo',
    });
    expect(typeof JSON.parse(readFileSync(markerPath, 'utf8')).at).toBe('number');
  });

  it('writes Codex in-progress status on UserPromptSubmit without breaking the sidecar', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toMatchObject({
      agent: 'codex',
      session_id: 'codex-123',
    });
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(typeof status.statusAt).toBe('number');
  });

  it('writes process liveness metadata to Codex sidecars only', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"UserPromptSubmit"}',
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.agent).toBe('codex');
    expect(status.pid).toBeUndefined();
    expect(status.startTime).toBeUndefined();
    const sidecar = JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(sidecar).toMatchObject({
      agent: 'codex',
      session_id: 'codex-123',
    });
    expect(typeof sidecar.pid).toBe('number');
    expect(sidecar.pid).toBeGreaterThan(0);
    expect(typeof sidecar.startTime).toBe('string');
    expect(sidecar.startTime.length).toBeGreaterThan(0);
  });

  it.each([
    ['PreToolUse', 'inProgress'],
    ['Stop', 'completed'],
  ])('writes Codex %s as %s without writing a sidecar', async (hookEventName, expectedStatus) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: `{"session_id":"codex-123","hook_event_name":"${hookEventName}"}`,
    });

    expect(existsSync(sidecarDir)).toBe(false);
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe(expectedStatus);
    expect(typeof status.statusAt).toBe('number');
  });

  it('writes Codex needs-input with an empty message on PermissionRequest', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"PermissionRequest","tool_name":"shell"}',
    });

    const raw = readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8');
    const status = JSON.parse(raw);
    expect(status.status).toBe('needsInput');
    expect(status.message).toBe('');
    expect(typeof status.statusAt).toBe('number');
  });

  it('exits 0 and emits no decision for Codex PermissionRequest when status writing fails', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    writeFileSync(join(root, 'status'), 'not a directory', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    const result = await runScriptResult(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"PermissionRequest"}',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 and emits no decision for malformed Codex PermissionRequest payloads', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    const result = await runScriptResult(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"PermissionRequest"',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('does not map Codex StopFailure to status', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"StopFailure"}',
    });

    expect(existsSync(statusDir)).toBe(false);
  });

  it('no-ops outside Deck when DECK_SESSION is absent', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: undefined,
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
  });

  it('no-ops when a start event has no session id', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"hook_event_name":"SessionStart"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
  });

  it('does not write a sidecar when hook_event_name is absent, and issues no rename', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-hook-'));
  tempRoots.push(root);
  return root;
}

function writeScript(root: string, text: string): string {
  const scriptPath = join(root, 'deck-claude-hook.sh');
  writeFileSync(scriptPath, text, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeTmuxStub(root: string): string {
  const binDir = join(root, 'bin');
  const logPath = join(root, 'tmux.log');
  mkdirSync(binDir, { recursive: true });
  const tmuxPath = join(binDir, 'tmux');
  writeFileSync(tmuxPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logPath}'\n`, 'utf8');
  chmodSync(tmuxPath, 0o755);
  return logPath;
}

function runScriptThroughStayedShells(
  targetPath: string,
  pidLogPath: string,
  depth: number,
  options: { env: NodeJS.ProcessEnv; input: string },
): Promise<void> {
  let command = quoteForShell(targetPath);
  for (let index = 0; index < depth; index += 1) {
    command = `printf '%s\\n' "$$" >> ${quoteForShell(pidLogPath)}; sh -c ${quoteForShell(command)}; :`;
  }
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-c', command], { env: options.env }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin?.end(options.input);
  });
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runScript(
  scriptPath: string,
  options: { args?: string[]; env: NodeJS.ProcessEnv; input: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(scriptPath, options.args ?? [], { env: options.env }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin?.end(options.input);
  });
}

function runScriptResult(
  scriptPath: string,
  options: { args?: string[]; env: NodeJS.ProcessEnv; input: string },
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile(scriptPath, options.args ?? [], { env: options.env }, (error, stdout) => {
      if (error && 'code' in error) {
        resolve({ code: typeof error.code === 'number' ? error.code : null, stdout });
      } else {
        resolve({ code: 0, stdout });
      }
    });
    child.stdin?.end(options.input);
  });
}

function runScriptFromCodexAppServer(
  scriptPath: string,
  options: { env: NodeJS.ProcessEnv; input: string },
): Promise<number> {
  const parent = [
    "const { spawn } = require('node:child_process');",
    'const hook = spawn(\'sh\', [\'-c\', \'"$DECK_TEST_HOOK"; :\'], { env: process.env, stdio: [\'pipe\', \'inherit\', \'inherit\'] });',
    'hook.stdin.end(process.env.DECK_TEST_INPUT);',
    'hook.on(\'exit\', (code) => process.exit(code ?? 1));',
  ].join('');

  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['-e', parent, 'codex', 'app-server', scriptPath],
      { env: { ...options.env, DECK_TEST_HOOK: scriptPath, DECK_TEST_INPUT: options.input } },
      (error) => {
        if (error) reject(error);
        else resolve(child.pid!);
      },
    );
  });
}

function runScriptThroughStayedShell(
  scriptPath: string,
  options: { env: NodeJS.ProcessEnv; input: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-c', `'${scriptPath}'; :`], { env: options.env }, (error) => {
      if (error) reject(error);
      else resolve(child.pid!);
    });
    child.stdin?.end(options.input);
  });
}
