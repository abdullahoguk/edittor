// In-app Claude chat: runs the local `claude` CLI (with the user's existing login) using the MCP tools.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectDir, ROOT } from './store';

const sessions = new Map<string, string>(); // projectId -> claude session id
const running = new Map<string, ReturnType<typeof Bun.spawn>>();

export interface ChatRequest {
  projectId: string;
  message: string;
  context?: string; // selected scene, active format, etc.
  model?: string;
  reset?: boolean;
  lang?: 'tr' | 'en';
}

async function skillText() {
  try { return await readFile(join(ROOT, 'skill/edittor/SKILL.md'), 'utf8'); } catch { return ''; }
}

export function stopChat(projectId: string) {
  running.get(projectId)?.kill();
  running.delete(projectId);
}

export async function chatStream(req: ChatRequest, port: number): Promise<ReadableStream> {
  if (req.reset) sessions.delete(req.projectId);
  stopChat(req.projectId);
  const mcp = {
    mcpServers: {
      edittor: {
        command: process.execPath,
        args: [join(ROOT, 'mcp/index.ts')],
        env: { EDITTOR_URL: `http://127.0.0.1:${port}`, EDITTOR_PROJECT: req.projectId },
      },
    },
  };
  const system = [
    `You are the editing assistant inside the Edittor video editor. Reply in ${req.lang === 'en' ? 'English' : 'Turkish'}; keep it short and clear.`,
    `Active project id: ${req.projectId}. Read and change the project only through the mcp__edittor__* tools; changes appear in the editor instantly.`,
    'When choosing visuals, look at thumbnails with look_at_assets.',
    (await skillText()).replace(/^---[\s\S]*?---/, ''),
  ].join('\n\n');
  const prompt = req.context ? `${req.message}\n\n<editor_context>\n${req.context}\n</editor_context>` : req.message;
  const args = [
    'claude', '-p', prompt,
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--mcp-config', JSON.stringify(mcp), '--strict-mcp-config',
    '--allowedTools', 'mcp__edittor',
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent',
    '--append-system-prompt', system,
  ];
  if (req.model) args.push('--model', req.model);
  const prev = sessions.get(req.projectId);
  if (prev) args.push('--resume', prev);

  const proc = Bun.spawn(args, { cwd: projectDir(req.projectId), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  running.set(req.projectId, proc);
  const enc = new TextEncoder();

  return new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* stream closed */ } };
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const errText = new Response(proc.stderr).text();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.session_id) sessions.set(req.projectId, ev.session_id);
          if (ev.type === 'stream_event') {
            const e = ev.event;
            if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') send({ t: 'delta', text: e.delta.text });
            else if (e?.type === 'message_start') send({ t: 'message' });
          } else if (ev.type === 'assistant') {
            for (const c of ev.message?.content ?? []) {
              if (c.type === 'tool_use' && String(c.name).startsWith('mcp__edittor__')) send({ t: 'tool', name: String(c.name).replace('mcp__edittor__', ''), input: c.input });
            }
          } else if (ev.type === 'user') {
            for (const c of ev.message?.content ?? []) {
              if (c.type === 'tool_result' && c.is_error) send({ t: 'tool-error', text: typeof c.content === 'string' ? c.content : JSON.stringify(c.content).slice(0, 300) });
            }
          } else if (ev.type === 'result') {
            send({ t: 'done', cost: ev.total_cost_usd, error: ev.is_error ? ev.result : undefined });
          }
        }
      }
      const code = await proc.exited;
      running.delete(req.projectId);
      if (code !== 0) send({ t: 'error', text: (await errText).slice(-800) || `claude exited with code ${code}` });
      send({ t: 'end' });
      ctrl.close();
    },
    cancel() { proc.kill(); },
  });
}
