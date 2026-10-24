// Runs the server and client dev processes side by side with prefixed output.
// Ctrl+C (or either process exiting) stops both.
import { spawn } from 'node:child_process';

const tasks = [
  { name: 'server', colour: 34, workspace: '@wst/server' },
  { name: 'client', colour: 32, workspace: '@wst/client' },
];

const children = tasks.map(({ name, colour, workspace }) => {
  // A single command string: shell mode is needed for npm.cmd on Windows, and Node deprecates shell + args array.
  const child = spawn(`npm run dev -w ${workspace}`, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, WST_DEV_TOOLS: '1' } }); // WST_DEV_TOOLS: the server obeys the client's Dev Options menu
  const prefix = `\x1b[${colour}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const lines = (buffered + chunk).split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
