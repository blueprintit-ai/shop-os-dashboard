export class StepError extends Error {
  constructor(message, { command, exitCode, outTail, hint } = {}) {
    super(message);
    this.name = "StepError";
    this.command = command;
    this.exitCode = exitCode;
    this.outTail = outTail;
    this.hint = hint;
  }
}

export function failFromResult(message, result) {
  const suffix = result.timedOut ? " (timed out)" : result.errorCode ? ` (${result.errorCode})` : "";
  throw new StepError(message + suffix, { command: result.cmdline, exitCode: result.code ?? undefined, outTail: result.outTail });
}
