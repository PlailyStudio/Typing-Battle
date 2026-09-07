import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('server/modules', { recursive: true });
writeFileSync('server/modules/index.js', readFileSync('shared/rules.js', 'utf8').replace('Number.isInteger(msg.seq)', "(typeof msg.seq === 'number' && isFinite(msg.seq) && Math.floor(msg.seq) === msg.seq)") + '\n' + readFileSync('server/main.js', 'utf8'));
console.log('Nakama runtime built: server/modules/index.js');
