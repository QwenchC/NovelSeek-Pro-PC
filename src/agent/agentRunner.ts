// Module-level agent runner — the PC port of Android's AgentController. The ReAct loop lives
// OUTSIDE any React component and drives the app by reading/writing the global zustand store, so:
//   • the run keeps going when the user switches pages (background run),
//   • the user can inject instructions or answer questions at any time,
//   • every step is persisted (IndexedDB) as it happens, surviving reloads.
// The AgentPage is a thin view: it renders the current session's steps + run-time status from the
// store and forwards user actions (start / inject / confirm / stop) to this singleton.

import { useAppStore } from '@store/index';
import type { AgentStep, AgentStepRole } from '@store/index';
import { aiApi } from '@services/api';
import { tx } from '@utils/i18n';
import { agentSystemPrompt } from './agentPrompts';
import { toolDocs, findTool, type AgentToolCtx } from './agentTools';

const MAX_STEPS = 40;
const MODEL_RETRIES = 3;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const s = () => useAppStore.getState();
const lang = () => s().uiLanguage;

// ── run-time (module) state ──
let running = false;
let stopFlag = false;
let gateResolve: ((v: string | null) => void) | null = null;
let gateKind: 'user' | 'confirm' | null = null;

function push(sessionId: string, role: AgentStepRole, content: string, tool?: string, image?: string) {
  const step: AgentStep = { id: newId(), role, content, tool, image };
  s().appendAgentStep(sessionId, step);
}

function parseAction(raw: string): { thought?: string; action?: string; args?: Record<string, any> } | null {
  const c = raw.replace(/```(?:json)?/gi, '').trim();
  const a = c.indexOf('{'); const b = c.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(c.slice(a, b + 1)); } catch { return null; }
}

function buildTranscript(sessionId: string): string {
  const sess = s().getAgentSession(sessionId);
  const steps = sess?.steps ?? [];
  const transcript = steps.slice(-60).map((sp) => {
    const tag = sp.role === 'user' ? '用户指令'
      : sp.role === 'thought' ? '你的思考'
      : sp.role === 'tool' ? `你执行的动作[${sp.tool}]`
      : sp.role === 'result' ? '结果'
      : sp.role === 'final' ? '你的回复'
      : sp.role === 'ask' ? '你向用户提问'
      : sp.role === 'image' ? '你生成的图片'
      : sp.role === 'error' ? '错误' : sp.role;
    return `【${tag}】${sp.content}`;
  }).join('\n');
  const pid = sess?.lockedProjectId ?? null;
  let state = `当前聚焦项目：${pid ?? '（无，可用 create_project 新建或 list_projects 查看）'}`;
  if (pid) {
    const p = s().projects.find((x) => x.id === pid);
    if (p) state += `\n项目《${p.title}》 副本=${s().getVolumes(pid).length} 弧线=${s().getPlotArcs(pid).length} 角色=${s().getCharacters(pid).length}`;
  }
  return `## 当前状态\n${state}\n\n## 执行链（节选）\n${transcript || '（空，等待第一条指令）'}\n\n请决定下一步，只输出一个 JSON 动作。`;
}

function toolCtx(sessionId: string): AgentToolCtx {
  return {
    getFocusId: () => s().getAgentSession(sessionId)?.lockedProjectId ?? null,
    setFocusId: (id) => s().patchAgentSession(sessionId, { lockedProjectId: id }),
    textConfig: s().textModelConfig,
    embeddingConfig: s().embeddingConfig,
    uiLanguage: s().uiLanguage,
    pushImage: (label, dataUrl) => push(sessionId, 'image', label, undefined, dataUrl),
  };
}

/** Pause the run for the user (ask_user / confirm) and resolve when they respond (or null if stopped). */
function awaitGate(kind: 'user' | 'confirm'): Promise<string | null> {
  s().setAgentStatus(kind === 'user' ? 'awaiting_user' : 'awaiting_confirm');
  return new Promise<string | null>((resolve) => {
    gateKind = kind;
    gateResolve = (v) => { s().setAgentStatus('running'); resolve(v); };
  });
}

async function loop(sessionId: string) {
  running = true;
  s().setAgentStatus('running');
  s().setAgentRunSessionId(sessionId);
  const system = agentSystemPrompt(toolDocs(), lang());
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      if (stopFlag) { push(sessionId, 'error', tx(lang(), '已停止。', 'Stopped.')); break; }

      // Model call with retry (mirrors Android MODEL_RETRIES).
      let raw: string | null = null;
      let lastErr = '';
      for (let attempt = 0; attempt < MODEL_RETRIES && !stopFlag; attempt++) {
        try {
          const r = await aiApi.chat(buildTranscript(sessionId), s().textModelConfig, system);
          if (r && r.trim()) { raw = r; break; }
          lastErr = tx(lang(), '空响应', 'empty response');
        } catch (e) { lastErr = String(e); }
        if (attempt < MODEL_RETRIES - 1) await delay(1500);
      }
      if (stopFlag) { push(sessionId, 'error', tx(lang(), '已停止。', 'Stopped.')); break; }
      if (raw == null) {
        push(sessionId, 'error', tx(lang(), `模型多次无响应（${lastErr}）。已暂停，可补充指令或点「继续执行」重试。`, `Model gave no response (${lastErr}). Paused — add input or click Continue to retry.`));
        break;
      }

      const parsed = parseAction(raw);
      if (!parsed || !parsed.action) {
        push(sessionId, 'error', tx(lang(), `无法解析模型输出：${raw.slice(0, 200)}`, `Could not parse output: ${raw.slice(0, 200)}`));
        push(sessionId, 'result', tx(lang(), '（无法解析动作，请只输出规定格式的单个 JSON 动作）', '(Could not parse; output only one JSON action object.)'));
        continue;
      }
      const { thought, action, args = {} } = parsed;
      if (thought) push(sessionId, 'thought', thought);

      if (action === 'final') { push(sessionId, 'final', args.message || tx(lang(), '完成。', 'Done.')); break; }
      if (action === 'ask_user') {
        push(sessionId, 'ask', args.question || tx(lang(), '请补充信息：', 'Please provide more info:'));
        const ans = await awaitGate('user');
        if (stopFlag) break;
        if (ans != null) push(sessionId, 'user', ans);
        continue;
      }

      const tool = findTool(action);
      if (!tool) {
        push(sessionId, 'tool', JSON.stringify(args), action);
        push(sessionId, 'result', tx(lang(), `未知工具：${action}`, `Unknown tool: ${action}`), action);
        continue;
      }

      const autoApprove = s().getAgentSession(sessionId)?.autoApprove ?? false;
      if (tool.sensitive && !autoApprove) {
        s().setAgentPendingConfirm({ tool: action, args });
        const decision = await awaitGate('confirm');
        s().setAgentPendingConfirm(null);
        if (stopFlag) break;
        if (decision !== 'yes') {
          // Free-form reply during a confirm = decline THIS tool + redirect. Name the rejected tool
          // and carry the user's guidance so the model can't misattribute what was rejected.
          const guidance = decision && decision.startsWith('no:') ? decision.slice(3).trim() : '';
          push(sessionId, 'result',
            guidance
              ? tx(lang(), `用户拒绝执行【${action}】，并要求改为：${guidance}`, `User rejected [${action}] and asked instead: ${guidance}`)
              : tx(lang(), `用户拒绝执行【${action}】。`, `User rejected [${action}].`),
            action);
          continue;
        }
      }

      // Log the action only now that it will actually run (rejected sensitive ops are NOT logged as executed).
      push(sessionId, 'tool', JSON.stringify(args), action);
      let result: string;
      try { result = await tool.run(args, toolCtx(sessionId)); }
      catch (e) { result = tx(lang(), `错误：${e instanceof Error ? e.message : String(e)}`, `Error: ${e instanceof Error ? e.message : String(e)}`); }
      push(sessionId, 'result', result, action);
      if (i === MAX_STEPS - 1) push(sessionId, 'error', tx(lang(), '已达到最大步数，自动停止。', 'Max steps reached — stopped.'));
    }
  } finally {
    running = false;
    stopFlag = false;
    gateResolve = null;
    gateKind = null;
    s().setAgentStatus('idle');
    s().setAgentRunSessionId(null);
    s().setAgentPendingConfirm(null);
  }
}

