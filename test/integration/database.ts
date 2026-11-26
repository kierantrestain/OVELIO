import { spawn } from 'node:child_process';

// CI uses the Compose database client. An isolated PostgreSQL server can use psql with PG* settings.
export async function fixtureSql(sql: string, values: Record<string, string | number>) {
  const local = process.env.OVELIO_TEST_PSQL;
  const composeFile = process.env.OVELIO_TEST_ENV_FILE;
  const command = local || process.env.OVELIO_TEST_DOCKER || 'docker';
  const args = local ? [] : ['compose', ...(composeFile ? ['--env-file', composeFile] : []),
    'exec', '-T', 'ovelio-db', 'psql', '-U', 'ovelio', '-d', 'ovelio'];
  args.push('-X', '-qAt', '--set=ON_ERROR_STOP=1', '--file=-',
    ...Object.entries(values).map(([key, value]) => '--set=' + key + '=' + value));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Acceptance fixture SQL failed: ' + error)));
    child.stdin.on('error', reject);
    child.stdin.end(sql);
  });
}