export const agentRunner = {
  isRunning: () => running,
  runningSessionId: () => s().agentRunSessionId,

  /** Start a run for a session with a fresh user command. If a run is already active, inject instead. */
  start(sessionId: string, command: string) {
    if (running) { this.inject(command); return; }
    push(sessionId, 'user', command);
    stopFlag = false;
    void loop(sessionId);
  },

  /** Resume a paused/idle session that already has steps. */
  continue(sessionId: string) {
    if (running) return;
    stopFlag = false;
    void loop(sessionId);
  },

  /** Send free-form text at any time: answers a question, declines a pending confirm (with guidance),
   *  or is injected as a new instruction picked up on the next loop turn. */
  inject(text: string) {
    const sid = s().agentRunSessionId;
    if (!sid) return;
    const st = s().agentStatus;
    if (st === 'awaiting_user' && gateKind === 'user' && gateResolve) {
      push(sid, 'user', text);
      const r = gateResolve; gateResolve = null; gateKind = null; r(text);
      return;
    }
    if (st === 'awaiting_confirm' && gateKind === 'confirm' && gateResolve) {
      // Free-form reply during a confirm = decline the pending action + redirect. Carry the text
      // as guidance ("no:<text>") so the loop names the rejected tool and the user's actual ask.
      push(sid, 'user', text);
      s().setAgentPendingConfirm(null);
      const r = gateResolve; gateResolve = null; gateKind = null; r('no:' + text);
      return;
    }
    // Running mid-step: append; the next buildTranscript turn will pick it up.
    push(sid, 'user', text);
  },

  /** Approve / reject a confirm-gated tool. `always` pre-authorizes the rest of this session. */
  confirm(approve: boolean, always = false) {
    const sid = s().agentRunSessionId;
    if (!sid) return;
    if (always) s().patchAgentSession(sid, { autoApprove: true });
    if (gateKind === 'confirm' && gateResolve) {
      const r = gateResolve; gateResolve = null; gateKind = null; r(approve ? 'yes' : 'no');
    }
  },

  stop() {
    stopFlag = true;
    if (gateResolve) { const r = gateResolve; gateResolve = null; gateKind = null; r(null); }
    s().setAgentStatus('idle');
    s().setAgentPendingConfirm(null);
  },
};
